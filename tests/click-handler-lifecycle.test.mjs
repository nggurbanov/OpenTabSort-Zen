import test from "node:test";
import assert from "node:assert/strict";
import { runScenario } from "./helpers/sort-handler-scenarios.mjs";

for (const scenario of ["skip-changed", "provider-changed", "consent-revoked", "tabs-changed", "stop-during-provider"]) {
  test(`the real handler applies nothing after ${scenario}`, () => {
    const result = runScenario(scenario);
    assert.equal(result.requests, 1);
    assert.equal(result.apply, 0);
    assert.equal(result.mutations, 0);
    assert.equal(result.records, 0);
    assert.equal(result.requestsAfterAbort, 0);
    assert.equal(result.aborted, true);
    assert.equal(result.observersLeft, 0);
    assert.equal(result.activeSignal, false);
    assert.match(result.finishes.at(-1).message, /No sorting changes were applied/);
  });
}

test("Stop during lazy provider loading prevents even the first request", () => {
  const result = runScenario("stop-before-provider");
  assert.equal(result.requests, 0);
  assert.equal(result.apply, 0);
  assert.equal(result.mutations, 0);
  assert.equal(result.observersLeft, 0);
});

test("Stop while reviewing an AI plan prevents application", () => {
  const result = runScenario("stop-in-preview");
  assert.equal(result.requests, 1);
  assert.equal(result.modalCalls, 1);
  assert.equal(result.apply, 0);
  assert.equal(result.mutations, 0);
  assert.equal(result.observersLeft, 0);
});

test("rules-only sorting never imports any AI engine and still completes application", () => {
  const result = runScenario("rules-only");
  assert.deepEqual(result.imports, []);
  assert.equal(result.requests, 0);
  assert.equal(result.apply, 1);
  assert.equal(result.records, 1);
  assert.equal(result.observersLeft, 0);
  assert.equal(result.activeSignal, false);
});

test("a successful remote run imports its selected provider and creates an Undo receipt", () => {
  const result = runScenario("success");
  assert.deepEqual(result.imports, ["./remote-provider.mjs"]);
  assert.equal(result.requests, 1);
  assert.equal(result.apply, 1);
  assert.equal(result.records, 1);
  assert.equal(result.finishes.at(-1).canUndo, true);
  assert.deepEqual(result.errors, []);
});
