import test from "node:test";
import assert from "node:assert/strict";
import { normalizeNameForDedupe, findNameCollisionBuckets, resolveNameCollisions, ensureUniqueGroupNames } from "../modules/dedupe.mjs";

const group = (name, hostname, centroid = [1, 0]) => ({ name, tabs: [{ hostname }], centroid });
const resolve = (groups, options = {}) => resolveNameCollisions(groups, { getCentroid: (entry) => entry.centroid, threshold: 0.7, ...options });

test("Non-Latin names retain distinct topic keys and canonical accents compare equally", () => {
  assert.equal(normalizeNameForDedupe("仕事"), "仕事");
  assert.equal(normalizeNameForDedupe("旅行"), "旅行");
  assert.equal(normalizeNameForDedupe("Café Tools"), normalizeNameForDedupe("CAFE\u0301 Apps"));
  assert.equal(resolve([group("仕事", "example.com"), group("旅行", "example.com")]).length, 2);
});

test("Empty topic keys cannot merge unrelated emoji or punctuation groups", () => {
  const groups = [group("📚", "example.com"), group("🎵", "example.com"), group("!!!", "example.com")];
  assert.equal(findNameCollisionBuckets(groups).length, 3);
  assert.equal(resolve(groups, { noCentroidAction: "merge", getCentroid: () => null }).length, 3);
});

test("Singleton and merged anchors reserve persisted names with Unicode/case normalization", () => {
  assert.deepEqual(resolve([group("Reading", "github.com")], { existingNames: ["READING"] }).map((entry) => entry.name), ["Reading (Github)"]);
  const merged = resolve([group("Café", "example.com"), group("Cafe\u0301", "example.com")], { existingNames: ["CAFÉ"] });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].tabs.length, 2);
  assert.equal(merged[0].name, "Café (Example)");
});

test("Disambiguation preserves proposal order and never steals a later reserved name", () => {
  const result = resolve([group("Reading", "github.com"), group("Reading", "books.com", [0, 1]), group("Dev", "gitlab.com")]);
  assert.deepEqual(result.map((entry) => entry.name), ["Reading", "Reading (Books)", "Dev"]);
  const names = ensureUniqueGroupNames([group("Reading", "books.com"), group("Reading (Books)", "books.com")], ["Reading", "READING (2)"]);
  assert.deepEqual(names.map((entry) => entry.name), ["Reading (3)", "Reading (Books)"]);
});
