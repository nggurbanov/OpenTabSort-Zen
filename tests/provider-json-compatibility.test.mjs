import test from "node:test";
import assert from "node:assert/strict";
import { providerJson } from "../modules/remote-provider.mjs";

const settings = { provider: "custom", format: "openai", endpoint: "https://api.example.test/v1", model: "fixture", apiKey: "private-fixture-key" };
const withResponse = async (t, envelope, run) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response(JSON.stringify(envelope), { headers: { "content-type": "application/json" } });
  await run();
};

test("an explanatory wrapper around one complete JSON answer remains usable", async (t) => {
  await withResponse(t, { choices: [{ message: { content: 'Here are the groups:\n```json\n{"groups":[{"name":"Build","tabs":[0,1]}]}\n```\nDone.' }, finish_reason: "stop" }] }, async () => {
    assert.deepEqual(await providerJson(settings, "fixture"), { groups: [{ name: "Build", tabs: [0, 1] }] });
  });
});

test("braces inside strings and discarded reasoning do not confuse answer extraction", async (t) => {
  await withResponse(t, { choices: [{ message: { content: '<think>Consider {this} carefully.</think>\n{"label":"Braces { inside } and \\\"quotes\\\"","tabs":[0]}' }, finish_reason: "stop" }] }, async () => {
    assert.deepEqual(await providerJson(settings, "fixture"), { label: 'Braces { inside } and "quotes"', tabs: [0] });
  });
});

test("multiple distinct JSON answers are rejected instead of selecting an arbitrary plan", async (t) => {
  await withResponse(t, { choices: [{ message: { content: '{"groups":[{"name":"A","tabs":[0]}]}\n{"groups":[{"name":"B","tabs":[0]}]}' }, finish_reason: "stop" }] }, async () => {
    await assert.rejects(providerJson(settings, "fixture"), /non-JSON|ambiguous/i);
  });
});

test("a token-limited provider answer exposes the actual limit failure even with a valid partial object", async (t) => {
  await withResponse(t, { choices: [{ message: { content: '{"groups":[{"name":"Partial","tabs":[0]}]}' }, finish_reason: "length" }] }, async () => {
    await assert.rejects(providerJson(settings, "fixture"), /output limit/i);
  });
});

test("an HTTP 200 provider error is reported without exposing its echoed key or content", async (t) => {
  await withResponse(t, { error: { code: 429, message: "private-fixture-key and private-tab-content" } }, async () => {
    await assert.rejects(providerJson(settings, "fixture"), (error) => {
      assert.equal(error.status, 429);
      assert.match(error.message, /429/);
      assert.doesNotMatch(error.message, /private-fixture-key|private-tab-content/);
      return true;
    });
  });
});

test("truncated JSON, arrays and plain prose never become a partial usable plan", async (t) => {
  for (const content of ['{"groups":[{"name":"unfinished"', '[{"name":"array"}]', 'No answer is available.']) {
    await withResponse(t, { choices: [{ message: { content }, finish_reason: "stop" }] }, async () => {
      await assert.rejects(providerJson(settings, "fixture"), /non-JSON|non-object/i);
    });
  }
});
