import test from "node:test";
import assert from "node:assert/strict";
import { sortFailureNotice } from "../modules/sort-failure.mjs";

for (const [reason, code, match] of [
  ["HTTP 401", "access", /key/], ["HTTP 402", "credits", /credits/],
  ["HTTP 404", "model", /model not found/], ["HTTP 429", "busy", /moment/],
  ["HTTP 400", "configuration", /model/], ["HTTP 503", "provider", /unavailable/],
  ["Provider timeout after 120000ms", "timeout", /too long/],
  ["Provider response reached its output limit", "output-limit", /cut short/],
  ["Provider network request failed", "connection", /reach AI/],
  ["Provider returned non-JSON content", "response", /incomplete groups/],
  ["Each category needs a unique name", "response", /incomplete groups/],
]) test("failure feedback names the recovery for " + reason, () => {
  const result = sortFailureNotice(new Error(reason));
  assert.equal(result.code, code); assert.match(result.message, match);
});

test("provider messages never reach visible failure text", () => {
  const result = sortFailureNotice("private-api-key https://private.example/?token=sensitive");
  assert.equal(result.code, "unknown");
  assert.doesNotMatch(result.message, /private|sensitive|https/);
});

test("on-device errors do not falsely direct users to fix a remote key", () => {
  assert.equal(sortFailureNotice("Embeddings unavailable", "local").code, "local");
});
