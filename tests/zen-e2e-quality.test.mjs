import test from "node:test";
import assert from "node:assert/strict";

import { familyForPromptText } from "../scripts/zen-e2e-fixtures.mjs";
import { scoreZenQuality } from "../scripts/zen-e2e-quality.mjs";

test("Given label-agnostic predicted groups When scored Then quality follows tab membership", () => {
  const goldTabs = [
    { id: "work-1", family: "WORK" },
    { id: "work-2", family: "WORK" },
    { id: "docs-1", family: "DOCS" },
    { id: "docs-2", family: "DOCS" },
    { id: "shop-1", family: "SHOP" },
  ];
  const predictedGroups = [
    { label: "Whatever Alpha", tabs: ["work-1", "work-2"] },
    { label: "Wrong But Coherent", tabs: ["docs-1", "docs-2"] },
    { label: "Singleton", tabs: ["shop-1"] },
  ];

  const score = scoreZenQuality({ tabCount: goldTabs.length, goldTabs, predictedGroups });

  assert.equal(score.groupedTabs, 5);
  assert.equal(score.weightedPurity, 1);
  assert.equal(score.weightedRecall, 1);
  assert.equal(score.f1, 1);
  assert.equal(score.singletonRate, 0.2);
  assert.equal(score.coherentGroupRate, 1);
  assert.equal(score.groupCount, 3);
  assert.equal(score.familyCount, 3);
  assert.equal(score.maxGroupCount, 4);
  assert.equal(score.pass, true);
});

test("Given fragmented and mixed predicted groups When scored Then the pass threshold fails", () => {
  const goldTabs = [
    { id: "work-1", family: "WORK" },
    { id: "work-2", family: "WORK" },
    { id: "docs-1", family: "DOCS" },
    { id: "docs-2", family: "DOCS" },
  ];
  const predictedGroups = [
    { label: "Mixed", tabs: ["work-1", "docs-1"] },
    { label: "Lonely", tabs: ["work-2"] },
  ];

  const score = scoreZenQuality({ tabCount: goldTabs.length, goldTabs, predictedGroups });

  assert.equal(score.groupedTabs, 3);
  assert.equal(score.pass, false);
  assert.ok(score.f1 < 0.9);
});

test("Given duplicated predicted tab memberships When scored Then the quality gate fails", () => {
  const goldTabs = [
    { id: "work-1", family: "WORK" },
    { id: "work-2", family: "WORK" },
    { id: "docs-1", family: "DOCS" },
  ];
  const predictedGroups = [
    { label: "Work", tabs: ["work-1", "work-2"] },
    { label: "Nested Work", tabs: ["work-1"] },
    { label: "Docs", tabs: ["docs-1"] },
  ];

  const score = scoreZenQuality({ tabCount: goldTabs.length, goldTabs, predictedGroups });

  assert.equal(score.groupedTabs, 3);
  assert.equal(score.duplicateTabCount, 1);
  assert.equal(score.duplicateMembershipCount, 1);
  assert.equal(score.pass, false);
  assert.ok(score.weightedPurity <= 1);
  assert.ok(score.f1 <= 1);
});

test("Given unknown predicted tabs When scored Then the quality gate fails", () => {
  const goldTabs = [{ id: "work-1", family: "WORK" }];
  const predictedGroups = [{ label: "Work", tabs: ["work-1", "ghost-1"] }];

  const score = scoreZenQuality({ tabCount: goldTabs.length, goldTabs, predictedGroups });

  assert.equal(score.groupedTabs, 1);
  assert.equal(score.unknownTabCount, 1);
  assert.equal(score.pass, false);
});

test("Given pure but fragmented predicted groups When scored Then recall and group-count gates fail", () => {
  const goldTabs = Array.from({ length: 12 }, (_, index) => ({ id: `work-${index}`, family: "WORK" }));
  const predictedGroups = [
    { label: "Work", tabs: goldTabs.slice(0, 4).map((tab) => tab.id) },
    { label: "Work Management", tabs: goldTabs.slice(4, 8).map((tab) => tab.id) },
    { label: "Project Management", tabs: goldTabs.slice(8).map((tab) => tab.id) },
  ];

  const score = scoreZenQuality({ tabCount: goldTabs.length, goldTabs, predictedGroups });

  assert.equal(score.weightedPurity, 1);
  assert.equal(score.weightedRecall, 0.333333);
  assert.equal(score.groupCount, 3);
  assert.equal(score.familyCount, 1);
  assert.equal(score.maxGroupCount, 2);
  assert.equal(score.pass, false);
});

test("Given social community tab text When fake provider maps it Then community is not mistaken for communication", () => {
  const family = familyForPromptText("social.localhost", "Forum profile feed community thread");

  assert.equal(family, "SOCIAL");
});
