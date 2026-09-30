import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../modules/config.mjs";
import { getAIEngine, getAISortMode, loadRules, persistAIRules, readRulesPref, sanitizeRules, validateRules } from "../modules/rules.mjs";

test("intentional empty rules and editor drafts survive load/import without falling back", async () => {
  const previousServices = globalThis.Services;
  const previousFetch = globalThis.fetch;
  let raw = "[]";
  globalThis.Services = { prefs: { getStringPref: () => raw } };
  globalThis.fetch = () => { throw new Error("explicit rules must not fetch defaults"); };
  try {
    assert.deepEqual(await loadRules(), []);
    const draft = { name: "", domains: ["draft.test"], titleTerms: [], icon: "custom:draft" };
    raw = JSON.stringify([draft, { name: "Later", domains: [] }]);
    assert.equal((await loadRules()).length, 2);
    assert.equal(sanitizeRules(JSON.parse(raw)).length, 2);
    assert.deepEqual(readRulesPref(), []);
    assert.equal(validateRules({ rules: JSON.parse(raw) }).length, 2);
    raw = "";
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ rules: [{ name: "File", domains: ["file.test"] }] }) });
    assert.equal((await loadRules())[0].name, "File");
  } finally {
    globalThis.Services = previousServices;
    globalThis.fetch = previousFetch;
  }
});

test("AI additions preserve stored drafts, rich rule metadata, and current editor terms", () => {
  const previousServices = globalThis.Services;
  const stored = [
    { name: "", domains: ["draft.test"], titleTerms: [], icon: "custom:draft" },
    { name: "Work", domains: ["edited.test"], titleTerms: ["Edited"], color: "#123456", color2: "#654321", icon: "custom:work", matchOrder: [{ type: "title", value: "Edited" }] },
    { name: "Named draft", domains: [], titleTerms: [], icon: "📚" },
  ];
  let raw = JSON.stringify(stored);
  globalThis.Services = { prefs: {
    getStringPref: () => raw,
    setStringPref: (name, value) => { assert.equal(name, CONFIG.RULES_PREF); raw = value; },
  } };
  try {
    persistAIRules([
      { name: "Work", domains: ["ai.test"], titleTerms: ["AI"], color: "#ffffff" },
      { name: "Named draft", domains: ["books.test"] },
      { name: "New", domains: [], titleTerms: ["New term"] },
    ]);
    const result = JSON.parse(raw);
    assert.deepEqual(result[0], stored[0]);
    assert.deepEqual(result[1], { ...stored[1], domains: ["edited.test", "ai.test"], titleTerms: ["Edited", "AI"] });
    assert.deepEqual(result[2], { ...stored[2], domains: ["books.test"] });
    assert.equal(result[3].name, "New");
  } finally {
    globalThis.Services = previousServices;
  }
});

test("remote engine and sorting mode preferences remain recognized and bounded", () => {
  const previousServices = globalThis.Services;
  let engine;
  let mode;
  globalThis.Services = { prefs: { getStringPref: (name) => name === CONFIG.AI_ENGINE_PREF ? engine : mode } };
  try {
    for (engine of ["local", "ollama", "openai", "gemini", "custom"]) assert.equal(getAIEngine(), engine);
    engine = "unknown";
    assert.equal(getAIEngine(), "off");
    for (mode of ["rules-first", "hybrid", "full-ai"]) assert.equal(getAISortMode(), mode);
    mode = "unknown";
    assert.equal(getAISortMode(), "rules-first");
  } finally {
    globalThis.Services = previousServices;
  }
});
