import test from "node:test";
import assert from "node:assert/strict";
import { runScenario } from "./helpers/sort-handler-scenarios.mjs";
const run = (scenario) => runScenario("primary-" + scenario, { primary: true });

for (const scenario of ["off", "missing-consent"]) {
  test(`unconfigured ${scenario} opens AI setup without planning, loading rules or touching tabs`, () => {
    const result = run(scenario);
    assert.equal(result.setupCalls, 1);
    assert.equal(result.plannerCalls, 0);
    assert.equal(result.requests, 0);
    assert.equal(result.ruleLoads, 0);
    assert.equal(result.apply, 0);
    assert.equal(result.mutations, 0);
    assert.deepEqual(result.imports, []);
    assert.equal(result.rulesPreserved, true);
    assert.equal(result.advancedPreserved, true);
  });
}

test("the main action uses the entire workspace and ignores preserved legacy rules/modes without review", () => {
  const result = run("success");
  assert.equal(result.ruleLoads, 0);
  assert.equal(result.pass1Calls, 0);
  assert.equal(result.plannerCalls, 1);
  assert.equal(result.plannedCount, 1);
  assert.equal(result.apply, 1);
  assert.deepEqual(result.appliedRules, []);
  assert.equal(result.applyOptions.workspaceAI, true);
  assert.equal(result.applyOptions.persistRules, false);
  assert.equal(result.modalCalls, 0);
  assert.equal(result.rulesPreserved, true);
    assert.equal(result.advancedPreserved, true);
  assert.equal(result.records, 1);
});

for (const scenario of ["review-cancel", "review-apply"]) {
  test(`explicit ${scenario} is the only gate before native workspace application`, () => {
    const result = run(scenario);
    assert.equal(result.modalCalls, 1);
    assert.equal(result.apply, scenario === "review-apply" ? 1 : 0);
    assert.equal(result.rulesPreserved, true);
    assert.equal(result.advancedPreserved, true);
    assert.equal(result.observersLeft, 0);
  });
}

for (const scenario of ["skip-changed", "provider-changed", "consent-revoked", "tabs-changed", "stop-during-provider", "stop-before-provider"]) {
  test(`primary ${scenario} leaves the layout untouched`, () => {
    const result = run(scenario);
    assert.equal(result.apply, 0);
    assert.equal(result.mutations, 0);
    assert.equal(result.records, 0);
    assert.equal(result.requests, scenario === "stop-before-provider" ? 0 : 1);
    assert.equal(result.rulesPreserved, true);
    assert.equal(result.advancedPreserved, true);
    assert.equal(result.observersLeft, 0);
    assert.equal(result.activeSignal, false);
    assert.match(result.finishes.at(-1).message, /unchanged/);
  });
}

test("a running main AI action blocks the advanced legacy action", () => {
  const result = run("lock");
  assert.equal(result.plannerCalls, 1);
  assert.equal(result.legacyCalls, 0);
  assert.ok(result.toasts.some((message) => /already running/.test(message)));
});

test("a running advanced legacy action blocks the main AI action", () => {
  const result = run("legacy-lock");
  assert.equal(result.legacyCalls, 1);
  assert.equal(result.plannerCalls, 0);
  assert.ok(result.toasts.some((message) => /already running/.test(message)));
});


for (const scenario of ["jev-unready", "jev-category-unready"]) {
  test(`AI setup handles ${scenario} before importing the decision engine`, () => {
    const result = run(scenario);
    assert.equal(result.setupCalls, 1);
    assert.equal(result.requests, 0);
    assert.deepEqual(result.imports, []);
    assert.equal(result.apply, 0);
    assert.equal(result.advancedPreserved, true);
  });
}

for (const scenario of ["jev-ready", "jev-review"]) {
  test(`main ${scenario} always discovers categories and obeys only the new review preference`, () => {
    const result = run(scenario);
    assert.deepEqual(result.jevOptions, { source: "suggest", review: scenario === "jev-review", persistCategories: false });
    assert.deepEqual(result.imports, ["./jev-sort.mjs"]);
    assert.equal(result.advancedPreserved, true);
    assert.equal(result.ruleLoads, 0);
  });
}

test("Local workspace AI receives all tabs and an empty rules list without loading remote planning", () => {
  const result = run("local");
  assert.deepEqual(result.localRules, []);
  assert.deepEqual(result.imports, ["./ai.mjs"]);
  assert.equal(result.plannerCalls, 1);
  assert.equal(result.apply, 1);
  assert.equal(result.advancedPreserved, true);
});


test("a failed provider exposes useful recovery without mutating any tabs", () => {
  const result = run("provider-failure");
  assert.equal(result.apply, 0); assert.equal(result.mutations, 0);
  assert.equal(result.requests, 1); assert.equal(result.records, 0);
  assert.match(result.finishes.at(-1).message, /access was rejected.*key/i);
  assert.doesNotMatch(result.finishes.at(-1).message, /layout is unchanged.*connection/i);
  assert.equal(result.observersLeft, 0); assert.equal(result.activeSignal, false);
});
