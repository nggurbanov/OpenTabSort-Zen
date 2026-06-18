import test from "node:test";
import assert from "node:assert/strict";

const eligibleTabs = [
  { id: 1, hostname: "github.com", title: "Pull request", currentGroup: null },
  { id: 2, hostname: "news.ycombinator.com", title: "Hacker News", currentGroup: null },
  { id: 3, hostname: "developer.mozilla.org", title: "MDN", currentGroup: "Reading" },
];

const tabIds = (tabs) => tabs.map((tab) => tab.id);

const makePass1 = ({ unmatchedIds = [2] } = {}) => {
  const byId = new Map(eligibleTabs.map((tab) => [tab.id, tab]));
  const unmatched = unmatchedIds.map((id) => ({ ...byId.get(id), group: null }));
  const unmatchedSet = new Set(unmatchedIds);
  const assignments = eligibleTabs.map((tab) => ({
    ...tab,
    group: unmatchedSet.has(tab.id) ? null : tab.id === 1 ? "Dev" : "Reading",
  }));
  const byGroup = new Map([
    ["Dev", assignments.filter((tab) => tab.group === "Dev")],
    ["Reading", assignments.filter((tab) => tab.group === "Reading" && tab.currentGroup !== "Reading")],
  ]);
  const alreadyCorrect = assignments.filter((tab) => tab.group && tab.group === tab.currentGroup);

  return { assignments, byGroup, unmatched, alreadyCorrect };
};

test("Given full-ai sorting mode When resolving the plan Then rules are not applied and every eligible tab goes to AI", async () => {
  const { resolveSortingPlan } = await import("../modules/sorting-mode.mjs");

  const plan = resolveSortingPlan({
    mode: "full-ai",
    tabs: eligibleTabs,
    pass1: makePass1(),
  });

  assert.equal(plan.shouldApplyPass1, false);
  assert.deepEqual(plan.pass1ByGroup, new Map());
  assert.deepEqual(tabIds(plan.tabsForAI), [1, 2, 3]);
});

test("Given hybrid sorting mode When resolving plans on repeated runs Then rules apply first and only that run's unmatched tabs go to AI", async () => {
  const { resolveSortingPlan } = await import("../modules/sorting-mode.mjs");

  const firstRun = resolveSortingPlan({
    mode: "hybrid",
    tabs: eligibleTabs,
    pass1: makePass1({ unmatchedIds: [2] }),
  });
  const secondRun = resolveSortingPlan({
    mode: "hybrid",
    tabs: eligibleTabs,
    pass1: makePass1({ unmatchedIds: [3] }),
  });

  assert.equal(firstRun.shouldApplyPass1, true);
  assert.deepEqual(firstRun.pass1ByGroup, makePass1({ unmatchedIds: [2] }).byGroup);
  assert.deepEqual(tabIds(firstRun.tabsForAI), [2]);

  assert.equal(secondRun.shouldApplyPass1, true);
  assert.deepEqual(secondRun.pass1ByGroup, makePass1({ unmatchedIds: [3] }).byGroup);
  assert.deepEqual(tabIds(secondRun.tabsForAI), [3]);
});

test("Given no sorting mode preference When resolving the plan Then back-compat rules-first behavior sends only unmatched tabs to AI", async () => {
  const { resolveSortingPlan } = await import("../modules/sorting-mode.mjs");
  const pass1 = makePass1({ unmatchedIds: [2] });

  const plan = resolveSortingPlan({
    tabs: eligibleTabs,
    pass1,
  });

  assert.equal(plan.mode, "rules-first");
  assert.equal(plan.shouldApplyPass1, true);
  assert.deepEqual(plan.pass1ByGroup, pass1.byGroup);
  assert.deepEqual(tabIds(plan.tabsForAI), [2]);
});

test("Given persisted full-ai mode but AI engine is off When resolving effective mode Then rules-first still runs", async () => {
  const { resolveEffectiveSortingMode, resolveSortingPlan } = await import("../modules/sorting-mode.mjs");
  const pass1 = makePass1({ unmatchedIds: [2] });
  const effectiveMode = resolveEffectiveSortingMode({ aiEngine: "off", preferredMode: "full-ai" });

  const plan = resolveSortingPlan({
    mode: effectiveMode,
    tabs: eligibleTabs,
    pass1,
  });

  assert.equal(effectiveMode, "rules-first");
  assert.equal(plan.shouldApplyPass1, true);
  assert.deepEqual(plan.pass1ByGroup, pass1.byGroup);
  assert.deepEqual(tabIds(plan.tabsForAI), [2]);
});

test("Given full-ai sorting mode When resolving Pass 2 apply options Then rule persistence is disabled", async () => {
  const { resolvePass2ApplyOptions } = await import("../modules/sorting-mode.mjs");

  assert.deepEqual(resolvePass2ApplyOptions("full-ai"), {
    existingBehavior: "transient",
    newGroupBehavior: "transient",
    persistRules: false,
  });
  assert.deepEqual(resolvePass2ApplyOptions("hybrid"), {});
  assert.deepEqual(resolvePass2ApplyOptions("rules-first"), {});
});
