import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../modules/config.mjs";
import { runPass2, runPass2Fresh, applyPass2 } from "../modules/ai.mjs";
import { matchesTitle, runPass1 } from "../modules/pass1.mjs";

const makeGroup = (name, tabs = []) => ({
  isConnected: true,
  getAttribute: (key) => key === "label" ? name : null,
  hasAttribute: () => false,
  querySelector: () => null,
  querySelectorAll: () => tabs,
  style: { setProperty() {}, removeProperty() {} },
});

const installEnvironment = (t, groups = []) => {
  const previous = new Map(["Services", "document", "window", "gBrowser", "ChromeUtils", "fetch"].map((key) => [key, globalThis[key]]));
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  const prefs = new Map();
  const writes = [];
  const embeddingInputs = [];
  const fetched = [];
  const events = [];
  globalThis.Services = { prefs: {
    getStringPref: (key, fallback = "") => prefs.get(key) ?? fallback,
    getBoolPref: () => true,
    setBoolPref() {},
    setStringPref: (key, value) => { prefs.set(key, value); writes.push({ key, value }); },
  } };
  globalThis.document = {
    querySelectorAll: () => groups,
    querySelector: (selector) => groups.find((group) => selector.includes(`label="${group.getAttribute("label")}"`)) || null,
  };
  globalThis.window = { gZenWorkspaces: { activeWorkspaceElement: { tabsContainer: { firstChild: null } } } };
  globalThis.gBrowser = {
    moveTabToExistingGroup: (tab, group) => events.push({ type: "move", tab, group }),
    ungroupTab: (tab) => events.push({ type: "ungroup", tab }),
    addTabGroup: (tabs, options) => { events.push({ type: "create", tabs, options }); return makeGroup(options.label, tabs); },
  };
  globalThis.ChromeUtils = {
    embeddingRun: async (request) => {
      embeddingInputs.push(request);
      const text = request.args[0][0];
      return { data: text.includes("Shopping") ? new Float32Array([0, 1]) : new Float32Array([1, 0]), dims: [1, 2] };
    },
    importESModule: () => ({ createEngine: async () => ({ run: (request) => globalThis.ChromeUtils.embeddingRun(request) }) }),
  };
  globalThis.fetch = async (url) => {
    fetched.push(url);
    const type = url.includes("shop") ? "product" : "article";
    return { ok: true, headers: { get: () => "text/html" }, text: async () => `<meta property="og:type" content="${type}">` };
  };
  return { prefs, writes, embeddingInputs, fetched, events };
};

const info = (id, title, path, group = null) => ({
  id, title, hostname: "example.com", url: `https://example.com/${path}`,
  _tab: {
    isConnected: true,
    closest: () => group,
    getAttribute: (key) => key === "label" ? title : null,
    querySelector: () => null,
    linkedBrowser: { currentURI: { spec: `https://example.com/${path}` } },
  },
});

test("Fresh separates different page intents on one host and preserves each page's snippet", async (t) => {
  const env = installEnvironment(t);
  const tabs = [info(1, "Reading guide", "read/1"), info(2, "Shopping item", "shop/1"), info(3, "Reading article", "read/2"), info(4, "Shopping catalog", "shop/2")];
  const result = await runPass2Fresh(tabs, [], "workspace");
  assert.deepEqual(result.newGroups.map((group) => [group.name, group.tabs.map((tab) => tab.id)]), [["Reading", [1, 3]], ["Shopping", [2, 4]]]);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(env.fetched, tabs.map((tab) => tab.url));
  assert.equal(env.embeddingInputs.length, 4);
  for (const request of env.embeddingInputs) {
    assert.deepEqual(request.options, { pooling: "mean", normalize: true });
    assert.equal(typeof request.args[0][0], "string");
    assert.match(request.args[0][0], request.args[0][0].includes("Shopping") ? /\[type: product\]/ : /\[type: article\]/);
  }
});

test("Large-workspace existing-group fit keeps same-host page intent and duplicate tabs", async (t) => {
  const readingTab = info(1000, "Reading seed", "read/seed")._tab;
  const shoppingTab = info(1001, "Shopping seed", "shop/seed")._tab;
  const groups = [makeGroup("Reading", [readingTab]), makeGroup("Shopping", [shoppingTab])];
  const env = installEnvironment(t, groups);
  const tabs = Array.from({ length: CONFIG.AI_LOCAL_CHUNK_THRESHOLD + 1 }, (_, index) => info(index, index % 2 ? "Shopping item" : "Reading guide", index % 2 ? "shop/1" : "read/1"));
  const result = await runPass2(tabs, [{ name: "Reading" }, { name: "Shopping" }], "workspace");
  assert.equal(result.assignedToExisting.length, tabs.length);
  for (const assignment of result.assignedToExisting) {
    assert.equal(assignment.groupName, assignment.tabInfo.id % 2 ? "Shopping" : "Reading");
  }
  assert.equal(env.embeddingInputs.length, 4);
  assert.deepEqual(result.newGroups, []);
  assert.deepEqual(result.skipped, []);
});

test("Local fits unmatched tabs into projected rule groups before any DOM group exists", async (t) => {
  const env = installEnvironment(t);
  const tabs = [info(1, "Reading seed", "read/seed"), info(2, "Shopping seed", "shop/seed"), info(3, "Reading guide", "read/1"), info(4, "Shopping item", "shop/1")];
  tabs[0].currentGroup = "Shopping";
  tabs[1].currentGroup = "Reading";
  const rules = [{ name: "Reading", domains: [], titleTerms: ["Reading seed"] }, { name: "Shopping", domains: [], titleTerms: ["Shopping seed"] }];
  const pass1 = runPass1(tabs, rules);
  const result = await runPass2(pass1.unmatched, rules, "workspace", { projectedAssignments: pass1.assignments });
  assert.deepEqual(result.assignedToExisting.map((entry) => [entry.tabInfo.id, entry.groupName]), [[3, "Reading"], [4, "Shopping"]]);
  assert.deepEqual(result.newGroups, []);
  assert.deepEqual(result.skipped, []);
  assert.equal(env.embeddingInputs.length, 4);
  assert.deepEqual(env.events, []);
  assert.deepEqual(env.writes, []);
});

test("Projected membership excludes unmatched tab references and overrides stale DOM seeds", async (t) => {
  const staleSeed = info(100, "Shopping stale seed", "shop/stale")._tab;
  const env = installEnvironment(t, [makeGroup("Reading", [staleSeed])]);
  const seed = { ...info(1, "Reading seed", "read/seed"), group: null, currentGroup: "Reading" };
  const unmatched = { ...info(2, "Shopping item", "shop/1"), group: null, currentGroup: "Reading" };
  const rules = [{ name: "Reading", domains: [], titleTerms: ["Reading seed"] }];
  const result = await runPass2([unmatched], rules, "workspace", { projectedAssignments: [seed, unmatched] });
  assert.deepEqual(result.assignedToExisting, []);
  assert.deepEqual(result.skipped, [unmatched]);
  assert.equal(env.embeddingInputs.length, 2);
  assert.ok(env.embeddingInputs.every((request) => !request.args[0][0].includes("stale")));
  assert.deepEqual(env.events, []);
});

test("Fresh reserves rule and live group names before showing proposals", async (t) => {
  installEnvironment(t, [makeGroup("Shopping")]);
  const tabs = [info(1, "Reading guide", "read/1"), info(2, "Reading article", "read/2"), info(3, "Shopping item", "shop/1"), info(4, "Shopping catalog", "shop/2")];
  const result = await runPass2Fresh(tabs, [{ name: "reading", domains: [] }], "workspace");
  assert.deepEqual(result.newGroups.map((group) => group.name), ["Reading (Example)", "Shopping (Example)"]);
});

test("Full AI transient apply moves tabs without changing or persisting any rules or title patches", (t) => {
  const existing = makeGroup("Reading");
  const env = installEnvironment(t, [existing]);
  const rules = [{ name: "Reading", domains: ["seed.test"], titleTerms: ["Café"], color: "blue" }];
  const before = structuredClone(rules);
  const result = applyPass2({
    assignedToExisting: [{ groupName: "Reading", tabInfo: info(1, "Reading guide", "read/1") }],
    newGroups: [{ name: "Shopping", tabs: [info(2, "Shopping item", "shop/1", existing)] }],
    rulePatches: [{ groupName: "Reading", titleTerms: [{ term: "Recipes" }] }, { groupName: "New title rule", titleTerms: [{ term: "Watches" }] }],
  }, "workspace", rules, { existingBehavior: "transient", newGroupBehavior: "transient", persistRules: false });
  assert.deepEqual(rules, before);
  assert.deepEqual(env.writes, []);
  assert.deepEqual(env.events.map((event) => event.type), ["move", "ungroup", "create"]);
  assert.equal(result.movedToExisting, 1);
  assert.equal(result.newGroupsCreated, 1);
  assert.equal(result.rulesGrown + result.titleTermsGrown + result.newRulesCreated, 0);
});

test("Reviewed title learning keeps Unicode terms and incomplete drafts while adding only new terms", (t) => {
  const env = installEnvironment(t);
  const rules = [{ name: "Reading", domains: [], titleTerms: ["Café"], matchOrder: [{ type: "title", value: "Café" }] }];
  env.prefs.set(CONFIG.RULES_PREF, JSON.stringify([...rules, { name: "", domains: [], titleTerms: [] }]));
  const result = applyPass2({ assignedToExisting: [], newGroups: [], rulePatches: [{ groupName: "READING", titleTerms: [{ term: "CAFE\u0301" }, { term: "料理" }] }] }, "workspace", rules, { existingBehavior: "transient", newGroupBehavior: "transient" });
  assert.equal(result.titleTermsGrown, 1);
  const stored = JSON.parse(env.prefs.get(CONFIG.RULES_PREF));
  assert.deepEqual(stored[0].titleTerms, ["Café", "料理"]);
  assert.deepEqual(stored[0].matchOrder, rules[0].matchOrder);
  assert.equal(stored[1].name, "");
  assert.equal(matchesTitle("CAFE\u0301 recipes", "Café"), true);
  assert.equal(matchesTitle("今日の料理", "料理"), true);
});

test("A tab closed during preview cannot grow a rule at apply time", (t) => {
  const env = installEnvironment(t, [makeGroup("Reading")]);
  const rules = [{ name: "Reading", domains: ["seed.test"], titleTerms: [] }];
  const closed = info(1, "Reading guide", "read/1");
  closed._tab.isConnected = false;
  const result = applyPass2({ assignedToExisting: [{ groupName: "Reading", tabInfo: closed }], newGroups: [] }, "workspace", rules, { existingBehavior: "always-add", newGroupBehavior: "auto-add" });
  assert.equal(result.movedToExisting, 0);
  assert.equal(result.rulesGrown, 0);
  assert.deepEqual(env.events, []);
  assert.deepEqual(env.writes, []);
  assert.deepEqual(rules[0].domains, ["seed.test"]);
});

test("Fresh derives shared content words across different pages on one hostname", async (t) => {
  installEnvironment(t);
  const result = await runPass2Fresh([info(1, "Cooking recipe", "cooking/1"), info(2, "Cooking dinner", "cooking/2")], [], "workspace");
  assert.deepEqual(result.newGroups.map((group) => group.name), ["Cooking Reading"]);
});
