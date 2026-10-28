import test from "node:test";
import assert from "node:assert/strict";
import { setupSettingsObserver, teardownSettingsObserver } from "../modules/prefs-ui.mjs";

// A mounted Sine dialog: category refresh replaces children, which queues a
// childList mutation under the same dialog observed by setupSettingsObserver.
// Delivering that record must not refresh either editor again.
test("settings discovery ignores editor mutations after injection", () => {
  const previous = Object.fromEntries(["document", "Services", "MutationObserver"].map((key) => [key, globalThis[key]]));
  let callback;
  let disconnected = false;
  let rulesRefreshes = 0;
  let categoryRefreshes = 0;
  const pending = [];
  const dialog = {
    nodeType: 1,
    classList: { add() {} },
    matches: (selector) => selector === ".sineItemPreferenceDialog",
    querySelectorAll: (selector) => selector === ".separator-label" ? [{ textContent: "Group Rules" }] : [],
    querySelector(selector) {
      if (selector === ".zao-simple-settings") return {};
      if (selector === ".zao-rules-editor") return { _zaoRefresh() { rulesRefreshes++; } };
      if (selector === ".zao-jev-category-settings") return { _zaoRefresh() {
        categoryRefreshes++;
        pending.push({ addedNodes: [], target: { closest: () => dialog } });
      } };
    },
    closest: () => dialog,
  };
  try {
    globalThis.Services = { wm: { getMostRecentWindow: () => null },
      prefs: { getStringPref: () => "", addObserver() {}, removeObserver() {} } };
    globalThis.document = { body: {}, querySelectorAll: (selector) => selector === ".sineItemPreferenceDialog" ? [dialog] : [] };
    globalThis.MutationObserver = class {
      constructor(handler) { callback = handler; }
      observe() {}
      disconnect() { disconnected = true; }
    };
    setupSettingsObserver();
    assert.equal(categoryRefreshes, 0, "discovering a mounted editor must not rebuild it");
    assert.equal(rulesRefreshes, 0);

    // Sine may announce the dialog again, or any editor may change its children.
    callback([{ addedNodes: [dialog], target: document.body }]);
    callback([{ addedNodes: [], target: dialog }]);
    assert.equal(categoryRefreshes, 0, "child mutations must not feed an unconditional category refresh");
    assert.equal(rulesRefreshes, 0);
    assert.equal(pending.length, 0, "no follow-up mutation cycle should be queued");

    teardownSettingsObserver();
    assert.equal(disconnected, true);
  } finally {
    teardownSettingsObserver();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
