import test from "node:test";
import assert from "node:assert/strict";
import { captureTabSnapshot, isTabSnapshotCurrent, validateAIPlan, reserveNewGroupNames } from "../modules/sort-plan.mjs";
const tab = (title) => ({ title, url: `https://example.test/${title}`, currentGroup: null, _tab: { isConnected: true, closest: () => null } });
test("plans are invalidated by navigation, regrouping, tab closure, or order changes", () => {
  const tabs = [tab("one"), tab("two")];
  const snapshot = captureTabSnapshot(tabs);
  assert.equal(isTabSnapshotCurrent(snapshot, tabs), true);
  assert.equal(isTabSnapshotCurrent(snapshot, [...tabs].reverse()), false);
  for (const changed of [{ url: "https://example.test/other" }, { title: "new title" }, { currentGroup: "Other" }]) {
    assert.equal(isTabSnapshotCurrent(snapshot, [{ ...tabs[0], ...changed }, tabs[1]]), false);
  }
  tabs[0]._tab.isConnected = false;
  assert.equal(isTabSnapshotCurrent(snapshot, tabs), false);
});
test("apply rejects duplicate and foreign live-tab references before any mutation", () => {
  const tabs = [tab("one"), tab("two")];
  const plan = { assignedToExisting: [{ tabInfo: tabs[0], groupName: "Reading" }], newGroups: [{ name: "Work", tabs: [tabs[1]] }] };
  assert.doesNotThrow(() => validateAIPlan(plan, tabs));
  plan.newGroups[0].tabs = [tabs[0]];
  assert.throws(() => validateAIPlan(plan, tabs), /duplicate/);
  plan.newGroups[0].tabs = [tab("foreign")];
  assert.throws(() => validateAIPlan(plan, tabs), /Invalid/);
});
test("new names reserve Unicode-equivalent existing rules and other proposals", () => {
  const plan = { newGroups: [{ name: "Cafe\u0301" }, { name: "CAFÉ" }, { name: "読み物" }] };
  reserveNewGroupNames(plan, ["Café", "読み物"]);
  assert.deepEqual(plan.newGroups.map((group) => group.name), ["Cafe\u0301 (2)", "CAFÉ (3)", "読み物 (2)"]);
});
test("renaming an early collision never steals a later proposed name", () => {
  const plan = { newGroups: [{ name: "Work", tabs: [] }, { name: "Work (2)", tabs: [] }] };
  reserveNewGroupNames(plan, ["Work"]);
  assert.deepEqual(plan.newGroups.map((group) => group.name), ["Work (3)", "Work (2)"]);
});
