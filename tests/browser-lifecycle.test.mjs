import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn, setTimeout as delay } from "node:timers/promises";
import { CONFIG } from "../modules/config.mjs";
import { domCache } from "../modules/tabs.mjs";
import { setupCommand, teardownCommand, addButtonToAllSeparators, setupWorkspaceHooks, teardownWorkspaceHooks } from "../modules/browser-ui.mjs";
import { setupTabGroupCreateHook, teardownTabGroupCreateHook, setupCollapsedStatePersistence, teardownCollapsedStatePersistence } from "../modules/browser-hooks.mjs";

// Execute the real setup/teardown APIs against an observable tree. Mutations
// deliver asynchronously so moves/removals follow MutationObserver ordering.
const environment = (t) => {
  const previous = new Map(["window", "document", "gBrowser", "Services", "MutationObserver"].map((key) => [key, globalThis[key]]));
  const observers = new Set(), prefs = new Map(), writes = [];
  const notify = (target, record) => {
    for (const observer of observers) {
      for (const [root, options] of observer.targets) {
        if (root !== target && !(options.subtree && root.contains(target))) continue;
        if (!options[record.type === "attributes" ? "attributes" : "childList"]) continue;
        if (record.type === "attributes" && options.attributeFilter && !options.attributeFilter.includes(record.attributeName)) continue;
        observer.records.push(record);
        if (!observer.queued) {
          observer.queued = true;
          queueMicrotask(() => {
            observer.queued = false;
            const records = observer.records.splice(0);
            if (records.length) observer.callback(records);
          });
        }
      }
    }
  };
  class Element {
    constructor(tagName, attrs = {}) {
      this.tagName = tagName;
      this.nodeType = 1;
      this.attrs = new Map(Object.entries(attrs));
      this.children = [];
      this.parentElement = null;
      this.listeners = new Map();
    }
    get id() { return this.getAttribute("id"); }
    get isConnected() { return this === documentRoot || !!this.parentElement?.isConnected; }
    getAttribute(name) { return this.attrs.get(name) ?? null; }
    hasAttribute(name) { return this.attrs.has(name); }
    setAttribute(name, value) {
      this.attrs.set(name, value);
      notify(this, { type: "attributes", target: this, attributeName: name });
    }
    removeAttribute(name) {
      this.attrs.delete(name);
      notify(this, { type: "attributes", target: this, attributeName: name });
    }
    set collapsed(value) { if (value) this.setAttribute("collapsed", ""); else this.removeAttribute("collapsed"); }
    get collapsed() { return this.hasAttribute("collapsed"); }
    appendChild(child) {
      child.remove();
      this.children.push(child);
      child.parentElement = this;
      notify(this, { type: "childList", target: this, addedNodes: [child], removedNodes: [] });
      return child;
    }
    insertBefore(child, anchor) {
      child.remove();
      this.children.splice(this.children.indexOf(anchor), 0, child);
      child.parentElement = this;
      notify(this, { type: "childList", target: this, addedNodes: [child], removedNodes: [] });
      return child;
    }
    remove() {
      if (!this.parentElement) return;
      const parent = this.parentElement;
      parent.children.splice(parent.children.indexOf(this), 1);
      this.parentElement = null;
      notify(parent, { type: "childList", target: parent, addedNodes: [], removedNodes: [this] });
    }
    contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
    matches(selector) {
      if (selector.startsWith("#")) return this.id === selector.slice(1);
      if (selector.startsWith(".")) return (this.getAttribute("class") || "").split(" ").includes(selector.slice(1));
      const [tag, id] = selector.split("#");
      return this.tagName === tag && (!id || this.id === id);
    }
    querySelectorAll(selector) {
      const choices = selector.split(",").map((part) => part.trim());
      const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
      return selector === "*" ? descendants : descendants.filter((node) => choices.some((choice) => node.matches(choice)));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(name, listener) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(listener);
    }
    removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
    listenerCount(name) { return this.listeners.get(name)?.size || 0; }
    emit(name, target = this) { for (const listener of this.listeners.get(name) || []) listener({ type: name, target }); }
  }
  class Observer {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Map();
      this.records = [];
      this.queued = false;
      observers.add(this);
    }
    observe(target, options) { this.targets.set(target, options); }
    disconnect() { this.targets.clear(); this.records.length = 0; }
    get active() { return this.targets.size > 0; }
  }
  const documentRoot = new Element("html");
  const commandSet = documentRoot.appendChild(new Element("commandset", { id: "zenCommandSet" }));
  const container = documentRoot.appendChild(new Element("tabs"));
  const separators = Array.from({ length: 2 }, () => documentRoot.appendChild(new Element("hbox", { class: "pinned-tabs-container-separator" })));
  globalThis.document = {
    body: documentRoot, documentElement: documentRoot,
    querySelector: (selector) => documentRoot.querySelector(selector),
    querySelectorAll: (selector) => documentRoot.querySelectorAll(selector),
  };
  globalThis.window = {
    gZenWorkspaces: { onTabBrowserInserted() {}, updateTabsContainers() {} },
    MozXULElement: { parseXULToFragment: (source) => {
      const tag = source.match(/<(toolbarbutton|command)\b/)[1];
      const id = source.match(/\bid="([^"]+)"/)[1];
      return { firstChild: new Element(tag, { id }) };
    } },
  };
  globalThis.gBrowser = { tabContainer: container };
  globalThis.Services = { prefs: {
    getStringPref: (key, fallback = "") => prefs.get(key) ?? fallback,
    getBoolPref: (_key, fallback) => fallback,
    setStringPref: (key, value) => { prefs.set(key, value); writes.push({ key, value }); },
  } };
  globalThis.MutationObserver = Observer;
  domCache.invalidate();
  t.after(() => {
    teardownCollapsedStatePersistence();
    teardownTabGroupCreateHook();
    teardownWorkspaceHooks();
    teardownCommand();
    domCache.invalidate();
    for (const [key, value] of previous) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  return { Element, documentRoot, commandSet, container, separators, observers, prefs, writes,
    group: (label) => container.appendChild(new Element("tab-group", { label })),
    activeObservers: () => [...observers].filter((observer) => observer.active),
  };
};

test("command and toolbar setup is idempotent, fully tears down, and reinstalls once", (t) => {
  const env = environment(t);
  setupCommand(); setupCommand();
  addButtonToAllSeparators(); addButtonToAllSeparators();
  assert.equal(env.commandSet.listenerCount("command"), 1);
  assert.equal(document.querySelectorAll("#" + CONFIG.COMMAND_ID).length, 1);
  assert.equal(document.querySelectorAll("#" + CONFIG.BUTTON_ID).length, 2);
  teardownCommand(); teardownCommand();
  assert.equal(env.commandSet.listenerCount("command"), 0);
  assert.equal(env.commandSet._zaoCommandListener, undefined);
  assert.equal(document.querySelectorAll("#" + CONFIG.COMMAND_ID).length, 0);
  assert.equal(document.querySelectorAll("#" + CONFIG.BUTTON_ID).length, 0);
  setupCommand();
  addButtonToAllSeparators();
  assert.equal(env.commandSet.listenerCount("command"), 1);
  assert.equal(document.querySelectorAll("#" + CONFIG.BUTTON_ID).length, 2);
});

test("replacing the command set releases the previous listener", (t) => {
  const env = environment(t);
  setupCommand();
  env.commandSet.remove();
  const replacement = env.documentRoot.appendChild(new env.Element("commandset", { id: "zenCommandSet" }));
  domCache.invalidate();
  setupCommand();
  assert.equal(env.commandSet.listenerCount("command"), 0);
  assert.equal(replacement.listenerCount("command"), 1);
  teardownCommand();
  assert.equal(replacement.listenerCount("command"), 0);
});

test("workspace wrappers preserve native calls and descriptors across teardown and reinstall", (t) => {
  environment(t);
  const calls = [], token = {};
  const owner = window.gZenWorkspaces;
  const original = function (...args) { calls.push({ receiver: this, args }); return token; };
  owner.updateTabsContainers = original;
  const descriptor = Object.getOwnPropertyDescriptor(owner, "updateTabsContainers");
  setupWorkspaceHooks();
  const wrapper = owner.updateTabsContainers;
  setupWorkspaceHooks();
  assert.equal(owner.updateTabsContainers, wrapper);
  assert.equal(owner.updateTabsContainers("first", 7), token);
  assert.deepEqual(calls[0], { receiver: owner, args: ["first", 7] });
  teardownWorkspaceHooks();
  assert.deepEqual(Object.getOwnPropertyDescriptor(owner, "updateTabsContainers"), descriptor);
  assert.equal(owner._zaoHooksInstalled, undefined);
  setupWorkspaceHooks();
  assert.equal(owner.updateTabsContainers("second"), token);
  assert.equal(calls.length, 2);
});

test("workspace teardown preserves later wrappers and disables its own UI side effects", (t) => {
  environment(t);
  let nativeCalls = 0;
  const owner = window.gZenWorkspaces;
  owner.updateTabsContainers = () => ++nativeCalls;
  setupWorkspaceHooks();
  const ours = owner.updateTabsContainers;
  const later = function (...args) { return ours.apply(this, args); };
  owner.updateTabsContainers = later;
  teardownWorkspaceHooks();
  assert.equal(owner.updateTabsContainers, later);
  assert.equal(later.call(owner), 1);
  assert.equal(document.querySelectorAll("#" + CONFIG.BUTTON_ID).length, 0);
  setupWorkspaceHooks();
  assert.equal(owner.updateTabsContainers(), 2);
  assert.equal(document.querySelectorAll("#" + CONFIG.BUTTON_ID).length, 2);
});

test("workspace wrapper retains native exceptions and restores inherited methods", (t) => {
  environment(t);
  const failure = new Error("native failure");
  const original = () => { throw failure; };
  const owner = Object.create({ onTabBrowserInserted: original, updateTabsContainers() {} });
  window.gZenWorkspaces = owner;
  setupWorkspaceHooks();
  assert.throws(() => owner.onTabBrowserInserted(), (error) => error === failure);
  teardownWorkspaceHooks();
  assert.equal(Object.hasOwn(owner, "onTabBrowserInserted"), false);
  assert.equal(owner.onTabBrowserInserted, original);
});

test("group-create teardown removes its listener and cancels pending restore timers", async (t) => {
  const env = environment(t);
  const group = env.group("Reading");
  env.prefs.set(CONFIG.COLLAPSED_GROUPS_PREF, JSON.stringify(["Reading"]));
  setupTabGroupCreateHook(); setupTabGroupCreateHook();
  assert.equal(env.container.listenerCount("TabGroupCreate"), 1);
  teardownTabGroupCreateHook(); teardownTabGroupCreateHook();
  await delay(5);
  assert.equal(group.collapsed, false);
  assert.equal(env.container.listenerCount("TabGroupCreate"), 0);
  assert.equal(env.container._zaoTabGroupCreateHook, undefined);
  setupTabGroupCreateHook();
  await delay(5);
  assert.equal(group.collapsed, true);
  group.collapsed = false;
  env.container.emit("TabGroupCreate", group);
  await delay(5);
  assert.equal(group.collapsed, true);
});

test("collapse persistence prunes removed groups, disconnects all observers, and reinstalls", async (t) => {
  const env = environment(t);
  const group = env.group("Reading");
  setupCollapsedStatePersistence(); setupCollapsedStatePersistence();
  assert.equal(env.activeObservers().length, 2);
  const groupObserver = group._zaoCollapseAttrObs;
  group.collapsed = true;
  await nextTurn();
  assert.deepEqual(JSON.parse(env.prefs.get(CONFIG.COLLAPSED_GROUPS_PREF)), ["Reading"]);
  group.remove();
  await nextTurn();
  assert.equal(groupObserver.active, false);
  assert.equal(group._zaoCollapseAttrObs, undefined);
  assert.equal(window._zaoCollapseObserverState.groups.size, 0);
  const future = env.group("Work");
  await nextTurn();
  assert.ok(future._zaoCollapseAttrObs);
  teardownCollapsedStatePersistence(); teardownCollapsedStatePersistence();
  assert.equal(env.activeObservers().length, 0);
  assert.equal(future._zaoCollapseAttrObs, undefined);
  assert.equal(window._zaoCollapseObserverInstalled, undefined);
  const writesBefore = env.writes.length;
  future.collapsed = true;
  await nextTurn();
  assert.equal(env.writes.length, writesBefore);
  setupCollapsedStatePersistence();
  future.collapsed = false;
  await nextTurn();
  future.collapsed = true;
  await nextTurn();
  assert.equal(env.writes.length, writesBefore + 1);
});

test("moving a group retains one observer and removing nested groups releases all of them", async (t) => {
  const env = environment(t);
  const outer = env.group("Outer");
  const nested = outer.appendChild(new env.Element("tab-group", { label: "Nested" }));
  setupCollapsedStatePersistence();
  const observer = nested._zaoCollapseAttrObs;
  const wrapper = env.container.appendChild(new env.Element("vbox"));
  wrapper.appendChild(outer);
  await nextTurn();
  assert.equal(nested._zaoCollapseAttrObs, observer);
  assert.equal(window._zaoCollapseObserverState.groups.size, 2);
  wrapper.remove();
  await nextTurn();
  assert.equal(window._zaoCollapseObserverState.groups.size, 0);
  assert.equal(nested._zaoCollapseAttrObs, undefined);
  assert.equal(outer._zaoCollapseAttrObs, undefined);
});

test("replacing the tab container detaches old create and collapse observers", (t) => {
  const env = environment(t);
  env.group("Old");
  setupTabGroupCreateHook();
  setupCollapsedStatePersistence();
  const oldObservers = env.activeObservers();
  const replacement = env.documentRoot.appendChild(new env.Element("tabs"));
  globalThis.gBrowser.tabContainer = replacement;
  setupTabGroupCreateHook();
  setupCollapsedStatePersistence();
  assert.equal(env.container.listenerCount("TabGroupCreate"), 0);
  assert.equal(replacement.listenerCount("TabGroupCreate"), 1);
  assert.ok(oldObservers.every((observer) => !observer.active));
  assert.equal(env.activeObservers().length, 1);
});
