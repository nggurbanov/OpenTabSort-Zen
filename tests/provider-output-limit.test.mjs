import test from "node:test";
import assert from "node:assert/strict";
import { providerJson } from "../modules/remote-provider.mjs";
import { ollamaGenerateJson } from "../modules/ollama-transport.mjs";
import { unifiedClassifyOllama, runPass2OllamaFresh } from "../modules/ollama.mjs";

const code = "PROVIDER_OUTPUT_LIMIT";
const settings = { provider: "custom", format: "openai", endpoint: "https://api.example.test/v1", model: "fixture", apiKey: "private-fixture-key" };
const withFetch = async (t, fetch, task) => {
  const original = globalThis.fetch;
  globalThis.fetch = fetch;
  try { await task(); } finally { globalThis.fetch = original; }
};
const response = (envelope) => new Response(JSON.stringify(envelope), { headers: { "content-type": "application/json" } });
const isOutputLimit = (error) => {
  assert.equal(error.code, code);
  assert.equal(error.retryable, false);
  assert.match(error.message, /output limit/i);
  assert.doesNotMatch(error.message, /private-fixture-key|private-tab-content/);
  return true;
};

for (const format of ["openai", "gemini", "ollama"]) {
  test(`${format} explicitly identifies output limits without accepting partial or complete answer objects`, async (t) => {
    const provider = format === "gemini" ? { ...settings, provider: "gemini" } : { ...settings, format };
    for (const content of [null, '{"groups":[', '{"groups":[{"name":"private-tab-content","tabs":[0]}]}']) {
      const envelope = format === "openai"
        ? { choices: [{ message: { content }, finish_reason: "length" }] }
        : format === "gemini"
          ? { candidates: [{ content: { parts: [{ text: content }] }, finishReason: "MAX_TOKENS" }] }
          : { response: content, done: true, done_reason: "length" };
      await withFetch(t, async () => response(envelope), async () => {
        await assert.rejects(providerJson(provider, "fixture"), isOutputLimit);
      });
    }
  });
}

test("ordinary JSON parse failures never receive an output-limit code", async (t) => {
  await withFetch(t, async () => response({ choices: [{ message: { content: '{"groups":[' }, finish_reason: "stop" }] }), async () => {
    await assert.rejects(providerJson(settings, "fixture"), (error) => {
      assert.equal(error.code, undefined);
      assert.match(error.message, /non-JSON/i);
      return true;
    });
  });
});

test("provider errors and refusals take precedence and cannot trigger output recovery", async (t) => {
  for (const envelope of [
    { error: { code: 401, message: "private-fixture-key" }, choices: [{ finish_reason: "length" }] },
    { choices: [{ message: { refusal: "private-tab-content" }, finish_reason: "content_filter" }] },
    { choices: [{ message: { refusal: "private-tab-content" }, finish_reason: "length" }] },
  ]) {
    await withFetch(t, async () => response(envelope), async () => {
      await assert.rejects(providerJson(settings, "fixture"), (error) => {
        assert.equal(error.code, undefined);
        assert.equal(error.retryable, false);
        assert.doesNotMatch(error.message, /private-fixture-key|private-tab-content/);
        return true;
      });
    });
  }
});

test("sort cancellation remains an AbortError even when the provider reports its output limit", async (t) => {
  const controller = new AbortController();
  await withFetch(t, async () => {
    controller.abort();
    return response({ choices: [{ message: { content: null }, finish_reason: "length" }] });
  }, async () => {
    await assert.rejects(providerJson(settings, "fixture", 8192, controller.signal), (error) => {
      assert.equal(error.name, "AbortError");
      assert.notEqual(error.code, code);
      return true;
    });
  });
});

test("Ollama reports explicit truncation before parsing or accepting its answer", async (t) => {
  for (const content of ["", '{"groups":[', '{"groups":[{"name":"private-tab-content","tabs":[0]}]}']) {
    await withFetch(t, async () => response({ response: content, done: true, done_reason: "length" }), async () => {
      const result = await ollamaGenerateJson("http://localhost:11434", "fixture", "fixture", 8192);
      assert.equal(result.ok, false);
      assert.equal(result.code, code);
      assert.equal(result.errorType, "output-limit");
      assert.match(result.error, /output limit/i);
      assert.doesNotMatch(result.error, /private-tab-content/);
      assert.equal(result.parsed, undefined);
    });
  }
});

test("Ollama output budgets honor 8K workspace requests while keeping finite bounds and the 4K default", async (t) => {
  const budgets = [];
  await withFetch(t, async (_, init) => {
    budgets.push(JSON.parse(init.body).options.num_predict);
    return response({ response: "{}", done: true, done_reason: "stop" });
  }, async () => {
    for (const budget of [undefined, 4096, 8192, 999999, -1, NaN]) {
      assert.equal((await ollamaGenerateJson("http://localhost:11434", "fixture", "fixture", budget)).ok, true);
    }
    assert.deepEqual(budgets, [4096, 4096, 8192, 8192, 64, 4096]);
  });
});

test("Ollama parse and HTTP failures remain distinct from output-limit recovery", async (t) => {
  for (const [fetch, type] of [
    [async () => response({ response: '{"groups":[', done_reason: "stop" }), "parse"],
    [async () => new Response("private-fixture-key", { status: 401 }), "http"],
  ]) {
    await withFetch(t, fetch, async () => {
      const result = await ollamaGenerateJson("http://localhost:11434", "fixture", "fixture");
      assert.equal(result.ok, false);
      assert.equal(result.code, undefined);
      assert.equal(result.errorType, type);
      assert.doesNotMatch(result.error, /private-fixture-key/);
    });
  }
});

test("Ollama cancellation remains an AbortError when its body reports a length stop", async (t) => {
  const controller = new AbortController();
  await withFetch(t, async () => ({ ok: true, json: async () => {
    controller.abort();
    return { response: "", done: true, done_reason: "length" };
  } }), async () => {
    await assert.rejects(ollamaGenerateJson("http://localhost:11434", "fixture", "fixture", 8192, controller.signal), (error) => {
      assert.equal(error.name, "AbortError");
      assert.notEqual(error.code, code);
      return true;
    });
  });
});


test("legacy Ollama classification stops on explicit output limits and preserves earlier batches", async (t) => {
  const originalServices = globalThis.Services;
  globalThis.Services = { prefs: { getStringPref: (_, fallback) => fallback, getBoolPref: (_, fallback) => fallback } };
  try {
    for (const fresh of [false, true]) {
      const size = fresh ? 35 : 75;
      const tabs = Array.from({ length: size + 5 }, (_, index) => ({ hostname: `site${index}.test`, title: `Tab ${index}`, url: "" }));
      let calls = 0;
      await withFetch(t, async () => {
        calls++;
        return calls === 1
          ? response({ response: JSON.stringify(Object.fromEntries(Array.from({ length: size }, (_, index) => [index, "Dev"]))), done_reason: "stop" })
          : response({ response: "", done_reason: "length" });
      }, async () => {
        const plan = fresh ? await runPass2OllamaFresh(tabs) : await unifiedClassifyOllama(tabs, [{ name: "Dev" }], "http://localhost:11434", "fixture");
        assert.equal(calls, 2);
        assert.equal(fresh ? plan.newGroups[0].tabs.length : plan.assignedToExisting.length, size);
        assert.deepEqual(plan.unresolved, tabs.slice(size));
        assert.match(plan.failed, /output limit/i);
        assert.deepEqual(plan.skipped, []);
      });
    }
  } finally { globalThis.Services = originalServices; }
});
