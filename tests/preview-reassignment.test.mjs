import test from "node:test";
import assert from "node:assert/strict";
import { sanitizePreviewReassignment, showPreviewModal } from "../modules/preview-modal.mjs";

test("reassignment uses pending live references once and retains incomplete results", () => {
  const tabs = [0, 1, 2].map((id) => ({ id, _tab: {} }));
  const result = sanitizePreviewReassignment(tabs, { assignments: [
    { tabInfo: { ...tabs[0] }, groupName: "work" },
    { tabInfo: tabs[0], groupName: "Other" },
    { tabInfo: { id: tabs[1].id, _tab: {} }, groupName: "Work" },
    { tabInfo: tabs[1], groupName: { name: "Work" } },
    { tabInfo: tabs[2], groupName: "Unknown" },
  ], skipped: [tabs[1], tabs[2]] }, { allowedNames: ["Work", "Other"] });
  assert.deepEqual(result.assignments, [{ tabInfo: tabs[0], groupName: "Work" }]);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.unresolved, tabs.slice(1));
  const groups = sanitizePreviewReassignment(tabs, { newGroups: [
    { name: "work", tabs: [tabs[0], tabs[0], { id: 1 }] },
    { name: "work", tabs: [tabs[1]] },
  ] }, { newGroups: true, reservedNames: ["Work", "Work (2)"] });
  assert.deepEqual(groups.newGroups.map((g) => g.name), ["work (3)", "work (4)"]);
  assert.deepEqual(groups.newGroups.map((g) => g.tabs), [[tabs[0]], [tabs[1]]]);
  assert.deepEqual(groups.skipped, []);
  assert.deepEqual(groups.unresolved, [tabs[2]]);
  const explicitSkip = sanitizePreviewReassignment(tabs, { skipped: [tabs[1]], unresolved: [tabs[2]], failed: "HTTP 401" });
  assert.deepEqual(explicitSkip.skipped, [tabs[1]]);
  assert.deepEqual(explicitSkip.unresolved, [tabs[0], tabs[2]]);
  assert.equal(explicitSkip.failed, "HTTP 401");
});

class Element {
  children = [];
  listeners = new Map();
  className = "";
  disabled = false;
  textContent = "";
  get firstChild() { return this.children[0]; }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  setAttribute() {}
  showModal() {}
  close() {}
  focus() {}
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  async click() { for (const listener of this.listeners.get("click") || []) await listener({ target: this, stopPropagation() {} }); }
}

const find = (node, predicate) => predicate(node) ? node : node.children.map((child) => find(child, predicate)).find(Boolean);

for (const kind of ["new", "planned", "existing"]) {
  test(`${kind} reassignment preserves title review choices and every pending original`, async () => {
    const previousDocument = globalThis.document;
    const body = new Element();
    globalThis.document = { body, createElementNS: () => new Element() };
    const [keptTab, pending, unresolved] = [0, 1, 2].map((id) => ({ hostname: `h${id}.test`, _tab: {} }));
    try {
      const completion = showPreviewModal({
        plan: { newGroups: [{ name: "Work", tabs: [keptTab] }], assignedToExisting: [], skipped: [pending], unresolved: [unresolved], failed: "Partial response", rulePatches: [{ groupName: "Work", titleTerms: [{ term: "Alpha" }, { term: "Beta" }] }] },
        existingNames: ["Work"],
        onReassignToNew: async () => ({ newGroups: [{ name: "Work", tabs: [pending, pending, { _tab: {} }] }] }),
        onAssignToPlanned: async () => ({ assignments: [{ tabInfo: pending, groupName: "Work" }, { tabInfo: pending, groupName: "Work" }] }),
        onAssignToExisting: async () => ({ assignments: [{ tabInfo: pending, groupName: "work" }, { tabInfo: pending, groupName: "Work" }] }),
      });
      await find(body, (el) => el.className.includes("zao-preview-title-chip")).click();
      await find(body, (el) => el.textContent === `Re-assign to ${kind}`).click();
      await find(body, (el) => el.textContent === "Apply").click();
      const result = await completion;
      assert.deepEqual(result.rulePatches[0].titleTerms.map((item) => item.term), ["Beta"]);
      assert.deepEqual(result.skipped, []);
      assert.deepEqual(result.unresolved, [unresolved]);
      assert.equal(result.failed, "Partial response");
      const assigned = [...result.newGroups.flatMap((group) => group.tabs), ...result.assignedToExisting.map((assignment) => assignment.tabInfo), ...result.skipped, ...result.unresolved];
      assert.equal(assigned.length, 3);
      assert.equal(new Set(assigned.map((tab) => tab._tab)).size, 3);
      if (kind === "new") assert.equal(result.newGroups[1].name, "Work (2)");
      assert.equal(body.children.length, 0);
    } finally {
      globalThis.document = previousDocument;
    }
  });
}

test("Apply preserves failed originals separately from user-unkept groups", async () => {
  const previousDocument = globalThis.document;
  const body = new Element();
  globalThis.document = { body, createElementNS: () => new Element() };
  const dropped = { hostname: "drop.test", _tab: {} };
  const failed = { hostname: "failed.test", _tab: {} };
  try {
    const completion = showPreviewModal({ plan: {
      newGroups: [{ name: "Drop", tabs: [dropped] }], assignedToExisting: [], skipped: [],
      unresolved: [failed], failed: "HTTP 401",
    } });
    await find(body, (el) => el.textContent === "Drop (1)").parent.parent.click();
    await find(body, (el) => el.textContent === "Apply").click();
    const result = await completion;
    assert.deepEqual(result.skipped, [dropped]);
    assert.deepEqual(result.unresolved, [failed]);
    assert.equal(result.failed, "HTTP 401");
  } finally {
    globalThis.document = previousDocument;
  }
});
