import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../modules/config.mjs";
import { captureLayout, recordSortUndo, undoLastSort, clearSortUndo, canUndoLastSort } from "../modules/tab-history.mjs";
import { beginSortSession } from "../modules/sort-session.mjs";

const makeEnvironment = () => {
  const prefs = new Map(), writes = [], windows = [];
  globalThis.Services = { prefs: {
    addObserver() {}, removeObserver() {},
    getStringPref: (name, fallback = "") => prefs.get(name) ?? fallback,
    setStringPref: (name, value) => { prefs.set(name, value); writes.push({ name, value }); },
  } };
  globalThis.document = { querySelector: () => null };
  const makeWindow = () => {
    const tabs = [], groups = [];
    const workspaceId = `workspace-${windows.length + 1}`;
    const makeGroup = (label, { color = "blue", collapsed = false, style = null, className = "original-group" } = {}) => {
      const attrs = new Map([["label", label], ["zen-workspace-id", workspaceId]]);
      if (collapsed) attrs.set("collapsed", "");
      if (style !== null) attrs.set("style", style);
      const group = {
        isConnected: true, members: [], color, className,
        getAttribute: (name) => attrs.get(name) ?? null,
        setAttribute: (name, value) => attrs.set(name, value),
        removeAttribute: (name) => attrs.delete(name),
        hasAttribute: (name) => attrs.has(name),
        querySelector: (selector) => selector === "tab[selected]" ? null : group.members[0] || null,
        querySelectorAll: () => group.members,
        get collapsed() { return attrs.has("collapsed"); },
        set collapsed(value) { if (value) attrs.set("collapsed", ""); else attrs.delete("collapsed"); },
        remove: () => { group.isConnected = false; },
      };
      groups.push(group);
      return group;
    };
    const detach = (tab) => {
      if (tab.group) {
        tab.group.members.splice(tab.group.members.indexOf(tab), 1);
        if (!tab.group.members.length) tab.group.isConnected = false;
      }
      tab.group = null;
    };
    const attach = (tab, group) => { detach(tab); tab.group = group; group.members.push(tab); };
    const makeTab = (label, group = null) => {
      const attrs = new Map([["label", label], ["zen-workspace-id", workspaceId]]);
      const tab = { isConnected: true, group: null, pinned: false, linkedBrowser: { currentURI: { spec: `https://${label}.test/` } },
        getAttribute: (name) => attrs.get(name) ?? null, setAttribute: (name, value) => attrs.set(name, value), hasAttribute: (name) => attrs.has(name),
        closest: () => tab.group,
      };
      tabs.push(tab); if (group) attach(tab, group); return tab;
    };
    const browser = { tabs,
      ungroupTab: detach,
      moveTabToExistingGroup: attach,
      addTabGroup: (members, options) => { const group = makeGroup(options.label, { color: options.color }); for (const tab of members) attach(tab, group); return group; },
      moveTabTo: (node, { tabIndex }) => {
        const members = node.members ? [...node.members] : [node];
        for (const tab of members) { const index = tabs.indexOf(tab); if (index >= 0) tabs.splice(index, 1); }
        tabs.splice(tabIndex, 0, ...members);
      },
    };
    const win = { gBrowser: browser, gZenWorkspaces: { activeWorkspace: workspaceId, activeWorkspaceElement: { tabsContainer: { firstChild: null } }, updateTabsContainers() {} } };
    const activate = () => { globalThis.window = win; globalThis.gBrowser = browser; };
    const result = { win, tabs, groups, makeTab, makeGroup, attach, detach, activate };
    windows.push(result); return result;
  };
  const cleanup = () => { for (const state of windows) { state.activate(); clearSortUndo(); } delete globalThis.window; delete globalThis.gBrowser; delete globalThis.Services; delete globalThis.document; };
  return { makeWindow, prefs, writes, cleanup };
};

const withEnvironment = (callback) => {
  const environment = makeEnvironment();
  try { callback(environment); } finally { environment.cleanup(); }
};

const reorderAndRecord = (state, rules = {}) => {
  state.activate();
  const original = captureLayout();
  state.tabs.reverse();
  assert.equal(recordSortUndo(original, rules), true);
  return original;
};

test("undo restores original live tab identities/order and consumes its receipt", () => withEnvironment(({ makeWindow }) => {
  const state = makeWindow();
  const identities = [state.makeTab("one"), state.makeTab("two"), state.makeTab("three")];
  reorderAndRecord(state);
  assert.equal(undoLastSort(), true);
  assert.deepEqual(state.tabs, identities);
  assert.equal(undoLastSort(), false);
}));

test("undo receipts are isolated between browser windows", () => withEnvironment(({ makeWindow }) => {
  const first = makeWindow(), second = makeWindow();
  const firstOrder = [first.makeTab("one"), first.makeTab("two")];
  const secondOrder = [second.makeTab("alpha"), second.makeTab("beta")];
  reorderAndRecord(first); reorderAndRecord(second);
  first.activate(); assert.equal(undoLastSort(), true); assert.deepEqual(first.tabs, firstOrder);
  assert.deepEqual(second.tabs, [...secondOrder].reverse());
  second.activate(); assert.equal(undoLastSort(), true); assert.deepEqual(second.tabs, secondOrder);
}));

for (const change of ["order", "url", "group", "closed", "new"]) {
  test(`undo rejects stale ${change} changes and preserves the newer state`, () => withEnvironment(({ makeWindow }) => {
    const state = makeWindow(); state.makeTab("one"); state.makeTab("two");
    reorderAndRecord(state);
    if (change === "order") state.tabs.reverse();
    if (change === "url") state.tabs[0].linkedBrowser.currentURI.spec = "https://changed.test/";
    if (change === "group") state.attach(state.tabs[0], state.makeGroup("Manual"));
    if (change === "closed") state.tabs[0].isConnected = false;
    if (change === "new") state.makeTab("new");
    const current = [...state.tabs], memberships = state.tabs.map((tab) => tab.group);
    assert.ok(!undoLastSort());
    assert.deepEqual(state.tabs, current);
    assert.deepEqual(state.tabs.map((tab) => tab.group), memberships);
  }));
}

test("background title and favicon changes keep Undo available without restoring old metadata", () => withEnvironment(({ makeWindow }) => {
  const state = makeWindow(); const order = [state.makeTab("one"), state.makeTab("two")];
  reorderAndRecord(state);
  const changed = state.tabs[0];
  changed.setAttribute("label", "Inbox (3)");
  changed.setAttribute("image", "https://two.test/favicon.png");
  assert.equal(canUndoLastSort(), true);
  assert.equal(undoLastSort(), true);
  assert.deepEqual(state.tabs, order);
  assert.equal(changed.getAttribute("label"), "Inbox (3)");
  assert.equal(changed.getAttribute("image"), "https://two.test/favicon.png");
}));

test("workspace switching rejects undo without deleting the valid receipt", () => withEnvironment(({ makeWindow }) => {
  const state = makeWindow(); const order = [state.makeTab("one"), state.makeTab("two")];
  reorderAndRecord(state);
  const workspaceId = state.win.gZenWorkspaces.activeWorkspace;
  state.win.gZenWorkspaces.activeWorkspace = "other-workspace";
  assert.ok(!undoLastSort());
  state.win.gZenWorkspaces.activeWorkspace = workspaceId;
  assert.equal(undoLastSort(), true);
  assert.deepEqual(state.tabs, order);
}));

test("later rule edits reject undo and remain untouched along with the sorted layout", () => withEnvironment(({ makeWindow, prefs, writes }) => {
  const state = makeWindow(); state.makeTab("one"); state.makeTab("two");
  const before = JSON.stringify([{ name: "Old", domains: ["old.test"] }]);
  const after = JSON.stringify([{ name: "Old", domains: ["old.test", "learned.test"] }]);
  prefs.set(CONFIG.RULES_PREF, after);
  reorderAndRecord(state, { rulesBefore: before, rulesAfter: after });
  const newer = JSON.stringify([{ name: "User edited", domains: [] }]);
  prefs.set(CONFIG.RULES_PREF, newer);
  const order = [...state.tabs];
  assert.equal(undoLastSort(), false);
  assert.equal(prefs.get(CONFIG.RULES_PREF), newer);
  assert.deepEqual(state.tabs, order);
  assert.deepEqual(writes, []);
}));

test("undo restores AI rule additions only when the stored rules still match the receipt", () => withEnvironment(({ makeWindow, prefs, writes }) => {
  const state = makeWindow(); const order = [state.makeTab("one"), state.makeTab("two")];
  const before = "[]", after = JSON.stringify([{ name: "Learned", domains: ["one.test"] }]);
  prefs.set(CONFIG.RULES_PREF, after);
  reorderAndRecord(state, { rulesBefore: before, rulesAfter: after });
  assert.equal(undoLastSort(), true);
  assert.deepEqual(state.tabs, order);
  assert.equal(prefs.get(CONFIG.RULES_PREF), before);
  assert.deepEqual(writes, [{ name: CONFIG.RULES_PREF, value: before }]);
}));

test("undo recreates an emptied source group with its appearance and original tab nodes", () => withEnvironment(({ makeWindow }) => {
  const state = makeWindow(); state.activate();
  const source = state.makeGroup("Original", { color: "purple", style: "--custom: original", collapsed: true });
  const tabs = [state.makeTab("one", source), state.makeTab("two", source)];
  const original = captureLayout();
  const target = state.makeGroup("Sorted");
  for (const tab of tabs) state.attach(tab, target);
  assert.equal(recordSortUndo(original), true);
  assert.equal(undoLastSort(), true);
  const restored = tabs[0].group;
  assert.notEqual(restored, source);
  assert.equal(restored.getAttribute("label"), "Original");
  assert.equal(restored.color, "purple");
  assert.equal(restored.getAttribute("style"), "--custom: original");
  assert.equal(restored.collapsed, true);
  assert.deepEqual(restored.members, tabs);
  assert.equal(target.isConnected, false);
}));

test("undo restores the appearance of original groups that survived the sort", () => withEnvironment(({ makeWindow }) => {
  const state = makeWindow(); state.activate();
  const source = state.makeGroup("Original", { color: "purple", style: "--custom: original" });
  const tab = state.makeTab("one", source); state.makeTab("two", source);
  const original = captureLayout();
  const target = state.makeGroup("Sorted"); state.attach(tab, target);
  source.color = "red"; source.className = "sort-modified"; source.setAttribute("style", "--custom: changed");
  assert.equal(recordSortUndo(original), true);
  assert.equal(undoLastSort(), true);
  assert.equal(tab.group, source);
  assert.equal(source.color, "purple");
  assert.equal(source.className, "original-group");
  assert.equal(source.getAttribute("style"), "--custom: original");
}));


test("undo waits for an active sort session instead of changing the workspace underneath it", () => withEnvironment(({ makeWindow }) => {
  const state = makeWindow(); const order = [state.makeTab("one"), state.makeTab("two")];
  reorderAndRecord(state);
  const session = beginSortSession();
  try {
    assert.equal(undoLastSort(), false);
    assert.deepEqual(state.tabs, [...order].reverse());
  } finally { session.dispose(); }
  assert.equal(undoLastSort(), true);
  assert.deepEqual(state.tabs, order);
}));

test("undo preserves a later manual edit to group appearance", () => withEnvironment(({ makeWindow }) => {
  const state = makeWindow(); state.activate();
  const group = state.makeGroup("Original"); state.makeTab("one", group); state.makeTab("two", group);
  const original = captureLayout(); state.tabs.reverse();
  assert.equal(recordSortUndo(original), true);
  group.color = "red";
  const order = [...state.tabs];
  assert.ok(!undoLastSort());
  assert.equal(group.color, "red");
  assert.deepEqual(state.tabs, order);
}));


test("progressive sort receipts retain their last produced layout and reject a newer manual edit", () => withEnvironment(({ makeWindow }) => {
  const state = makeWindow(); state.activate();
  const tabs = [state.makeTab("one"), state.makeTab("two"), state.makeTab("three")];
  const original = captureLayout();
  const sorted = state.makeGroup("Sorted"); state.attach(tabs[0], sorted);
  const expectedLayout = captureLayout();
  const manual = state.makeGroup("User choice"); state.attach(tabs[1], manual);
  assert.equal(recordSortUndo(original, { expectedLayout }), true);
  assert.ok(!undoLastSort());
  assert.equal(tabs[0].group, sorted);
  assert.equal(tabs[1].group, manual);
}));


test("a progressive sort interrupted by workspace switching keeps Undo bound to its original workspace", () => withEnvironment(({ makeWindow }) => {
  const state = makeWindow(); state.activate();
  const tabs = [state.makeTab("one"), state.makeTab("two")];
  const workspaceId = state.win.gZenWorkspaces.activeWorkspace;
  const original = captureLayout();
  state.attach(tabs[0], state.makeGroup("Sorted"));
  const expectedLayout = captureLayout();
  state.win.gZenWorkspaces.activeWorkspace = "other-workspace";
  assert.equal(recordSortUndo(original, { expectedLayout, workspaceId }), true);
  assert.ok(!undoLastSort());
  state.win.gZenWorkspaces.activeWorkspace = workspaceId;
  assert.equal(undoLastSort(), true);
  assert.equal(tabs[0].group, null);
}));


test("a no-op second sort preserves the prior useful Undo receipt", () => withEnvironment(({ makeWindow }) => {
  const state = makeWindow();
  const order = [state.makeTab("one"), state.makeTab("two"), state.makeTab("three")];
  reorderAndRecord(state);
  const noOp = captureLayout();
  assert.equal(recordSortUndo(noOp), true);
  assert.equal(canUndoLastSort(), true);
  assert.equal(undoLastSort(), true);
  assert.deepEqual(state.tabs, order);
}));

test("a no-op never exposes an older receipt after a manual layout change", () => withEnvironment(({ makeWindow }) => {
  const state = makeWindow(); state.makeTab("one"); state.makeTab("two");
  reorderAndRecord(state); state.makeTab("new-tab");
  assert.equal(recordSortUndo(captureLayout()), false);
  assert.equal(canUndoLastSort(), false);
}));

test("Undo restores the original label on a reused group decorated during sorting", () => withEnvironment(({ makeWindow }) => {
  const state = makeWindow(); const group = state.makeGroup("Work");
  state.makeTab("one", group); state.activate();
  const original = captureLayout(); group.setAttribute("label", "💻 Work");
  assert.equal(recordSortUndo(original), true); assert.equal(undoLastSort(), true);
  assert.equal(group.getAttribute("label"), "Work");
}));
