import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONFIG } from "../modules/config.mjs";
import { showNotice, showSortProgress } from "../modules/operation-ui.mjs";

// Observable chrome tree + deterministic timers exercise the real controller.
const environment = (t, { sidebar = true, anchor = sidebar, stableHost = sidebar, inline = false } = {}) => {
  const previous = new Map(["window", "document"].map((key) => [key, globalThis[key]]));
  const observers = new Set(), timers = new Map(); let clock = 0, timerId = 0;
  const notify = (parent) => queueMicrotask(() => {
    for (const observer of observers) if (observer.target === parent) observer.callback();
  });
  class Target {
    listeners = new Map();
    addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
    removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry !== fn)); }
    emit(type, extra = {}) {
      if (type === "click" && this.disabled) return;
      for (const fn of [...(this.listeners.get(type) || [])]) fn({ key: "", relatedTarget: null, preventDefault() {}, ...extra });
    }
    listenerCount() { return [...this.listeners.values()].reduce((count, entries) => count + entries.length, 0); }
  }
  class Element extends Target {
    constructor(tag) {
      super(); this.localName = tag; this.className = ""; this.children = []; this.attributes = new Map(); this.style = {}; this._text = "";
      this.classList = { add: (name) => { this.className += ` ${name}`; }, contains: (name) => this.className.split(/\s+/).includes(name) };
    }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    removeAttribute(key) { this.attributes.delete(key); }
    toggleAttribute(key, force) { if (force ?? !this.hasAttribute(key)) this.setAttribute(key, ""); else this.removeAttribute(key); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    hasAttribute(key) { return this.attributes.has(key); }
    get hidden() { return this.hasAttribute("hidden"); }
    set hidden(value) { value ? this.setAttribute("hidden", "") : this.attributes.delete("hidden"); }
    get parentElement() { return this.parentNode; }
    get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
    get isConnected() { return this === root || Boolean(this.parentNode?.isConnected); }
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
    set textContent(value) { this._text = String(value); this.children = []; }
    append(...children) { for (const child of children) this.appendChild(child); }
    appendChild(child) { return this.insertBefore(child, null); }
    insertBefore(child, next) { child.remove(); child.parentNode = this; const index = this.children.indexOf(next); this.children.splice(index < 0 ? this.children.length : index, 0, child); notify(this); return child; }
    remove() { if (this.parentNode) { const parent = this.parentNode; parent.children.splice(parent.children.indexOf(this), 1); this.parentNode = null; notify(parent); } }
    contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
    focus() { document.activeElement = this; }
    matches(selector) {
      if (selector.startsWith("#")) return this.id === selector.slice(1);
      if (selector.startsWith(".") && !this.classList.contains(selector.match(/^\.([\w-]+)/)[1])) return false;
      const tag = selector.match(/^[\w-]+/); if (tag && this.localName !== tag[0]) return false;
      return [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(([, key, value]) => value === undefined ? this.hasAttribute(key) : this.getAttribute(key) === value);
    }
    querySelectorAll(selector) { return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector); }
    getBoundingClientRect() { return this.rect || { left: 260, bottom: 100, width: 24, height: 24 }; }
  }
  const root = new Element("window"), head = new Element("head"), wrapper = new Element("vbox"), separator = new Element("hbox"), next = new Element("tabs");
  separator.className = inline ? "pinned-tabs-container-separator" : "fallback-separator";
  const sidebarHost = new Element("toolbox"), tabArea = new Element("hbox");
  sidebarHost.id = "navigator-toolbox"; tabArea.id = "titlebar";
  sidebarHost.rect = { left: 0, right: 186, top: 0, bottom: 768, width: 186, height: 768 };
  root.appendChild(head);
  if (stableHost) { root.appendChild(sidebarHost); sidebarHost.appendChild(tabArea); tabArea.appendChild(wrapper); }
  else root.appendChild(wrapper);
  if (sidebar) wrapper.append(separator, next);
  let wand;
  if (anchor) { wand = new Element("toolbarbutton"); wand.id = CONFIG.BUTTON_ID; (sidebar ? separator : wrapper).append(wand); }
  const win = new Target();
  Object.assign(win, { innerWidth: 1024, innerHeight: 768, getComputedStyle: () => ({ flexDirection: "column" }),
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, due: clock + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(target) { this.target = target; observers.add(this); }
      disconnect() { observers.delete(this); }
    },
  });
  const document = { documentElement: root, head, createElementNS: (_namespace, tag) => new Element(tag),
    querySelectorAll: (selector) => root.querySelectorAll(selector), querySelector: (selector) => root.querySelector(selector),
    getElementById: (id) => root.querySelector(`#${id}`) };
  Object.assign(globalThis, { window: win, document });
  t.after(() => { win.emit("unload"); for (const [key, value] of previous) value === undefined ? delete globalThis[key] : globalThis[key] = value; });
  return { document, window: win, root, head, wrapper, separator, next, wand, sidebarHost, tabArea, Element, timers, observers,
    row: () => document.querySelector(".zao-operation"),
    advance(ms) { clock += ms; for (const [id, timer] of [...timers]) if (timer.due <= clock) { timers.delete(id); timer.fn(); } },
  };
};
const actions = (root) => root.querySelectorAll("button").filter((node) => !node.hidden && !node.classList.contains("zao-operation-close"));
const status = (root) => root.querySelector('[role="status"]');

test("first feedback is styled synchronously in the stable sidebar column without a stylesheet request", (t) => {
  const env = environment(t); showSortProgress({ stage: "Preparing 300 tabs…" });
  const row = env.row();
  assert.equal(row.getAttribute("data-placement"), "sidebar");
  assert.equal(row.parentElement, env.sidebarHost); assert.equal(row.nextSibling, env.tabArea);
  assert.equal(env.wrapper.contains(row), false); assert.equal(env.separator.nextSibling, env.next);
  assert.equal(status(row).textContent, "Preparing 300 tabs…"); assert.equal(status(row).title, "Preparing 300 tabs…");
  assert.equal(status(row).getAttribute("aria-live"), "polite");
  assert.equal(actions(row)[0].getAttribute("data-action"), "stop");
  assert.equal(row.querySelector("progress"), null);
  const sheet = env.document.getElementById("zao-operation-styles");
  assert.equal(sheet.localName, "style");
  assert.equal(sheet.textContent.trim(), readFileSync(new URL("../styles/operations.css", import.meta.url), "utf8").trim());
  assert.match(sheet.textContent, /prefers-reduced-motion/);
  assert.deepEqual(actions(row).map((node) => node.textContent), ["Stop"]);
});

test("fallback stays near the toolbar and follows the viewport without a bottom-screen card", (t) => {
  const env = environment(t, { sidebar: false, anchor: true }); const ui = showSortProgress();
  const row = env.row(); assert.equal(row.getAttribute("data-placement"), "overlay");
  assert.equal(row.style.top, "106px"); assert.equal(row.style.insetInlineStart, "260px");
  env.window.innerWidth = 250; env.window.emit("resize"); assert.equal(row.style.insetInlineStart, "8px");
  ui.remove(); assert.equal(env.window.listenerCount(), 0); assert.equal(env.observers.size, 0);
});

test("Stop acknowledges immediately, cannot double-fire, and stage/update preserve a compact status", (t) => {
  const env = environment(t); let stopped = 0; const ui = showSortProgress({ onStop: () => stopped++ });
  const stop = actions(env.row())[0]; stop.emit("click"); stop.emit("click");
  assert.equal(stopped, 1); assert.equal(stop.disabled, true); assert.equal(status(env.row()).textContent, "Stopping…");
  ui.stage("Finding topics…"); assert.equal(status(env.row()).textContent, "Finding topics…");
  ui.update({ processed: 75, total: 300, moved: 10 }); assert.equal(status(env.row()).textContent, "Tidying 75 / 300 tabs…");
  assert.equal(env.timers.size, 0);
});

test("success offers Undo, hides work animation, then dismisses visually without clearing the receipt", (t) => {
  const env = environment(t); let dismissed = 0, undone = 0;
  const ui = showSortProgress({ onUndo: () => undone++, onDismiss: () => dismissed++ });
  ui.finish("Tidied 300 tabs · 2 kept in place", true, { label: "Tidied 300 tabs" }); const row = env.row();
  assert.equal(status(row).textContent, "Tidied 300 tabs");
  assert.equal(status(row).title, "Tidied 300 tabs · 2 kept in place");
  assert.equal(status(row).getAttribute("aria-label"), "Tidied 300 tabs · 2 kept in place");
  assert.equal(actions(row)[0].getAttribute("aria-label"), "Undo sort");
  assert.equal(actions(row)[0].getAttribute("data-action"), "undo");
  assert.deepEqual(actions(row).map((node) => node.textContent), ["Undo"]);
  assert.equal(row.querySelector("svg").hasAttribute("hidden"), true);
  actions(row)[0].emit("click"); assert.equal(undone, 1);
  env.advance(4999); assert.equal(row.isConnected, true);
  env.advance(1); assert.equal(row.isConnected, false); assert.equal(dismissed, 0);
  assert.equal(env.window.listenerCount(), 0); assert.equal(env.observers.size, 0);
});

test("hover and keyboard focus pause success dismissal while the action is being used", (t) => {
  const env = environment(t); const ui = showSortProgress({ onUndo() {} }); ui.finish("Done", true);
  const row = env.row(); row.emit("mouseenter"); env.advance(10000); assert.equal(row.isConnected, true);
  row.emit("mouseleave"); row.emit("focusin"); env.advance(10000); assert.equal(row.isConnected, true);
  row.emit("focusout", { relatedTarget: actions(row)[0] }); assert.equal(env.timers.size, 0);
  row.emit("focusout", { relatedTarget: null }); env.advance(5000); assert.equal(row.isConnected, false);
});

test("failure stays quiet and persistent with one AI setup recovery action", (t) => {
  const env = environment(t); let setup = 0; const ui = showSortProgress({ onSetup: () => setup++ });
  ui.setupAvailable(); ui.finish("Couldn’t tidy tabs"); const row = env.row();
  assert.equal(row.getAttribute("data-state"), "error");
  assert.equal(actions(row)[0].getAttribute("aria-label"), "AI setup");
  assert.equal(actions(row)[0].getAttribute("data-action"), "setup");
  assert.deepEqual(actions(row).map((node) => node.textContent), ["Setup"]);
  actions(row)[0].emit("click"); assert.equal(setup, 1);
  env.advance(60000); assert.equal(row.isConnected, true); assert.equal(env.timers.size, 0);
});

test("failed follow-up retains a previous valid Undo as its sole action", (t) => {
  const env = environment(t); let undone = 0; const ui = showSortProgress({ onUndo: () => undone++, onSetup() {} });
  ui.setupAvailable(); ui.finish("Couldn’t tidy tabs", true);
  assert.deepEqual(actions(env.row()).map((node) => node.textContent), ["Undo"]);
  actions(env.row())[0].emit("click"); assert.equal(undone, 1);
  ui.setUndoAvailable(false); assert.deepEqual(actions(env.row()).map((node) => node.textContent), ["Setup"]);
});

test("explicit close and Escape retain their dismissal semantics and accessible target", (t) => {
  const env = environment(t); let dismissed = 0; let ui = showSortProgress({ onDismiss: () => dismissed++ });
  env.row().emit("keydown", { key: "Escape" }); assert.equal(env.row().isConnected, true);
  ui.finish("Done"); let close = env.row().querySelector(".zao-operation-close");
  assert.equal(close.getAttribute("aria-label"), "Dismiss notification");
  assert.equal(close.getAttribute("data-action"), "dismiss"); close.emit("click"); assert.equal(dismissed, 1);
  ui = showSortProgress({ onDismiss: () => dismissed++ }); ui.finish("Done");
  env.row().emit("keydown", { key: "Escape" }); assert.equal(dismissed, 2); assert.equal(env.row(), null);
});

test("replacement and window unload clean all pending timers, observers and listeners", (t) => {
  const env = environment(t); let dismissed = 0;
  const first = showSortProgress({ onDismiss: () => dismissed++ }); first.finish("Done"); const previous = env.row();
  showSortProgress(); assert.equal(previous.isConnected, false); assert.equal(previous.listenerCount(), 0);
  assert.equal(env.timers.size, 0); assert.equal(env.observers.size, 1); assert.equal(dismissed, 0);
  env.window.emit("unload"); assert.equal(env.row(), null); assert.equal(env.observers.size, 0); assert.equal(env.window.listenerCount(), 0);
});

test("native direct removal releases its timer and window listeners", async (t) => {
  const env = environment(t, { sidebar: false }); const ui = showSortProgress(); ui.finish("Done");
  env.row().remove(); await Promise.resolve();
  assert.equal(env.timers.size, 0); assert.equal(env.observers.size, 0); assert.equal(env.window.listenerCount(), 0);
});

test("notices never displace an active Stop control or accumulate beside completed feedback", (t) => {
  const env = environment(t); const ui = showSortProgress(); const progress = env.row();
  showNotice("Already sorting"); assert.equal(env.row(), progress);
  ui.finish("Done"); showNotice("Sort undone.");
  assert.equal(progress.isConnected, false); assert.equal(status(env.row()).textContent, "Sort undone.");
  assert.equal(actions(env.row()).length, 0); assert.equal(env.document.querySelectorAll(".zao-operation").length, 1);
  env.advance(5000); assert.equal(env.row(), null);
});

test("a stale external link is upgraded and subsequent feedback reuses a single inline stylesheet", (t) => {
  const env = environment(t); const stale = new env.Element("link"); stale.id = "zao-operation-styles"; env.head.append(stale);
  showSortProgress(); const sheet = env.document.getElementById("zao-operation-styles");
  assert.equal(stale.isConnected, false); assert.equal(sheet.localName, "style");
  showSortProgress(); assert.equal(env.document.getElementById("zao-operation-styles"), sheet);
  assert.equal(env.document.querySelectorAll("#zao-operation-styles").length, 1);
});

test("an Undo refusal updates finished feedback without replacing its controls or receipt", (t) => {
  const env = environment(t); let undoCalls = 0;
  const ui = showSortProgress({ onUndo: () => undoCalls++ });
  ui.finish("300 tabs tidy", true);
  const row = env.row(), undo = actions(row)[0];
  undo.emit("focusin");
  showNotice("The tab layout changed after sorting; undo would overwrite those changes.");
  assert.equal(env.row(), row);
  assert.equal(row.classList.contains("zao-sort-progress"), true);
  assert.equal(actions(row)[0], undo);
  assert.match(status(row).textContent, /layout changed/);
  undo.emit("click"); assert.equal(undoCalls, 1);
  env.advance(60000); assert.equal(row.isConnected, true);
});


test("feedback stays outside the tab scroll area when its wand is already scrolled offscreen", (t) => {
  const env = environment(t);
  env.wand.rect = { left: 100, right: 127, top: -9000, bottom: -8978, width: 27, height: 22 };
  const ui = showSortProgress({ onUndo() {} });
  const row = env.row();
  assert.equal(row.parentElement, env.sidebarHost);
  assert.equal(row.nextSibling, env.tabArea);
  assert.equal(env.wrapper.contains(row), false);
  env.wand.rect = { ...env.wand.rect, top: -12000, bottom: -11978 };
  env.wrapper.emit("scroll"); ui.finish("Tidied 300 tabs", true);
  assert.equal(row.parentElement, env.sidebarHost);
  assert.deepEqual(actions(row).map((node) => node.textContent), ["Undo"]);
});

test("an unknown sidebar hierarchy falls back to a viewport-clamped overlay", (t) => {
  const env = environment(t, { stableHost: false });
  env.wand.rect = { left: 100, right: 127, top: -9000, bottom: -8978, width: 27, height: 22 };
  showSortProgress(); const row = env.row();
  assert.equal(row.getAttribute("data-placement"), "overlay");
  assert.equal(row.style.top, "8px");
  assert.equal(row.parentElement, env.root);
});


test("Retry is an explicit finished-state action with short visible copy and a full accessible explanation", (t) => {
  const env = environment(t); let retried = 0;
  const ui = showSortProgress({ onRetry: () => retried++ });
  const row = env.row(), retry = row.querySelector('[data-action="retry"]');
  retry.emit("click"); ui.retryAvailable(); retry.emit("click");
  assert.equal(retried, 0); assert.equal(retry.hidden, true);
  assert.deepEqual(actions(row).map((node) => node.textContent), ["Stop"]);
  const message = "AI setup changed. Your layout is unchanged. Retry with the new setup.";
  ui.finish(message, false, { label: "AI setup changed" });
  assert.equal(status(row).textContent, "AI setup changed");
  assert.equal(status(row).getAttribute("aria-label"), message);
  assert.equal(retry.getAttribute("aria-label"), "Retry sort");
  assert.equal(retry.type, "button");
  assert.deepEqual(actions(row).map((node) => node.textContent), ["Retry"]);
  assert.equal(row.getAttribute("data-state"), "error");
  env.advance(6000); assert.equal(env.row(), row); assert.equal(env.timers.size, 0);
  retry.emit("click"); retry.emit("click");
  assert.equal(retried, 1); assert.equal(retry.disabled, true);
});

test("keyboard retry replaces the focused row safely and transfers focus through Stop to Undo", async (t) => {
  const env = environment(t); let retried = 0, next;
  const ui = showSortProgress({ onRetry: () => {
    retried++;
    next = showSortProgress({ onUndo() {} });
    return Promise.resolve();
  } });
  ui.finish("Workspace changed. Retry in this workspace.", false, { label: "Workspace changed" });
  ui.retryAvailable();
  const oldRow = env.row(), retry = oldRow.querySelector('[data-action="retry"]');
  retry.focus(); assert.equal(env.document.activeElement, retry);
  // Native buttons dispatch click for keyboard activation as well as pointers.
  retry.emit("click", { detail: 0 }); retry.emit("click", { detail: 0 });
  await Promise.resolve();
  const newRow = env.row(), stop = newRow.querySelector('[data-action="stop"]');
  assert.notEqual(newRow, oldRow); assert.equal(oldRow.isConnected, false);
  assert.equal(retried, 1); assert.equal(retry.listenerCount(), 0);
  assert.equal(env.document.activeElement, stop);
  next.finish("Tidied 300 tabs", true);
  assert.equal(env.document.activeElement, newRow.querySelector('[data-action="undo"]'));
});

test("Retry keeps the existing Undo and Setup priorities without stealing focus from browser content", (t) => {
  const env = environment(t), content = new env.Element("browser"); env.root.appendChild(content); content.focus();
  let retried = 0;
  const ui = showSortProgress({ onRetry: () => retried++, onUndo() {}, onSetup() {} });
  ui.retryAvailable(); ui.finish("AI setup changed", true);
  const row = env.row(), retry = row.querySelector('[data-action="retry"]');
  assert.equal(env.document.activeElement, content);
  assert.deepEqual(actions(row).map((node) => node.textContent), ["Undo"]);
  retry.emit("click"); assert.equal(retried, 0);
  row.querySelector('[data-action="undo"]').focus(); ui.setUndoAvailable(false);
  assert.deepEqual(actions(row).map((node) => node.textContent), ["Retry"]);
  assert.equal(env.document.activeElement, retry);
  ui.setupAvailable();
  assert.deepEqual(actions(row).map((node) => node.textContent), ["Setup"]);
  assert.equal(env.document.activeElement, row.querySelector('[data-action="setup"]'));
  retry.emit("click"); assert.equal(retried, 0);
});

test("a failed Retry callback is contained and can be attempted again without an unhandled rejection", async (t) => {
  const env = environment(t); let retried = 0;
  const ui = showSortProgress({ onRetry: () => {
    retried++;
    if (retried === 1) throw new Error("synchronous retry failure");
    return Promise.reject(new Error("asynchronous retry failure"));
  } });
  ui.retryAvailable(); ui.finish("Workspace changed");
  const retry = env.row().querySelector('[data-action="retry"]');
  retry.emit("click"); assert.equal(retry.disabled, false);
  retry.emit("click"); retry.emit("click"); assert.equal(retried, 2); assert.equal(retry.disabled, true);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(retry.disabled, false);
  ui.remove(); retry.emit("click"); assert.equal(retried, 2);
  assert.equal(retry.listenerCount(), 0); assert.equal(env.observers.size, 0); assert.equal(env.timers.size, 0);
});

test("Retry feedback keeps native Escape dismissal and releases its controls on cleanup", (t) => {
  const env = environment(t); let retried = 0, dismissed = 0;
  const ui = showSortProgress({ onRetry: () => retried++, onDismiss: () => dismissed++ });
  ui.retryAvailable(); ui.finish("Workspace changed");
  const row = env.row(), retry = row.querySelector('[data-action="retry"]');
  row.emit("keydown", { key: "Escape" });
  assert.equal(env.row(), null); assert.equal(dismissed, 1);
  assert.equal(row.listenerCount(), 0); assert.equal(retry.listenerCount(), 0);
  assert.equal(env.window.listenerCount(), 0); assert.equal(env.observers.size, 0); assert.equal(env.timers.size, 0);
  retry.emit("click"); env.window.emit("unload");
  assert.equal(retried, 0); assert.equal(dismissed, 1);
});

test("native separator owns progress and its original button becomes persistent Stop", (t) => {
  const env = environment(t, { inline: true }); let stops = 0;
  const ui = showSortProgress({ onStop: () => stops++ });
  assert.equal(env.row().parentElement, env.separator);
  assert.equal(env.row().getAttribute("data-placement"), "separator");
  assert.equal(env.wand.getAttribute("aria-label"), "Stop sorting");
  assert.equal(env.wand.hasAttribute("data-zao-busy"), true);
  assert.equal(env.sidebarHost.children.length, 1);
  assert.equal(ui.stop(), true); assert.equal(ui.stop(), true); assert.equal(stops, 1);
  assert.equal(env.wand.hasAttribute("disabled"), true);
  ui.finish("Sorted", true);
  assert.equal(env.wand.getAttribute("aria-label"), "Organize tabs");
  assert.equal(env.wand.hasAttribute("disabled"), false);
  assert.equal(env.separator.getAttribute("data-zao-state"), "finished");
  ui.remove();
  assert.equal(env.window._zaoSeparatorOperation, undefined);
  assert.equal(env.separator.hasAttribute("data-zao-state"), false);
});

test("native separator keeps Retry explicit and consent recovery prefers Setup", (t) => {
  const env = environment(t, { inline: true }); let retries = 0;
  const ui = showSortProgress({ onRetry: () => retries++, onSetup() {} });
  ui.retryAvailable(); ui.finish("New setup");
  const retry = env.row().querySelector('[data-action="retry"]');
  assert.equal(retry.hidden, false); retry.emit("click"); retry.emit("click");
  assert.equal(retries, 1);
  ui.setupAvailable();
  assert.equal(retry.hidden, true);
  assert.equal(env.row().querySelector('[data-action="setup"]').hidden, false);
  env.advance(10000); assert.equal(env.row().isConnected, true);
  ui.remove(); assert.equal(env.observers.size, 0); assert.equal(env.timers.size, 0);
});

test("native Undo removal releases operation callbacks and restores the button", async (t) => {
  const env = environment(t, { inline: true });
  const ui = showSortProgress({ onUndo() {} }); ui.finish("Sorted", true);
  env.row().remove(); await Promise.resolve();
  assert.equal(env.window._zaoSeparatorOperation, undefined);
  assert.equal(env.wand.hasAttribute("data-zao-busy"), false);
  assert.equal(env.observers.size, 0); assert.equal(env.timers.size, 0);
});

test("native Retry stays usable when an empty workspace produces no replacement operation", async (t) => {
  const env = environment(t, { inline: true }); let retries = 0;
  const ui = showSortProgress({ onRetry: async () => retries++ });
  ui.retryAvailable(); ui.finish("Nothing to organize");
  const retry = env.row().querySelector('[data-action="retry"]');
  retry.emit("click"); retry.emit("click"); assert.equal(retries, 1);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(retry.disabled, false); retry.emit("click"); assert.equal(retries, 2);
  ui.remove();
});
