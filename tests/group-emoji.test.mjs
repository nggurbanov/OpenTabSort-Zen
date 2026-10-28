import test from "node:test";
import assert from "node:assert/strict";
import { groupEmoji, stripGroupEmoji, uniqueGroupLabels, canonicalizeGroupNames } from "../modules/group-emoji.mjs";

test("duplicate provider emoji and icons reserved by untouched groups get distinct replacements", () => {
  const labels = uniqueGroupLabels(["💻 Work", "💻 Reading", "Design"], ["💼 Manual"]);
  const icons = labels.map((label) => groupEmoji(label)[0]);
  assert.equal(new Set(icons).size, 3);
  assert.equal(icons.includes("💼"), false);
  assert.deepEqual(labels.map(stripGroupEmoji), ["Work", "Reading", "Design"]);
  assert.deepEqual(uniqueGroupLabels(labels, ["💼 Manual"]), labels);
});
test("variation selectors and skin tones do not masquerade as distinct icons", () => {
  const labels = uniqueGroupLabels(["✈️ Travel", "✈ Trips", "👍🏻 One", "👍🏿 Two"]);
  const normalized = labels.map((label) => groupEmoji(label)[0].replace(/[\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}]/gu, ""));
  assert.equal(new Set(normalized).size, labels.length);
});
test("off removes full emoji sequences without damaging numbers or multilingual names", () => {
  assert.deepEqual(uniqueGroupLabels(["👩🏽‍💻 Разработка 2026", "🇹🇷 Türkçe", "1️⃣ Releases v2", "Cafe ☕"], [], false), ["Разработка 2026", "Türkçe", "Releases v2", "Cafe"]);
});
test("hundreds of groups stay unique and stable beyond the small preferred palette", () => {
  const names = Array.from({ length: 500 }, (_, index) => `Topic ${index}`);
  const labels = uniqueGroupLabels(names);
  assert.equal(new Set(labels.map((name) => groupEmoji(name)[0])).size, names.length);
  assert.deepEqual(uniqueGroupLabels(labels), labels);
});
test("plain or changed emoji names reuse exact native targets without mutating a provider plan", () => {
  const plan = { assignedToExisting: [{ groupName: "Work", tabInfo: {} }], newGroups: [{ name: "🚀 Reading", tabs: [{}] }] };
  const result = canonicalizeGroupNames(plan, ["💻 Work", "📚 Reading"]);
  assert.equal(result.assignedToExisting[0].groupName, "💻 Work");
  assert.equal(result.newGroups[0].name, "📚 Reading");
  assert.equal(plan.newGroups[0].name, "🚀 Reading");
  assert.equal(result.newGroups[0].tabs, plan.newGroups[0].tabs);
});
test("ambiguous plain names are not routed to an arbitrary existing group", () => {
  const plan = { assignedToExisting: [], newGroups: [{ name: "Work", tabs: [] }] };
  assert.equal(canonicalizeGroupNames(plan, ["💻 Work", "💼 Work"]).newGroups[0].name, "Work");
});

test("common topic hints supply meaningful icons when the provider supplies none", () => {
  assert.deepEqual(uniqueGroupLabels(["Work", "Разработка", "Research", "Finance"]).map((label) => groupEmoji(label)[0]), ["💼", "💻", "📚", "💰"]);
});
