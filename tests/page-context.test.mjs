import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { fetchPageSnippet, fetchPageSnippets } from "../modules/tabs.mjs";
import { PAGE_CONTEXT_CONCURRENCY, PAGE_CONTEXT_MAX_BYTES, readPageContextHtml } from "../modules/page-context.mjs";
import { beginSortSession } from "../modules/sort-session.mjs";
import { runPass2Remote, runPass2RemoteFresh } from "../modules/remote-provider.mjs";
import { unifiedClassifyOllama, runPass2Ollama, runPass2OllamaFresh } from "../modules/ollama.mjs";
import { providerJson } from "../modules/remote-provider.mjs";
import { ollamaGenerateJson } from "../modules/ollama-transport.mjs";

const encoder = new TextEncoder();
const installGlobals = (t, fetch) => {
  const previous = new Map(["fetch", "Services", "window"].map((key) => [key, globalThis[key]]));
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  globalThis.fetch = fetch;
  globalThis.Services = { prefs: {
    getStringPref: (_key, fallback = "") => fallback,
    getBoolPref: (_key, fallback = false) => fallback,
    addObserver() {}, removeObserver() {},
  } };
  globalThis.window = {};
};

const tabs = (count) => Array.from({ length: count }, (_, index) => ({
  title: `Page ${index}`, hostname: "pages.test", url: `https://pages.test/${index}`,
}));
const readySettings = {
  provider: "openai", endpoint: "https://api.example.test/v1", apiKey: "sk-test",
  model: "test", consentToSendData: true,
};

test("page snippets preserve structured signals and UTF-8 split across stream chunks", async (t) => {
  const html = '<meta property="og:type" content="article"><meta property="og:site_name" content="Example &amp; Co"><h1>Кофе ☕</h1><meta name="description" content="A useful guide">';
  const bytes = encoder.encode(html);
  const split = bytes.indexOf(0xd0) + 1;
  let options;
  installGlobals(t, async (_url, init) => {
    options = init;
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.subarray(0, split));
        controller.enqueue(bytes.subarray(split));
        controller.close();
      },
    }), { headers: { "content-type": "text/html; charset=utf-8" } });
  });
  assert.equal(await fetchPageSnippet("https://pages.test/article"),
    "[type: article] [site: Example & Co] [topic: Кофе ☕] A useful guide");
  assert.equal(options.credentials, "include");
  assert.equal(options.headers.Accept, "text/html,application/xhtml+xml");
});

test("HTML reads stop at the byte budget and cancel the remaining transfer", async () => {
  let pulls = 0, cancelled = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(64 * 1024).fill(120));
    },
    cancel() { cancelled++; },
  }, { highWaterMark: 0 });
  const response = new Response(body);
  response.text = () => { throw new Error("streaming responses must not read the full body"); };
  const html = await readPageContextHtml(response);
  assert.equal(encoder.encode(html).byteLength, PAGE_CONTEXT_MAX_BYTES);
  assert.equal(pulls, PAGE_CONTEXT_MAX_BYTES / (64 * 1024));
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
});

test("an oversized first chunk keeps only the prefix and does not read another chunk", async () => {
  let pulls = 0, cancelled = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(PAGE_CONTEXT_MAX_BYTES * 2).fill(97));
    },
    cancel() { cancelled++; },
  }, { highWaterMark: 0 });
  assert.equal((await readPageContextHtml(new Response(body))).length, PAGE_CONTEXT_MAX_BYTES);
  assert.equal(pulls, 1);
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
});

test("reader failure still cancels and releases the reader", async () => {
  let cancelled = 0, released = 0;
  const response = { body: { getReader: () => ({
    read: async () => { throw new Error("broken body"); },
    cancel: async () => { cancelled++; },
    releaseLock: () => { released++; },
  }) } };
  await assert.rejects(readPageContextHtml(response), /broken body/);
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});

test("error and non-HTML bodies are cancelled without reading them", async (t) => {
  let cancelled = 0, pulls = 0;
  installGlobals(t, async (url) => new Response(new ReadableStream({
    pull() { pulls++; },
    cancel() { cancelled++; },
  }, { highWaterMark: 0 }), {
    status: url.endsWith("error") ? 503 : 200,
    headers: { "content-type": url.endsWith("error") ? "text/html" : "application/json" },
  }));
  assert.equal(await fetchPageSnippet("https://pages.test/error"), "");
  assert.equal(await fetchPageSnippet("https://pages.test/json"), "");
  assert.equal(pulls, 0);
  assert.equal(cancelled, 2);
});

test("non-streaming adapters return only a bounded UTF-8 prefix and read failures fall back", async (t) => {
  const html = await readPageContextHtml({ text: async () => "λ".repeat(PAGE_CONTEXT_MAX_BYTES) });
  assert.equal(encoder.encode(html).byteLength, PAGE_CONTEXT_MAX_BYTES);
  assert.equal(await readPageContextHtml({ body: null }), "");
  installGlobals(t, async () => ({
    ok: true, headers: { get: () => "text/html" },
    text: async () => { throw new Error("unavailable"); },
  }));
  assert.equal(await fetchPageSnippet("https://pages.test/failure"), "");
});

test("snippet workers bound concurrency, preserve tab order and reuse duplicate URLs", async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let active = 0, peak = 0;
  const requested = [];
  installGlobals(t, async (url) => {
    requested.push(url);
    active++;
    peak = Math.max(peak, active);
    return new Response(new ReadableStream({
      async start(controller) {
        await gate;
        controller.enqueue(encoder.encode(`<meta name="description" content="${url}">`));
        controller.close();
        active--;
      },
    }), { headers: { "content-type": "text/html" } });
  });
  const input = tabs(31);
  input.splice(3, 0, { ...input[0], title: "Another title at the same URL" });
  input.push({ url: "about:preferences" }, { url: "" });
  const work = fetchPageSnippets(input);
  await nextTurn();
  assert.equal(requested.length, PAGE_CONTEXT_CONCURRENCY);
  assert.equal(active, PAGE_CONTEXT_CONCURRENCY);
  release();
  const snippets = await work;
  assert.equal(peak, PAGE_CONTEXT_CONCURRENCY);
  assert.equal(requested.length, 31);
  assert.deepEqual(snippets, input.map((tab) => tab.url.startsWith("https://") ? tab.url : ""));
});

for (const inherited of [false, true]) {
  test(`stopping ${inherited ? "the active" : "an explicit"} snippet run aborts requests and stops its queue`, async (t) => {
    let started = 0, aborted = 0;
    installGlobals(t, async (_url, { signal }) => {
      started++;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
        aborted++;
        reject(new DOMException("stopped", "AbortError"));
      }, { once: true }));
    });
    const controller = new AbortController();
    const session = inherited ? beginSortSession() : null;
    t.after(() => session?.dispose());
    const options = inherited ? undefined : { signal: controller.signal };
    const work = fetchPageSnippets(tabs(30), options);
    await nextTurn();
    assert.equal(started, PAGE_CONTEXT_CONCURRENCY);
    if (session) session.stop();
    else controller.abort();
    await assert.rejects(work, { name: "AbortError" });
    await nextTurn();
    assert.equal(started, PAGE_CONTEXT_CONCURRENCY);
    assert.equal(aborted, PAGE_CONTEXT_CONCURRENCY);
    await assert.rejects(fetchPageSnippets(tabs(3), options), { name: "AbortError" });
    assert.equal(started, PAGE_CONTEXT_CONCURRENCY);
  });
}

test("the page-context deadline keeps completed snippets and skips unfinished and queued URLs", async (t) => {
  const requested = [], aborted = [];
  installGlobals(t, async (url, { signal }) => {
    requested.push(url);
    if (url.endsWith("/0")) return new Response('<meta name="description" content="Useful context">', {
      headers: { "content-type": "text/html" },
    });
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
      aborted.push(url);
      reject(new DOMException("deadline", "AbortError"));
    }, { once: true }));
  });
  const input = tabs(50);
  const result = await fetchPageSnippets(input, { budgetMs: 20 });
  assert.equal(result[0], "Useful context");
  assert.deepEqual(result.slice(1), new Array(49).fill(""));
  assert.equal(requested.length, PAGE_CONTEXT_CONCURRENCY + 1);
  assert.equal(aborted.length, PAGE_CONTEXT_CONCURRENCY);
});

test("stopping during a body read cancels and releases its reader", async (t) => {
  let started, cancelled = 0, released = 0;
  const reading = new Promise((resolve) => { started = resolve; });
  installGlobals(t, async (_url, { signal }) => ({
    ok: true, headers: { get: () => "text/html" },
    body: { getReader: () => ({
      read: () => new Promise((_resolve, reject) => {
        started();
        signal.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError")), { once: true });
      }),
      cancel: async () => { cancelled++; },
      releaseLock: () => { released++; },
    }) },
  }));
  const controller = new AbortController();
  const work = fetchPageSnippet("https://pages.test/slow", { signal: controller.signal });
  await reading;
  controller.abort();
  await assert.rejects(work, { name: "AbortError" });
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});

for (const engine of ["remote", "ollama"]) {
  for (const fresh of [false, true]) {
    test(`${engine} ${fresh ? "fresh" : "existing"} classification uses bounded snippet workers`, async (t) => {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      let active = 0, peak = 0, pageCalls = 0, providerCalls = 0;
      installGlobals(t, async (url, init) => {
        if (url.startsWith("https://pages.test/")) {
          active++;
          pageCalls++;
          peak = Math.max(peak, active);
          return new Response(new ReadableStream({
            async start(controller) {
              await gate;
              controller.enqueue(encoder.encode('<meta name="description" content="Page signal">'));
              controller.close();
              active--;
            },
          }), { headers: { "content-type": "text/html" } });
        }
        assert.equal(active, 0, "classification waits for its page signals");
        providerCalls++;
        const body = JSON.parse(init.body);
        const prompt = engine === "remote" ? body.messages[0].content : body.prompt;
        const labels = Object.fromEntries([...prompt.matchAll(/^(\d+)\. /gm)].map((match) => [match[1], "skipped"]));
        return new Response(JSON.stringify(engine === "remote"
          ? { choices: [{ message: { content: JSON.stringify(labels) } }] }
          : { response: JSON.stringify(labels) }));
      });
      const input = tabs(25);
      const work = engine === "remote"
        ? fresh ? runPass2RemoteFresh(input, readySettings) : runPass2Remote(input, [{ name: "Work" }], readySettings)
        : fresh ? runPass2OllamaFresh(input) : unifiedClassifyOllama(input, [{ name: "Work" }], "http://localhost:11434", "test");
      await nextTurn();
      assert.equal(pageCalls, PAGE_CONTEXT_CONCURRENCY);
      assert.equal(providerCalls, 0);
      release();
      const plan = await work;
      assert.equal(peak, PAGE_CONTEXT_CONCURRENCY);
      assert.equal(pageCalls, input.length);
      assert.equal(providerCalls, 1);
      assert.equal(plan.skipped.length, input.length);
    });
  }
}

for (const engine of ["remote", "ollama"]) {
  test(`${engine} transport inherits active sort cancellation`, async (t) => {
    let started, aborted = 0;
    const requestStarted = new Promise((resolve) => { started = resolve; });
    installGlobals(t, async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted++;
        reject(new DOMException("stopped", "AbortError"));
      }, { once: true });
      started();
    }));
    const session = beginSortSession();
    t.after(() => session.dispose());
    const work = engine === "remote" ? providerJson(readySettings, "test")
      : ollamaGenerateJson("http://localhost:11434", "test", "test");
    await requestStarted;
    session.stop();
    await assert.rejects(work, { name: "AbortError" });
    assert.equal(aborted, 1);
  });
}

test("an explicit provider signal is independent of the active sort", async (t) => {
  let started, aborted = 0;
  const requestStarted = new Promise((resolve) => { started = resolve; });
  const explicit = new AbortController();
  installGlobals(t, async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      aborted++;
      reject(new DOMException("stopped", "AbortError"));
    }, { once: true });
    started();
  }));
  const session = beginSortSession();
  t.after(() => session.dispose());
  const work = providerJson(readySettings, "test", 4096, explicit.signal);
  await requestStarted;
  session.stop();
  assert.equal(aborted, 0);
  explicit.abort();
  await assert.rejects(work, { name: "AbortError" });
  assert.equal(aborted, 1);
});

for (const engine of ["remote", "ollama"]) {
  for (const fresh of [false, true]) {
    test(`${engine} ${fresh ? "fresh" : "existing"} orchestration propagates Stop as cancellation`, async (t) => {
      let started;
      const requestStarted = new Promise((resolve) => { started = resolve; });
      installGlobals(t, async (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError")), { once: true });
        started();
      }));
      const session = beginSortSession();
      t.after(() => session.dispose());
      const input = tabs(2).map((tab) => ({ ...tab, url: "" }));
      const work = engine === "remote"
        ? fresh ? runPass2RemoteFresh(input, readySettings) : runPass2Remote(input, [{ name: "Work" }], readySettings)
        : fresh ? runPass2OllamaFresh(input) : runPass2Ollama(input, [{ name: "Work" }]);
      await requestStarted;
      session.stop();
      await assert.rejects(work, { name: "AbortError" });
    });
  }
}
