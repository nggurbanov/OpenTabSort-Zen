import test from "node:test";
import assert from "node:assert/strict";

import { applyPass2 } from "../modules/ai.mjs";

const makeTab = (group) => ({
  isConnected: true,
  closest: (selector) => (selector === "tab-group" ? group : null),
});

const makeGroup = (label = "Old") => ({
  isConnected: true,
  getAttribute: (name) => (name === "label" ? label : null),
  querySelector: () => null,
  style: {
    removeProperty: () => {},
    setProperty: () => {},
  },
});

test("Given AI clusters tabs from existing groups When applying new groups Then tabs are ungrouped before addTabGroup", () => {
  const oldGroup = makeGroup("Old");
  const tabs = [makeTab(oldGroup), makeTab(oldGroup)];
  const ungrouped = [];
  const addCalls = [];

  globalThis.window = {
    gZenWorkspaces: {
      activeWorkspaceElement: {
        tabsContainer: { firstChild: { isConnected: true } },
      },
    },
  };
  globalThis.document = { querySelector: () => null };
  globalThis.gBrowser = {
    ungroupTab: (tab) => ungrouped.push(tab),
    addTabGroup: (groupTabs, options) => {
      addCalls.push({ groupTabs, options });
      return makeGroup(options.label);
    },
  };

  try {
    const result = applyPass2({
      assignedToExisting: [],
      newGroups: [{ name: "AI Group", tabs: tabs.map((tab, idx) => ({ hostname: `h${idx}.test`, _tab: tab })) }],
      skipped: [],
    }, "workspace-1", [], { newGroupBehavior: "transient", existingBehavior: "transient", persistRules: false });

    assert.deepEqual(ungrouped, tabs);
    assert.equal(addCalls.length, 1);
    assert.deepEqual(addCalls[0].groupTabs, tabs);
    assert.equal(result.newGroupsCreated, 1);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.gBrowser;
  }
});
