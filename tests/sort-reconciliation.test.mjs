import test from "node:test";
import assert from "node:assert/strict";
import { captureTabSnapshot, validateAIPlan } from "../modules/sort-plan.mjs";
import { createSnapshotReconciler } from "../modules/sort-reconciliation.mjs";

const group = (label) => ({ localName: "tab-group", label, getAttribute(name) { return name === "label" ? this.label : null; },
  contains(ref) { return ref.group === this; } });
const fixture = (count = 5) => {
  const refs = Array.from({ length: count }, (_, index) => ({ isConnected: true, group: null, linkedBrowser: {},
    url: `https://pages.test/${index}`, title: `Tab ${index}`, closest() { return this.group; } }));
  const read = (items = refs) => items.filter((ref) => ref.isConnected && !ref.pinned).map((ref) => ({
    _tab: ref, url: ref.url, title: ref.title, currentGroup: ref.group?.label || null,
  }));
  const tabs = read();
  const snapshot = captureTabSnapshot(tabs);
  const plan = { assignedToExisting: [], newGroups: [{ name: "Work", tabs }], skipped: [], unresolved: [] };
  return { refs, tabs, snapshot, plan, read, tracker: createSnapshotReconciler(snapshot) };
};
const assignments = (plan) => [...plan.assignedToExisting.map((entry) => entry.tabInfo._tab), ...plan.newGroups.flatMap((group) => group.tabs.map((tab) => tab._tab))];
const reconcile = (f, current = f.read()) => {
  validateAIPlan(f.plan, f.tabs);
  const result = f.tracker.reconcile(f.plan, current, f.tabs);
  validateAIPlan(result.plan, current);
  return result;
};

test("background title, favicon and loading updates keep all original assignments", () => {
  const f = fixture();
  f.refs[0].title = "(1) A page title after loading";
  f.tracker.onTabChange({ type: "TabAttrModified", target: f.refs[0], detail: { changed: ["label", "image", "busy"] } });
  const result = reconcile(f);
  assert.deepEqual(assignments(result.plan), f.refs);
  assert.equal(result.changedCount, 0);
});

test("inserted and closed tabs do not invalidate surviving identities or their projected order", () => {
  const f = fixture();
  const added = { ...f.refs[0], url: "https://new.test/", linkedBrowser: {} };
  f.refs[1].isConnected = false;
  const live = f.read([added, ...f.refs]);
  f.tracker.onTabChange({ type: "TabOpen", target: added });
  f.tracker.onTabChange({ type: "TabClose", target: f.refs[1] });
  const result = reconcile(f, live);
  assert.deepEqual(assignments(result.plan), f.refs.filter((ref) => ref.isConnected));
  assert.ok(!assignments(result.plan).includes(added));
  assert.equal(result.changedCount, 1);
  assert.equal(result.plan.unresolved.length, 0);
});

test("navigation, pinning and regrouping protect only affected tabs", () => {
  const f = fixture(6);
  f.refs[0].url = "https://pages.test/new-document";
  f.refs[1].pinned = true;
  f.refs[2].group = group("Manual group");
  f.tracker.onTabChange({ type: "TabGrouped", target: f.refs[2] });
  const result = reconcile(f);
  assert.deepEqual(assignments(result.plan), f.refs.slice(3));
  assert.equal(result.changedCount, 3);
  assert.deepEqual(result.plan.unresolved.map((tab) => tab._tab), f.refs.slice(0, 3));
});

test("a recorded drag protects its actual target without excluding every shifted neighbor", () => {
  const f = fixture();
  f.tracker.onTabChange({ type: "TabMove", target: f.refs[0] });
  const current = f.read([...f.refs.slice(1), f.refs[0]]);
  const result = reconcile(f, current);
  assert.deepEqual(assignments(result.plan), f.refs.slice(1));
  assert.equal(result.changedCount, 1);
});

test("without a native move event, an ambiguous reorder conservatively protects every displaced reference", () => {
  const f = fixture();
  const result = reconcile(f, f.read([f.refs[1], f.refs[0], ...f.refs.slice(2)]));
  assert.deepEqual(assignments(result.plan), f.refs.slice(2));
  assert.equal(result.changedCount, 2);
});

test("dragging an entire group protects its members and prevents adding other tabs to that group", () => {
  const f = fixture();
  const movedGroup = group("Work");
  f.refs[0].group = movedGroup; f.refs[1].group = movedGroup;
  const initial = f.read(); f.snapshot = captureTabSnapshot(initial); f.tracker = createSnapshotReconciler(f.snapshot);
  f.tracker.onTabChange({ type: "TabMove", target: movedGroup });
  const result = f.tracker.reconcile(f.plan, f.read([...f.refs.slice(2), ...f.refs.slice(0, 2)]), f.tabs);
  assert.deepEqual(assignments(result.plan), []);
  assert.equal(result.changedCount, f.refs.length);
});

test("renamed original groups retain user intent and are not reused as AI targets", () => {
  const f = fixture();
  const old = group("Before"); f.refs[0].group = old;
  f.snapshot = captureTabSnapshot(f.read()); f.tracker = createSnapshotReconciler(f.snapshot);
  old.label = "Work";
  const result = f.tracker.reconcile(f.plan, f.read(), f.tabs);
  assert.deepEqual(assignments(result.plan), []);
  assert.equal(old.label, "Work");
});

test("a newly created manual group is protected even when its name matches an AI proposal", () => {
  const f = fixture();
  const added = { ...f.refs[0], url: "https://new.test/", group: group("Ｗｏｒｋ"), linkedBrowser: {} };
  const result = reconcile(f, f.read([...f.refs, added]));
  assert.deepEqual(assignments(result.plan), []);
  assert.equal(result.changedCount, f.refs.length);
});

test("top-level navigation away and back remains protected while same-URL reloads and subframes do not", () => {
  const f = fixture();
  f.tracker.onLocationChange(f.refs[0].linkedBrowser, { isTopLevel: true }, null, { spec: "https://another.test/" });
  f.tracker.onLocationChange(f.refs[0].linkedBrowser, { isTopLevel: true }, null, { spec: f.refs[0].url });
  f.tracker.onLocationChange(f.refs[1].linkedBrowser, { isTopLevel: false }, null, { spec: "https://iframe.test/" });
  f.tracker.onLocationChange(f.refs[2].linkedBrowser, { isTopLevel: true }, null, { spec: f.refs[2].url });
  const result = reconcile(f);
  assert.deepEqual(assignments(result.plan), f.refs.slice(1));
});

test("a pin and unpin gesture remains protected even if final eligibility matches the original", () => {
  const f = fixture();
  f.tracker.onTabChange({ type: "TabPinned", target: f.refs[0] });
  f.tracker.onTabChange({ type: "TabUnpinned", target: f.refs[0] });
  const result = reconcile(f);
  assert.deepEqual(assignments(result.plan), f.refs.slice(1));
});

test("changes to excluded tabs do not invalidate the tabs actually requested from AI", () => {
  const f = fixture();
  const requested = f.tabs.slice(1);
  const plan = { ...f.plan, newGroups: [{ name: "Work", tabs: requested }] };
  f.refs[0].title = "Excluded page changed";
  f.tracker.onTabChange({ type: "TabMove", target: f.refs[0] });
  const result = f.tracker.reconcile(plan, f.read([...f.refs.slice(1), f.refs[0]]), requested);
  assert.deepEqual(assignments(result.plan), f.refs.slice(1));
  assert.equal(result.changedCount, 0);
});

test("reconciliation creates a fresh plan, removes empty groups and retains valid explicit skips", () => {
  const f = fixture(3);
  f.plan = { assignedToExisting: [{ tabInfo: f.tabs[0], groupName: "Existing" }],
    newGroups: [{ name: "Work", tabs: [f.tabs[1]] }], skipped: [f.tabs[2]], unresolved: [] };
  f.refs[1].isConnected = false;
  const result = reconcile(f);
  assert.deepEqual(assignments(result.plan), [f.refs[0]]);
  assert.deepEqual(result.plan.newGroups, []);
  assert.deepEqual(result.plan.skipped, [f.tabs[2]]);
  assert.equal(f.plan.newGroups[0].tabs.length, 1);
});
