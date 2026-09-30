import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../modules/config.mjs";
import { parseCategories, compactTab, categoryInputChunks, suggestCategories, readSavedCategories, writeSavedCategories, readJevSettings } from "../modules/jev-categories.mjs";
import { buildJevRequest, jevRequestFits, parseJevAnswers, classifyJevBatch, sortJevBatches } from "../modules/jev-provider.mjs";

const categories = [
  { name: "School", description: "Coursework, assignments, and university administration; excludes business." },
  { name: "Business", description: "Running the business, including its development; excludes coursework." },
];
const settings = { consent: true, apiKey: "test-key", model: "jev-latest", confidence: 0.5 };
const tabs = (count) => Array.from({ length: count }, (_, id) => ({ title: `Tab ${id}`, url: `https://github.com/project-${id}?token=private#secret`, _tab: { id } }));
const answer = (choice = "c0", confidence = 0.9) => ({ type: "choice", choice, confidence,
  probabilities: { c0: choice === "c0" ? 0.9 : 0.05, c1: choice === "c1" ? 0.9 : 0.05, none: choice === "none" ? 0.9 : 0.05 } });

test("decision endpoints preserve custom paths and arbitrary model IDs with no fallback", async () => {
  for (const [endpoint, model] of [
    ["https://openrouter.ai/api/v1/systemone", "typesafe/jev-1.13"],
    ["https://openrouter.ai/api/alpha/decisions", "~typesafe/jev-latest"],
    ["http://127.0.0.1:8080/custom/decide", "another/decision-model"],
  ]) {
    let calls = 0;
    const result = await classifyJevBatch(tabs(1), categories, { ...settings, endpoint, model }, undefined, async (url, init) => {
      calls++;
      assert.equal(url, endpoint);
      assert.equal(JSON.parse(init.body).model, model);
      assert.equal(init.headers.Authorization, "Bearer test-key");
      assert.equal(init.redirect, "error");
      return Response.json({ answers: { t0: answer() } });
    });
    assert.equal(calls, 1);
    assert.equal(result[0].groupName, "School");
  }
});

test("invalid decision endpoints are rejected before sending tab data", async () => {
  for (const endpoint of ["", "not a URL", "file:///tmp/api", "https://user:pass@example.com/decide", "https://example.com/decide#fragment"]) {
    let calls = 0;
    await assert.rejects(classifyJevBatch(tabs(1), categories, { ...settings, endpoint }, undefined, async () => { calls++; }));
    assert.equal(calls, 0);
  }
});

test("category metadata excludes URL credentials, query strings, fragments and live tab objects", () => {
  // Given
  const tab = { ...tabs(1)[0], url: "https://user:pass@example.com/course?token=private#secret", currentGroup: "School" };
  // When
  const metadata = compactTab(tab, 0);
  // Then
  assert.deepEqual(metadata, { id: "t0", title: "Tab 0", path: "example.com/course", group: "School" });
});

test("300 compact tabs all participate in one category suggestion request", async () => {
  // Given
  const input = tabs(300), requests = [];
  // When
  const result = await suggestCategories(input, [], async (request) => { requests.push(request); return { categories }; });
  // Then
  assert.equal(requests.length, 1);
  assert.equal(categoryInputChunks(input)[0].length, 300);
  assert.deepEqual(result.map((category) => category.name), ["School", "Business"]);
});

test("large category inputs preserve every tab while bounding each chunk", () => {
  // Given
  const input = tabs(1200).map((tab) => ({ ...tab, title: "長".repeat(500) }));
  // When
  const chunks = categoryInputChunks(input);
  // Then
  assert.ok(chunks.length > 1);
  assert.equal(chunks.flat().length, 1200);
  assert.ok(chunks.every((chunk) => JSON.stringify(chunk).length <= 80000));
});

test("category parser rejects duplicate names and missing descriptions", () => {
  // Given / When / Then
  assert.throws(() => parseCategories([categories[0], { ...categories[0], name: " SCHOOL " }]));
  assert.throws(() => parseCategories([{ name: "School" }]));
  assert.throws(() => parseCategories(Array.from({ length: 11 }, (_, i) => ({ name: String(i), description: "Category" }))));
});

test("saved categories are isolated by workspace and automatic preview defaults off", () => {
  // Given
  const values = new Map();
  const prefs = { getStringPref: (key, fallback) => values.get(key) ?? fallback, setStringPref: (key, value) => values.set(key, value), getBoolPref: (_, fallback) => fallback };
  // When
  writeSavedCategories(prefs, "school", [categories[0]]);
  writeSavedCategories(prefs, "work", [categories[1]]);
  // Then
  assert.equal(readSavedCategories(prefs, "school")[0].name, "School");
  assert.equal(readSavedCategories(prefs, "work")[0].name, "Business");
  assert.equal(readJevSettings(prefs).preview, false);
  assert.equal(readJevSettings(prefs).source, "reuse");
  assert.equal(readJevSettings(prefs).endpoint, "https://api.typesafe.ai/v1/systemone");
  values.set(CONFIG.AI_JEV_ENDPOINT_PREF, " https://openrouter.ai/api/v1/systemone ");
  values.set(CONFIG.AI_JEV_MODEL_PREF, "typesafe/jev-1.13");
  assert.equal(readJevSettings(prefs).endpoint, "https://openrouter.ai/api/v1/systemone");
  assert.equal(readJevSettings(prefs).model, "typesafe/jev-1.13");
  assert.equal(values.has(CONFIG.AI_JEV_API_KEY_PREF), false);
});

test("batched Jev questions select from described categories plus none", () => {
  // Given
  const input = tabs(30);
  // When
  const request = buildJevRequest(input, categories);
  // Then
  assert.equal(request.state.tabs.length, 30);
  assert.equal(Object.keys(request.questions).length, 30);
  assert.equal(request.questions.t29.type, "choice");
  assert.deepEqual(Object.keys(request.questions.t29.criteria), ["c0", "c1", "none"]);
});

test("uncertain, missing, malformed and out-of-taxonomy answers preserve their tabs", () => {
  // Given
  const input = tabs(7);
  const response = { answers: { t0: answer(), t1: answer("c1", 0.2), t2: answer("none"),
    t4: { ...answer(), choice: "injected" }, t5: { ...answer(), probabilities: { c0: 1 } },
    t6: { ...answer("c1"), choice: "c0" } } };
  // When
  const results = parseJevAnswers(response, input, categories);
  // Then
  assert.deepEqual(results.map((result) => result.status), ["assigned", "skipped", "skipped", "unresolved", "unresolved", "unresolved", "unresolved"]);
  assert.equal(results[0].groupName, "School");
  assert.ok(results.slice(1).every((result) => result.groupName === null));
  assert.deepEqual(results.map((result) => result.tabInfo), input);
});

test("Jev authentication failure stops after one request and omits raw provider text", async () => {
  // Given
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response("test-key sensitive page contents", { status: 401 }); };
  // When / Then
  await assert.rejects(classifyJevBatch(tabs(1), categories, settings, undefined, fetchImpl), { message: "Decision provider HTTP 401" });
  assert.equal(calls, 1);
});

test("Jev cannot send tab metadata without consent", async () => {
  // Given
  let calls = 0;
  // When / Then
  await assert.rejects(classifyJevBatch(tabs(1), categories, { ...settings, consent: false }, undefined, () => { calls++; }));
  assert.equal(calls, 0);
});

test("Stop aborts the Jev fetch and preserves a typed cancellation", async () => {
  // Given
  const controller = new AbortController();
  const fetchImpl = (_, init) => new Promise((_, reject) => { init.signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError"))); controller.abort(); });
  // When / Then
  await assert.rejects(classifyJevBatch(tabs(1), categories, settings, controller.signal, fetchImpl), { name: "AbortError" });
});

test("300 tabs apply progressively in ten batches with original tab references", async () => {
  // Given
  const input = tabs(300), applied = [], progress = [], calls = [];
  // When
  const result = await sortJevBatches({ tabs: input, categories, settings, isCurrent: () => true,
    classify: async (batch) => { calls.push(batch.length); return batch.map((tabInfo) => ({ tabInfo, groupName: "School", status: "assigned" })); },
    applyBatch: (batch) => { applied.push(...batch.map((result) => result.tabInfo)); return batch.length; }, onProgress: (event) => progress.push(event.processed),
  });
  // Then
  assert.deepEqual(calls, Array(10).fill(30));
  assert.deepEqual(applied, input);
  assert.deepEqual(progress, [30, 60, 90, 120, 150, 180, 210, 240, 270, 300]);
  assert.equal(result.moved, 300);
});

test("a manual edit during a request prevents applying its stale batch", async () => {
  // Given
  let current = true, applied = 0;
  // When / Then
  await assert.rejects(sortJevBatches({ tabs: tabs(30), categories, settings, isCurrent: () => current,
    classify: async (batch) => { current = false; return batch.map((tabInfo) => ({ tabInfo, groupName: "School", status: "assigned" })); },
    applyBatch: () => applied++,
  }), /changed/);
  assert.equal(applied, 0);
});

test("long non-Latin metadata reduces batch size within Jev's context limits", async () => {
  // Given
  const input = tabs(80).map((tab) => ({ ...tab, title: "学".repeat(180), currentGroup: "学".repeat(80) }));
  const taxonomy = Array.from({ length: 10 }, (_, index) => ({ name: `Category ${index}`, description: "学".repeat(600) }));
  const batches = [];
  // When
  const result = await sortJevBatches({ tabs: input, categories: taxonomy, settings, isCurrent: () => true,
    classify: async (batch) => {
      batches.push(batch.length); assert.equal(jevRequestFits(buildJevRequest(batch, taxonomy)), true);
      return batch.map((tabInfo) => ({ tabInfo, groupName: null, status: "skipped" }));
    }, applyBatch: () => 0,
  });
  // Then
  assert.ok(batches.some((count) => count < 30));
  assert.equal(result.processed, 80);
  assert.equal(result.skipped, 80);
});

test("Stop after the first batch retains completed moves and makes no further requests", async () => {
  // Given
  const controller = new AbortController(); let calls = 0, applied = 0;
  // When / Then
  await assert.rejects(sortJevBatches({ tabs: tabs(300), categories, settings, signal: controller.signal, isCurrent: () => true,
    classify: async (batch) => { calls++; return batch.map((tabInfo) => ({ tabInfo, groupName: "School", status: "assigned" })); },
    applyBatch: (batch) => { applied += batch.length; return batch.length; }, onProgress: () => controller.abort(),
  }), { name: "AbortError" });
  assert.equal(calls, 1); assert.equal(applied, 30);
});
