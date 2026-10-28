import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../modules/config.mjs";
import { beginSortSession, getActiveSortSignal, throwIfSortCancelled, reportSortProgress, stopActiveSort, primarySortPrefNames } from "../modules/sort-session.mjs";

const makeEnvironment = () => {
  const observers = new Set(), windows = [];
  globalThis.Services = { prefs: {
    addObserver: (_prefix, observer) => observers.add(observer),
    removeObserver: (_prefix, observer) => observers.delete(observer),
  } };
  const makeWindow = () => {
    const listeners = new Map(), tabListeners = new Map(), progress = new Set(), workspaceListeners = new Set();
    const register = (map, name, callback) => { if (!map.has(name)) map.set(name, new Set()); map.get(name).add(callback); };
    const win = {
      addEventListener: (name, callback) => register(listeners, name, callback),
      removeEventListener: (name, callback) => listeners.get(name)?.delete(callback),
      gZenWorkspaces: { activeWorkspace: "w1",
        addChangeListeners: (callback) => workspaceListeners.add(callback),
        removeChangeListeners: (callback) => workspaceListeners.delete(callback),
      },
      switchWorkspace(id) { this.gZenWorkspaces.activeWorkspace = id; for (const callback of workspaceListeners) callback(); },
      gBrowser: {
        tabContainer: {
          addEventListener: (name, callback) => register(tabListeners, name, callback),
          removeEventListener: (name, callback) => tabListeners.get(name)?.delete(callback),
        },
        addTabsProgressListener: (listener) => progress.add(listener),
        removeTabsProgressListener: (listener) => progress.delete(listener),
      },
      emitTab: (name, target) => { for (const callback of tabListeners.get(name) || []) callback({ type: name, target }); },
      emitWindow: (name) => { for (const callback of listeners.get(name) || []) callback(); },
      navigate: (...args) => { for (const listener of progress) listener.onLocationChange(...args); },
      listenerCount: () => [...listeners.values(), ...tabListeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0) + progress.size + workspaceListeners.size,
    };
    windows.push(win);
    return win;
  };
  const notify = (name, topic = "nsPref:changed") => { for (const observer of [...observers]) observer.observe(null, topic, name); };
  const cleanup = () => {
    for (const win of windows) { globalThis.window = win; stopActiveSort(); win.emitWindow("beforeunload"); }
    delete globalThis.window; delete globalThis.Services;
  };
  return { makeWindow, observers, notify, cleanup };
};

const withEnvironment = async (callback) => {
  const environment = makeEnvironment();
  try { await callback(environment); } finally { environment.cleanup(); }
};

test("sort sessions are isolated per window and reject only duplicate sessions in the same window", () => withEnvironment(({ makeWindow, observers }) => {
  const firstWindow = makeWindow(), secondWindow = makeWindow();
  globalThis.window = firstWindow;
  const first = beginSortSession();
  assert.equal(getActiveSortSignal(), first.signal);
  assert.throws(() => beginSortSession(), /already running/);
  globalThis.window = secondWindow;
  const second = beginSortSession();
  assert.notEqual(first.signal, second.signal);
  assert.equal(observers.size, 2);
  stopActiveSort();
  assert.equal(second.signal.aborted, true);
  assert.equal(first.signal.aborted, false);
  second.dispose();
  globalThis.window = firstWindow;
  assert.equal(getActiveSortSignal(), first.signal);
  first.dispose();
  assert.equal(observers.size, 0);
}));

for (const pref of [CONFIG.RULES_PREF, CONFIG.SKIP_DOMAINS_PREF, CONFIG.STRICT_RULES_PREF, CONFIG.MATCH_MODE_PREF, CONFIG.AI_ENGINE_PREF]) {
  test(`a relevant preference invalidates pending sorting: ${pref}`, () => withEnvironment(({ makeWindow, notify }) => {
    globalThis.window = makeWindow();
    const session = beginSortSession();
    notify(pref);
    assert.equal(session.signal.aborted, true);
    assert.equal(session.reason, "stale");
    assert.throws(() => getActiveSortSignal(), { name: "AbortError" });
    session.dispose();
  }));
}

test("unrelated preference changes and notifications of a different topic do not abort sorting", () => withEnvironment(({ makeWindow, notify }) => {
  globalThis.window = makeWindow();
  const session = beginSortSession();
  notify("extensions.zen-auto-organize.minimal-style");
  notify(CONFIG.RULES_PREF, "other-topic");
  assert.equal(session.signal.aborted, false);
  session.dispose();
}));

for (const trigger of ["TabOpen", "TabClose", "TabMove", "TabGrouped", "TabAttrModified", "navigation"]) {
  test(`tab invalidation is checked asynchronously for ${trigger}`, () => withEnvironment(async ({ makeWindow }) => {
    const win = makeWindow(); globalThis.window = win;
    let current = true, checkpoints = 0;
    const session = beginSortSession({ isCurrent: () => { checkpoints++; return current; } });
    current = false;
    if (trigger === "navigation") win.navigate(); else { win.emitTab(trigger); win.emitTab(trigger); }
    assert.equal(session.signal.aborted, false);
    await Promise.resolve();
    assert.equal(session.signal.aborted, true);
    assert.equal(session.reason, "stale");
    assert.equal(checkpoints, 2);
    session.dispose();
  }));
}

test("disposing removes all observers/listeners and a queued stale check cannot abort after disposal", () => withEnvironment(async ({ makeWindow, observers, notify }) => {
  const win = makeWindow(); globalThis.window = win;
  let current = true;
  const session = beginSortSession({ isCurrent: () => current });
  assert.ok(win.listenerCount() > 0);
  current = false; win.emitTab("TabMove");
  session.dispose(); session.dispose();
  assert.equal(win.listenerCount(), 0);
  assert.equal(observers.size, 0);
  notify(CONFIG.RULES_PREF); win.navigate(); win.emitTab("TabClose");
  await Promise.resolve();
  assert.equal(session.signal.aborted, false);
  assert.equal(getActiveSortSignal(), undefined);
}));

test("stop before a request aborts with the original reason and progress stays in its own window", () => withEnvironment(({ makeWindow }) => {
  globalThis.window = makeWindow();
  const progress = [];
  const session = beginSortSession({ onProgress: (value) => progress.push(value) });
  reportSortProgress("Planning");
  stopActiveSort();
  const reason = session.signal.reason;
  session.stop("stale");
  assert.equal(session.signal.reason, reason);
  assert.equal(session.reason, "stopped");
  assert.throws(() => throwIfSortCancelled(), { name: "AbortError" });
  assert.deepEqual(progress, ["Planning"]);
  session.dispose();
}));

test("an already stale initial snapshot rejects session creation and leaves no observers behind", () => withEnvironment(({ makeWindow, observers }) => {
  const win = makeWindow(); globalThis.window = win;
  assert.throws(() => beginSortSession({ isCurrent: () => false }), { name: "AbortError" });
  assert.equal(observers.size, 0);
  assert.equal(win.listenerCount(), 0);
  assert.equal(getActiveSortSignal(), undefined);
}));

test("disposed session references and stale observer callbacks cannot abort its completed signal", () => withEnvironment(({ makeWindow, observers }) => {
  globalThis.window = makeWindow();
  let current = true;
  const session = beginSortSession({ isCurrent: () => current });
  const observer = [...observers][0];
  session.dispose(); current = false;
  observer.observe(null, "nsPref:changed", CONFIG.RULES_PREF);
  session.stop("stale");
  assert.doesNotThrow(() => session.checkpoint());
  assert.equal(session.signal.aborted, false);
}));


test("primary preference watching follows only the selected providers and current operation", () => withEnvironment(({ makeWindow, notify }) => {
  globalThis.window = makeWindow();
  const session = beginSortSession({ prefNames: primarySortPrefNames("custom"), preferenceReason: "settings" });
  for (const pref of [CONFIG.AI_OPENAI_MODEL_PREF, CONFIG.AI_GEMINI_MODEL_PREF, CONFIG.AI_OLLAMA_WARMUP_PREF, CONFIG.RULES_PREF, CONFIG.AI_JEV_CATEGORIES_PREF]) notify(pref);
  assert.equal(session.signal.aborted, false);
  notify(CONFIG.AI_CUSTOM_MODEL_PREF);
  assert.equal(session.signal.aborted, true);
  assert.equal(session.reason, "settings");
  session.dispose();
}));

test("Decision primary preferences include its selected category provider without saved categories or legacy preview", () => {
  const names = primarySortPrefNames("jev", "custom");
  for (const name of [CONFIG.AI_JEV_MODEL_PREF, CONFIG.AI_JEV_CATEGORY_PROVIDER_PREF, CONFIG.AI_CUSTOM_MODEL_PREF, CONFIG.AI_PROVIDER_CONSENT_PREF, CONFIG.SKIP_DOMAINS_PREF]) assert.ok(names.includes(name));
  for (const name of [CONFIG.AI_OPENAI_MODEL_PREF, CONFIG.AI_JEV_CATEGORIES_PREF, CONFIG.AI_JEV_PREVIEW_PREF, CONFIG.AI_JEV_CATEGORY_SOURCE_PREF, CONFIG.RULES_PREF]) assert.ok(!names.includes(name));
});

test("native workspace change callbacks abort the pending request with a specific reason and are cleaned up", () => withEnvironment(async ({ makeWindow }) => {
  const win = makeWindow(); globalThis.window = win;
  const session = beginSortSession({ isCurrent: () => win.gZenWorkspaces.activeWorkspace === "w1" ? true : "workspace" });
  win.switchWorkspace("w2");
  await Promise.resolve();
  assert.equal(session.signal.aborted, true);
  assert.equal(session.reason, "workspace");
  session.dispose();
  assert.equal(win.listenerCount(), 0);
}));

test("snapshot edit callbacks receive every event even while checkpoint work is coalesced", () => withEnvironment(async ({ makeWindow }) => {
  const win = makeWindow(); globalThis.window = win;
  const events = [], navigations = [];
  const session = beginSortSession({ onTabChange: (event) => event && events.push(event), onLocationChange: (...args) => navigations.push(args) });
  const first = {}, second = {}, browser = {};
  win.emitTab("TabMove", first); win.emitTab("TabGrouped", second);
  win.navigate(browser, { isTopLevel: true }, null, { spec: "https://pages.test/" });
  await Promise.resolve();
  assert.deepEqual(events.map((event) => event.target), [first, second]);
  assert.equal(navigations[0][0], browser);
  assert.equal(session.signal.aborted, false);
  session.dispose();
}));
