import test from "node:test";
import assert from "node:assert/strict";
import { collectProviderTabMap, clusterAssignments } from "../modules/remote-assignment-retry.mjs";
import { runPass2Remote, runPass2RemoteFresh, classifyExistingGroupsRemoteBatch } from "../modules/remote-provider.mjs";
import { unifiedClassifyOllama, runPass2OllamaFresh } from "../modules/ollama.mjs";
import { ollamaGenerateJson } from "../modules/ollama-transport.mjs";
import { getProviderReadiness } from "../modules/provider-readiness.mjs";
import { buildProviderRequest } from "../modules/provider-requests.mjs";
import { readProviderSettings } from "../modules/provider-settings.mjs";
import { CONFIG } from "../modules/config.mjs";

const settings = { provider: "openai", endpoint: "https://api.example.test/v1", apiKey: "sk-test", model: "test", consentToSendData: true };
const tabs = (count) => Array.from({ length: count }, (_, i) => ({ hostname: `site${i}.test`, title: `Tab ${i}`, url: "" }));
const response = (parsed) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(parsed) } }] }));
const withFetch = async (mock, task) => {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await task(); } finally { globalThis.fetch = original; }
};

test("malformed indices and labels remain unresolved and valid assignments survive retry", async () => {
  let calls = 0;
  const input = tabs(4);
  const result = await collectProviderTabMap({ tabs: input, initialBatchSize: 4, label: "test", buildPrompt: () => "", fetchJson: async () => {
    calls++;
    return calls === 1 ? { "0": "Work", "1.7": "Wrong", "2garbage": "Wrong", "01": "Wrong", "1": true, "2": { name: "Work" }, "3": "\n" } : {};
  } });
  assert.deepEqual([...result.parsedByIndex], [[0, "Work"]]);
  assert.deepEqual(result.missing, [1, 2, 3]);
  assert.equal(calls, 4);
});

test("cluster boundaries reject fractional, string and conflicting memberships", () => {
  assert.deepEqual(clusterAssignments({ groups: [
    { name: "Work", tabs: [0, 0.5, "1", 9] },
    { name: true, tabs: [1] },
    { name: "Shopping", tabs: [0, 2] },
  ], skipped: [3] }, 4), { 2: "Shopping", 3: "skipped" });
});

test("authentication errors stop once and preserve successful earlier batches", async () => {
  const input = tabs(80);
  let calls = 0;
  await withFetch(async (_, init) => {
    calls++;
    if (calls > 1) return new Response("echo sk-test private-page-body", { status: 401 });
    const lines = [...JSON.parse(init.body).messages[0].content.matchAll(/^(\d+)\. /gm)];
    return response(Object.fromEntries(lines.map((line) => [line[1], "Dev"])));
  }, async () => {
    const plan = await runPass2Remote(input, [{ name: "Dev" }], settings);
    assert.equal(calls, 2);
    assert.equal(plan.assignedToExisting.length, 75);
    assert.deepEqual(plan.unresolved, input.slice(75));
    assert.deepEqual(plan.skipped, []);
    assert.match(plan.failed, /HTTP 401/);
    assert.doesNotMatch(plan.failed, /sk-test|private-page-body/);
  });
});

test("no-rules clustering preserves earlier chunks after a terminal failure", async () => {
  const input = tabs(80);
  let calls = 0;
  await withFetch(async () => ++calls === 1 ? response({ groups: [{ name: "Work", tabs: Array.from({ length: 75 }, (_, i) => i) }], skipped: [] }) : new Response("secret", { status: 403 }), async () => {
    const plan = await runPass2Remote(input, [], settings);
    assert.equal(calls, 2);
    assert.equal(plan.newGroups[0].tabs.length, 75);
    assert.deepEqual(plan.unresolved, input.slice(75));
  });
});

test("preview reassignment keeps partial assignments and exposes unresolved indices", async () => {
  let calls = 0;
  await withFetch(async () => ++calls === 1 ? response(Object.fromEntries(Array.from({ length: 75 }, (_, i) => [i, "Dev"]))) : new Response("", { status: 401 }), async () => {
    const map = await classifyExistingGroupsRemoteBatch(tabs(80), [{ name: "Dev" }], settings);
    assert.equal(calls, 2);
    assert.equal(map.get(0), "Dev");
    assert.deepEqual([...map.unresolved], [75, 76, 77, 78, 79]);
  });
});

test("deduped failures fan out without being treated as deliberate skips", async () => {
  const input = tabs(1);
  input.push({ ...input[0] });
  let calls = 0;
  await withFetch(async () => { calls++; return new Response("private", { status: 401 }); }, async () => {
    const plan = await runPass2RemoteFresh(input, settings);
    assert.equal(calls, 1);
    assert.deepEqual(plan.unresolved, input);
    assert.deepEqual(plan.skipped, []);
  });
});

test("provider timers remain active while response bodies are read", async () => {
  const timer = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => timer(fn, ms >= 120000 ? 5 : ms, ...args);
  try {
    await withFetch(async (_, init) => ({ ok: true, text: () => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("secret"), { name: "AbortError" })), { once: true })) }), async () => {
      const plan = await runPass2RemoteFresh(tabs(1), settings);
      assert.equal(plan.unresolved.length, 1);
      assert.match(plan.failed, /timeout/);
      assert.doesNotMatch(plan.failed, /secret/);
    });
    await withFetch(async (_, init) => ({ ok: true, json: () => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("secret"), { name: "AbortError" })), { once: true })) }), async () => {
      const result = await ollamaGenerateJson("http://localhost:11434", "test", "classify");
      assert.equal(result.ok, false);
      assert.match(result.error, /timeout/);
      assert.doesNotMatch(result.error, /secret/);
    });
  } finally { globalThis.setTimeout = timer; }
});

test("custom OpenAI self-host endpoints allow an omitted key without a bearer header", () => {
  const provider = { ...settings, provider: "custom", format: "openai", apiKey: "" };
  assert.equal(getProviderReadiness(provider).ok, true);
  const request = buildProviderRequest(provider, "classify", 4096);
  assert.equal(Object.hasOwn(request.init.headers, ["author", "ization"].join("")), false);
});

test("provider settings read typed default-branch preferences", () => {
  const values = new Map([[CONFIG.AI_ENGINE_PREF, "openai"], [CONFIG.AI_PROVIDER_CONSENT_PREF, true], [CONFIG.AI_OPENAI_ENDPOINT_PREF, settings.endpoint], [CONFIG.AI_OPENAI_API_KEY_PREF, settings.apiKey], [CONFIG.AI_OPENAI_MODEL_PREF, settings.model]]);
  const prefs = { PREF_STRING: 32, PREF_BOOL: 128, prefHasUserValue: () => false,
    getPrefType: (key) => typeof values.get(key) === "boolean" ? 128 : values.has(key) ? 32 : 0,
    getStringPref: (key) => values.get(key), getBoolPref: (key) => values.get(key) };
  assert.deepEqual(readProviderSettings(prefs), settings);
});

test("Ollama unified/fresh paths retain chunking, retries and duplicate fan-out", async () => {
  const input = tabs(80);
  input.push({ ...input[0] });
  const originalServices = globalThis.Services;
  globalThis.Services = { prefs: { getStringPref: (_, fallback) => fallback, getBoolPref: (_, fallback) => fallback } };
  try {
    for (const fresh of [false, true]) {
      const sizes = [];
      await withFetch(async (_, init) => {
        const body = JSON.parse(init.body);
        assert.equal(body.options.num_predict, 4096);
        const lines = [...body.prompt.matchAll(/^(\d+)\. /gm)];
        sizes.push(lines.length);
        return new Response(JSON.stringify({ response: JSON.stringify(Object.fromEntries(lines.map((line) => [line[1], "Dev"]))) }));
      }, async () => {
        const plan = fresh ? await runPass2OllamaFresh(input) : await unifiedClassifyOllama(input, [{ name: "Dev" }], "http://localhost:11434", "test");
        assert.deepEqual(sizes, fresh ? [35, 35, 10] : [75, 5]);
        assert.equal(fresh ? plan.newGroups[0].tabs.length : plan.assignedToExisting.length, 81);
        assert.deepEqual(plan.unresolved, []);
      });
    }
  } finally { globalThis.Services = originalServices; }
});


test("a failed fresh batch does not trigger a merge request for prior successful groups", async () => {
  const input = tabs(40);
  let calls = 0;
  await withFetch(async () => {
    calls++;
    return calls === 1 ? response(Object.fromEntries(Array.from({ length: 35 }, (_, i) => [i, i % 2 ? "Work" : "Shopping"]))) : new Response("private", { status: 403 });
  }, async () => {
    const plan = await runPass2RemoteFresh(input, settings);
    assert.equal(calls, 2);
    assert.equal(plan.newGroups.length, 2);
    assert.equal(plan.newGroups.reduce((sum, group) => sum + group.tabs.length, 0), 35);
    assert.deepEqual(plan.unresolved, input.slice(35));
  });
});

test("network errors omit echoed provider secrets and page content", async () => {
  await withFetch(async () => { throw new Error("request sk-test echoed private page"); }, async () => {
    const plan = await runPass2RemoteFresh(tabs(1), settings);
    assert.equal(plan.unresolved.length, 1);
    assert.match(plan.failed, /network request failed/);
    assert.doesNotMatch(plan.failed, /sk-test|private page/);
  });
});


test("same-title tabs at distinct URLs retain their own snippets and assignments across providers", async () => {
  const first = { hostname: "pages.test", title: "Same title", url: "https://pages.test/first" };
  const second = { ...first, url: "https://pages.test/second" };
  const duplicate = { ...first };
  const input = [first, second, duplicate];
  const originalServices = globalThis.Services;
  globalThis.Services = { prefs: { getStringPref: (_, fallback) => fallback, getBoolPref: (_, fallback) => fallback } };
  try {
    for (const engine of ["remote", "ollama"]) {
      for (const fresh of [false, true]) {
        const snippetUrls = [];
        let classificationCalls = 0;
        await withFetch(async (url, init) => {
          if (url.startsWith("https://pages.test/")) {
            snippetUrls.push(url);
            return new Response(`<meta name="description" content="${url.endsWith("first") ? "First page" : "Second page"}">`, { headers: { "content-type": "text/html" } });
          }
          const body = JSON.parse(init.body);
          const prompt = engine === "remote" ? body.messages[0].content : body.prompt;
          let labels = {};
          if (!prompt.includes("Categories to review")) {
            classificationCalls++;
            assert.equal([...prompt.matchAll(/^(\d+)\. /gm)].length, 2);
            assert.match(prompt, /0\. pages\.test — "Same title"\n   Summary: "First page"/);
            assert.match(prompt, /1\. pages\.test — "Same title"\n   Summary: "Second page"/);
            labels = { 0: "Dev", 1: "Research" };
          }
          return engine === "remote" ? response(labels) : new Response(JSON.stringify({ response: JSON.stringify(labels) }));
        }, async () => {
          const rules = [{ name: "Dev" }, { name: "Research" }];
          const plan = engine === "remote"
            ? fresh ? await runPass2RemoteFresh(input, settings) : await runPass2Remote(input, rules, settings)
            : fresh ? await runPass2OllamaFresh(input) : await unifiedClassifyOllama(input, rules, "http://localhost:11434", "test");
          assert.deepEqual(snippetUrls, [first.url, second.url]);
          assert.equal(classificationCalls, 1);
          if (fresh) {
            assert.deepEqual(plan.newGroups.find((group) => group.name === "Dev").tabs, [first, duplicate]);
            assert.deepEqual(plan.newGroups.find((group) => group.name === "Research").tabs, [second]);
          } else {
            assert.deepEqual(plan.assignedToExisting.map((assignment) => assignment.groupName), ["Dev", "Research", "Dev"]);
          }
          assert.deepEqual(plan.unresolved, []);
        });
      }
    }
  } finally { globalThis.Services = originalServices; }
});

test("a network failure stops remaining chunks without repeating the outage", async () => {
  let calls = 0;
  const input = tabs(100);
  await withFetch(async () => { calls++; throw new TypeError("connection refused"); }, async () => {
    const plan = await runPass2RemoteFresh(input, settings);
    assert.equal(calls, 1);
    assert.deepEqual(plan.unresolved, input);
    assert.deepEqual(plan.newGroups, []);
  });
});
