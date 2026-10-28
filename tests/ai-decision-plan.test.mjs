import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../modules/config.mjs";
import { planDecisionWorkspace } from "../modules/ai-decision-plan.mjs";
import { validateAIPlan } from "../modules/sort-plan.mjs";
import { beginSortSession } from "../modules/sort-session.mjs";

const categories = [
  { name: "Build", description: "Building and maintaining software; excludes general reading." },
  { name: "Reading", description: "Research and articles to read; excludes active implementation." },
];
const makeTabs = (count) => Array.from({ length: count }, (_, index) => ({
  id: 7, title: `Tab ${index}`, url: `https://pages.test/project/${index}`, hostname: "pages.test", currentGroup: null,
  _tab: { isConnected: true, identity: index, closest: () => null },
}));
const choice = (name = "c0", confidence = 0.9) => ({ type: "choice", choice: name, confidence,
  probabilities: { c0: name === "c0" ? 0.9 : 0.05, c1: name === "c1" ? 0.9 : 0.05, none: name === "none" ? 0.9 : 0.05 } });
const categoryResponse = (value = categories) => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ categories: value }) } }] });
const decisionResponse = (body, decide = () => choice()) => Response.json({ answers: Object.fromEntries(
  body.state.tabs.map((tab, index) => ["t" + index, decide(tab, index)])) });
const suggestionRows = (prompt) => JSON.parse(prompt.split("Consider the entire tab list, including its current groups:\n")[1].split("\nExisting categories:")[0]);
const install = (t, fetchImpl) => {
  const previous = new Map(["fetch", "Services", "window", "ChromeUtils", "gBrowser", "document"].map((name) => [name, globalThis[name]]));
  const values = new Map([
    [CONFIG.AI_ENGINE_PREF, "jev"], [CONFIG.AI_PROVIDER_CONSENT_PREF, true],
    [CONFIG.AI_JEV_ENDPOINT_PREF, "https://decision.example.test/v1/systemone"],
    [CONFIG.AI_JEV_API_KEY_PREF, "decision-test-credential"], [CONFIG.AI_JEV_MODEL_PREF, "decision-test"],
    [CONFIG.AI_JEV_CATEGORY_PROVIDER_PREF, "custom"], [CONFIG.AI_CUSTOM_ENDPOINT_PREF, "https://openrouter.ai/api/v1"],
    [CONFIG.AI_CUSTOM_FORMAT_PREF, "openai"], [CONFIG.AI_CUSTOM_API_KEY_PREF, "category-test-credential"],
    [CONFIG.AI_CUSTOM_MODEL_PREF, "inception/mercury-3-20261019"],
    // Primary planning must ignore preserved Advanced categories and source.
    [CONFIG.AI_JEV_CATEGORY_SOURCE_PREF, "manual"], [CONFIG.AI_JEV_CATEGORIES_PREF, "saved categories must never be read"],
  ]);
  const observers = new Set(), requests = [], writes = [];
  globalThis.window = {};
  const prefs = { PREF_STRING: 32, PREF_BOOL: 128, PREF_INT: 64,
    getStringPref: (name, fallback = "") => {
      assert.notEqual(name, CONFIG.AI_JEV_CATEGORIES_PREF, "Primary planner must not read saved categories");
      return values.get(name) ?? fallback;
    },
    getBoolPref: (name, fallback = false) => values.get(name) ?? fallback,
    getPrefType: (name) => values.has(name) ? typeof values.get(name) === "boolean" ? 128 : 32 : 0,
    setStringPref: (...args) => { writes.push(args); assert.fail("Planning must not persist rules/categories"); },
    addObserver: (_prefix, observer) => observers.add(observer), removeObserver: (_prefix, observer) => observers.delete(observer),
  };
  globalThis.Services = { prefs };
  globalThis.ChromeUtils = { importESModule: () => assert.fail("Decision planning must not load embedding models") };
  globalThis.gBrowser = new Proxy({}, { get: () => assert.fail("Planning must not read or mutate native tab layout") });
  globalThis.document = new Proxy({}, { get: () => assert.fail("Planning must not create UI or mutate the DOM") });
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, init, body });
    assert.ok(String(url).startsWith("https://openrouter.ai/api/v1/") || url === "https://decision.example.test/v1/systemone", "Only configured providers may receive metadata");
    return await fetchImpl(url, init, body);
  };
  t.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
  });
  return { requests, values, writes, observers };
};
const isDecision = (url) => url === "https://decision.example.test/v1/systemone";

test("300 Decision tab identities share fresh categories and buffered batches without native moves or saved category writes", async (t) => {
  const input = makeTabs(300), widths = [], ids = [], taxonomyIds = [];
  input[0].currentGroup = "Ｂｕｉｌｄ";
  const env = install(t, async (url, init, body) => {
    if (!isDecision(url)) {
      assert.equal(body.max_tokens, 65536);
      assert.match(body.messages[0].content, /Existing categories: \[\]/);
      taxonomyIds.push(...suggestionRows(body.messages[0].content).map((row) => row.id));
      return categoryResponse();
    }
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(body.model, "decision-test");
    widths.push(body.state.tabs.length);
    ids.push(...body.state.tabs.map((row) => row.title));
    return decisionResponse(body, (row) => choice(Number(row.title.split(" ")[1]) % 2 ? "c1" : "c0"));
  });
  const plan = await planDecisionWorkspace(input);
  assert.equal(env.requests.length, 11);
  assert.deepEqual(taxonomyIds, input.map((_, index) => "t" + index));
  assert.deepEqual(ids, input.map((tab) => tab.title));
  assert.deepEqual(widths, Array(10).fill(30));
  assert.equal(plan.assignedToExisting.length, 150);
  assert.ok(plan.assignedToExisting.every((entry) => entry.groupName === "Ｂｕｉｌｄ"));
  assert.deepEqual(plan.newGroups.map((group) => [group.name, group.tabs.length]), [["Reading", 150]]);
  const planned = [...plan.assignedToExisting.map((entry) => entry.tabInfo), ...plan.newGroups.flatMap((group) => group.tabs)];
  assert.equal(new Set(planned).size, 300);
  assert.ok(planned.every((tab) => input.includes(tab)));
  assert.deepEqual(plan.skipped, []);
  assert.deepEqual(plan.unresolved, []);
  assert.equal(plan.failed, undefined);
  assert.doesNotThrow(() => validateAIPlan(plan, input));
  assert.deepEqual(env.writes, []);
});

test("both providers receive sanitized compact metadata without credentials, URL queries/fragments, controls or live tab objects", async (t) => {
  const input = makeTabs(2);
  Object.assign(input[0], { title: "Tab\u0000 \u202ePrivate", currentGroup: "Group\u0001\u2066Work", url: "https://user:password@pages.test/course?token=private#fragment" });
  input[1].url = "file:///private/document.txt";
  const bodies = [];
  install(t, async (url, _init, body) => {
    bodies.push(body);
    return isDecision(url) ? decisionResponse(body) : categoryResponse();
  });
  const plan = await planDecisionWorkspace(input);
  assert.equal(plan.failed, undefined);
  const wire = JSON.stringify(bodies);
  assert.doesNotMatch(wire, /user:|password|token=|fragment|_tab|identity|file:\/\/\/|\\u0000|\\u0001|\\u202e|\\u2066/);
  const rows = bodies[1].state.tabs;
  assert.equal(rows[0].title, "Tab Private");
  assert.equal(rows[0].group, "Group Work");
  assert.equal(rows[0].path, "pages.test/course");
  assert.equal(rows[1].path, "");
  assert.equal(plan.newGroups[0].tabs[0], input[0]);
});

test("complete none and low-confidence answers are valid skips, including an all-skipped workspace", async (t) => {
  install(t, async (url, _init, body) => isDecision(url)
    ? decisionResponse(body, (_, index) => index % 2 ? choice("c1", 0.2) : choice("none")) : categoryResponse());
  const input = makeTabs(31);
  const plan = await planDecisionWorkspace(input);
  assert.deepEqual(plan.skipped, input);
  assert.deepEqual(plan.unresolved, []);
  assert.deepEqual(plan.assignedToExisting, []);
  assert.deepEqual(plan.newGroups, []);
  assert.equal(plan.failed, undefined);
});

for (const failure of ["missing-answer", "invalid-probabilities", "http-auth", "network"]) {
  test(`a later ${failure} discards every buffered Decision assignment`, async (t) => {
    let batches = 0;
    const env = install(t, async (url, _init, body) => {
      if (!isDecision(url)) return categoryResponse();
      batches++;
      if (batches === 2) {
        if (failure === "http-auth") return new Response("decision-test-credential private response", { status: 401 });
        if (failure === "network") throw new TypeError("decision-test-credential private network failure");
        const response = await decisionResponse(body).json();
        if (failure === "missing-answer") delete response.answers.t0;
        else response.answers.t0.probabilities = { c0: 1 };
        return Response.json(response);
      }
      return decisionResponse(body);
    });
    const input = makeTabs(70), plan = await planDecisionWorkspace(input);
    assert.equal(batches, 2);
    assert.equal(env.requests.length, 3);
    assert.ok(plan.failed);
    assert.doesNotMatch(plan.failed, /decision-test-credential|private response|private network/);
    assert.deepEqual(plan.assignedToExisting, []);
    assert.deepEqual(plan.newGroups, []);
    assert.deepEqual(plan.skipped, []);
    assert.deepEqual(plan.unresolved, input);
  });
}

for (const failure of ["consent", "decision-key", "category-model", "endpoint"]) {
  test(`invalid ${failure} stops before either provider receives tab data`, async (t) => {
    const env = install(t, () => assert.fail("Invalid settings must not send tab metadata"));
    if (failure === "consent") env.values.set(CONFIG.AI_PROVIDER_CONSENT_PREF, false);
    if (failure === "decision-key") env.values.set(CONFIG.AI_JEV_API_KEY_PREF, "");
    if (failure === "category-model") env.values.set(CONFIG.AI_CUSTOM_MODEL_PREF, "");
    if (failure === "endpoint") env.values.set(CONFIG.AI_JEV_ENDPOINT_PREF, "https://user:secret@decision.example.test/v1/systemone");
    const input = makeTabs(2), plan = await planDecisionWorkspace(input);
    assert.ok(plan.failed);
    assert.equal(env.requests.length, 0);
    assert.deepEqual(plan.unresolved, input);
    assert.deepEqual(plan.newGroups, []);
  });
}

test("invalid fresh categories never start Decision requests", async (t) => {
  const env = install(t, () => categoryResponse([{ name: "No description" }]));
  const input = makeTabs(2), plan = await planDecisionWorkspace(input);
  assert.equal(env.requests.length, 1);
  assert.ok(plan.failed);
  assert.deepEqual(plan.unresolved, input);
  assert.deepEqual(plan.newGroups, []);
});

for (const stage of ["before", "categories", "decision"]) {
  test(`parent cancellation ${stage} propagates as AbortError and stops the remaining queue`, async (t) => {
    const controller = new AbortController();
    const env = install(t, async (url, init, body) => {
      if ((stage === "categories" && !isDecision(url)) || (stage === "decision" && isDecision(url))) {
        return await new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
          controller.abort();
        });
      }
      return isDecision(url) ? decisionResponse(body) : categoryResponse();
    });
    if (stage === "before") controller.abort();
    await assert.rejects(planDecisionWorkspace(makeTabs(70), { signal: controller.signal }), { name: "AbortError" });
    assert.equal(env.requests.length, stage === "before" ? 0 : stage === "categories" ? 1 : 2);
  });
}

test("session checkpoints reject changed settings before buffering a completed provider response and report planning progress", async (t) => {
  let current = true;
  const progress = [];
  const env = install(t, async (url, _init, body) => {
    if (!isDecision(url)) return categoryResponse();
    current = false;
    return decisionResponse(body);
  });
  const session = beginSortSession({ isCurrent: () => current, onProgress: (stage) => progress.push(stage) });
  try {
    await assert.rejects(planDecisionWorkspace(makeTabs(70)), { name: "AbortError" });
    assert.equal(env.requests.length, 2);
    assert.match(progress[0], /Finding topics/);
    assert.equal(session.signal.aborted, true);
  } finally { session.dispose(); }
  assert.equal(env.observers.size, 0);
});

test("large inventories include every original tab in category discovery and retain identity through reduced request widths", async (t) => {
  const input = makeTabs(550).map((tab, index) => ({ ...tab, title: `Tab ${index} ` + "長".repeat(170), currentGroup: "Old ".repeat(20), url: tab.url + "/" + "p".repeat(180) }));
  const taxonomy = [], classified = [], widths = [];
  const wideCategories = Array.from({ length: 10 }, (_, index) => ({ name: `Topic ${index}`, description: "Scope ".repeat(100), examples: ["Example ".repeat(27), "Second ".repeat(27), "Third ".repeat(27)] }));
  let reductions = 0;
  install(t, async (url, _init, body) => {
    if (!isDecision(url)) {
      const prompt = body.messages[0].content;
      if (prompt.includes("Merge these partial category suggestions")) reductions++;
      else taxonomy.push(...suggestionRows(prompt).map((row) => row.title));
      return categoryResponse(wideCategories);
    }
    widths.push(body.state.tabs.length);
    classified.push(...body.state.tabs.map((row) => row.title));
    const options = [...body.state.categories.map((category) => category.id), "none"];
    return decisionResponse(body, () => ({ type: "choice", choice: "c0", confidence: 0.9,
      probabilities: Object.fromEntries(options.map((option) => [option, option === "c0" ? 0.9 : 0.1 / (options.length - 1)])) }));
  });
  const plan = await planDecisionWorkspace(input);
  assert.equal(plan.failed, undefined);
  assert.equal(taxonomy.length, input.length);
  assert.equal(classified.length, input.length);
  assert.deepEqual(classified, taxonomy);
  assert.ok(reductions > 0);
  assert.ok(widths.every((width) => width < 30));
  assert.equal(plan.newGroups[0].tabs.length, input.length);
  assert.equal(new Set(plan.newGroups[0].tabs).size, input.length);
});

test("an empty workspace sends no requests", async (t) => {
  const env = install(t, () => assert.fail("Empty workspace must not send requests"));
  assert.deepEqual(await planDecisionWorkspace([]), { assignedToExisting: [], newGroups: [], skipped: [], unresolved: [] });
  assert.equal(env.requests.length, 0);
});
