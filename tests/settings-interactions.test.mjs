import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONFIG } from "../modules/config.mjs";
import { setupSettingsObserver, teardownSettingsObserver } from "../modules/prefs-ui.mjs";
import { buildRulesEditor } from "../modules/widget.mjs";
import { buildSavedCategoryEditor } from "../modules/jev-ui.mjs";

class Element {
  constructor(tag = "div") {
    this.localName = tag; this.nodeType = 1; this.children = []; this.dataset = {};
    this.listeners = new Map(); this.attributes = new Map(); this.style = {};
    this.className = ""; this.value = ""; this._text = ""; this.hidden = false;
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(" "); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(" "); },
      toggle: (name, force) => { const enabled = force ?? !this.classList.contains(name); enabled ? this.classList.add(name) : this.classList.remove(name); return enabled; },
    };
  }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  get firstChild() { return this.children[0]; }
  get firstElementChild() { return this.children[0]; }
  get lastElementChild() { return this.children.at(-1); }
  get parentElement() { return this.parentNode; }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1]; }
  get nextElementSibling() { return this.nextSibling; }
  get isConnected() { return this._connected || Boolean(this.parentNode?.isConnected); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === "id") this.id = String(value); }
  getAttribute(name) { return name === "id" ? this.id : this.attributes.get(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...children) { for (const child of children) this.appendChild(child); }
  appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
  insertBefore(child, reference) { child.remove(); child.parentNode = this; const index = this.children.indexOf(reference); this.children.splice(index < 0 ? this.children.length : index, 0, child); return child; }
  replaceChildren(...children) { for (const child of this.children) child.parentNode = null; this.children = []; this.append(...children); }
  remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
  matches(selector) {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    const tag = selector.match(/^[a-z-]+/i)?.[0];
    if (tag && tag !== this.localName) return false;
    if (![...selector.replace(/\[[^\]]*\]/g, "").matchAll(/\.([\w-]+)/g)].every((match) => this.classList.contains(match[1]))) return false;
    return [...selector.matchAll(/\[([\w-]+)(?:=['"]?([^\]'"]+)['"]?)?\]/g)].every(([, name, value]) => {
      const actual = name.startsWith("data-") ? this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] : this.getAttribute(name);
      return value === undefined ? actual !== undefined : actual === value;
    });
  }
  querySelectorAll(selector) {
    const alternatives = selector.split(",").map((part) => part.trim().split(/\s+/));
    const matchesPath = (node, parts) => {
      if (!node.matches(parts.at(-1))) return false;
      let ancestor = node.parentNode;
      for (let index = parts.length - 2; index >= 0; index--) {
        while (ancestor && !ancestor.matches(parts[index])) ancestor = ancestor.parentNode;
        if (!ancestor) return false;
        ancestor = ancestor.parentNode;
      }
      return true;
    };
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
    return selector === "*" ? descendants : descendants.filter((node) => alternatives.some((parts) => matchesPath(node, parts)));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector); }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== listener)); }
  emit(type, data = {}) { for (const listener of this.listeners.get(type) || []) listener({ target: this, stopPropagation() {}, preventDefault() {}, ...data }); }
  focus() { document.activeElement = this; }
}

const withEnvironment = async (action) => {
  const keys = ["document", "window", "Services", "MutationObserver", "CSS", "fetch"];
  const previous = Object.fromEntries(keys.map((key) => [key, globalThis[key]]));
  const preferences = JSON.parse(readFileSync(new URL("../preferences.json", import.meta.url)));
  const values = new Map(preferences.filter((pref) => pref.property).map((pref) => [pref.property, pref.defaultValue]));
  const observers = new Map(), mutationObservers = [];
  const root = new Element("html"); root._connected = true;
  const body = root.appendChild(new Element("body"));
  const prefs = {
    getStringPref: (key, fallback = "") => values.get(key) ?? fallback,
    getBoolPref: (key, fallback = false) => values.get(key) ?? fallback,
    setStringPref(key, value) { values.set(key, value); for (const observer of observers.get(key) || []) observer.observe(null, "nsPref:changed", key); },
    setBoolPref(key, value) { values.set(key, value); },
    clearUserPref(key) { values.delete(key); },
    addObserver(key, observer) { observers.set(key, [...(observers.get(key) || []), observer]); },
    removeObserver(key, observer) { observers.set(key, (observers.get(key) || []).filter((item) => item !== observer)); },
  };
  try {
    globalThis.document = { body, documentElement: root, head: root, createElement: (tag) => new Element(tag), createElementNS: (_namespace, tag) => new Element(tag), querySelector: (selector) => root.querySelector(selector), querySelectorAll: (selector) => root.querySelectorAll(selector) };
    globalThis.window = { gZenWorkspaces: { activeWorkspace: "work" } };
    globalThis.Services = { prefs, wm: { getMostRecentWindow: () => null } };
    globalThis.CSS = { escape: (value) => value };
    globalThis.fetch = async () => ({ ok: true, text: async () => "" });
    globalThis.MutationObserver = class {
      constructor(callback) { this.callback = callback; this.disconnected = false; mutationObservers.push(this); }
      observe(target) { this.target = target; }
      disconnect() { this.disconnected = true; }
    };
    await action({ root, body, prefs, values, observers, mutationObservers, preferences });
    await Promise.resolve();
  } finally {
    teardownSettingsObserver();
    for (const key of keys) previous[key] === undefined ? delete globalThis[key] : globalThis[key] = previous[key];
  }
};

const mountSettings = ({ body, preferences }) => {
  const dialog = body.appendChild(new Element("dialog")); dialog.className = "sineItemPreferenceDialog";
  const content = dialog.appendChild(new Element("div")); content.className = "sineItemPreferenceDialogContent";
  for (const preference of preferences) {
    const row = content.appendChild(new Element("vbox"));
    if (preference.type === "separator") {
      const label = row.appendChild(new Element("label")); label.className = "separator-label"; label.textContent = preference.label;
    } else {
      row.id = preference.property.replace(/\./g, "-");
      const label = row.appendChild(new Element("label")); label.className = "sineItemPreferenceLabel"; label.textContent = preference.label;
      row.appendChild(new Element(preference.type === "dropdown" ? "menulist" : "input"));
    }
  }
  setupSettingsObserver();
  return { dialog, row: (key) => dialog.querySelector(`#${key.replace(/\./g, "-")}`) };
};

const openAdvanced = async (dialog) => {
  const advanced = dialog.querySelector(".zao-advanced-settings");
  advanced.open = true; advanced.emit("toggle");
  for (let attempt = 0; attempt < 30 && !dialog.querySelector(".zao-rules-editor"); attempt++)
    await new Promise(setImmediate);
  assert.ok(dialog.querySelector(".zao-rules-editor"), "advanced editors load on demand");
};

test("primary settings contain only AI setup and leave legacy data unloaded", async () => withEnvironment(async (env) => {
  const saved = JSON.stringify([{ name: "Saved", domains: ["example.com"], titleTerms: [] }]);
  env.values.set(CONFIG.RULES_PREF, saved);
  const { dialog } = mountSettings(env);
  const primary = dialog.querySelector(".zao-simple-settings");
  assert.equal(dialog.querySelector(".zao-advanced-settings").open, undefined);
  assert.equal(dialog.querySelector(".zao-rules-editor"), null);
  assert.equal(dialog.querySelector(".zao-jev-category-settings"), null);
  assert.equal(primary.querySelectorAll("select").length, 1);
  const engine = primary.querySelector("select");
  assert.equal(engine.value, "off");
  engine.value = "openai"; engine.emit("change");
  assert.equal(primary.querySelector(`input[data-pref="${CONFIG.AI_OPENAI_API_KEY_PREF}"]`).type, "password");
  assert.equal(primary.querySelector(`input[data-pref="${CONFIG.AI_GROUP_EMOJI_PREF}"]`).checked, true);
  const emoji = primary.querySelector(`input[data-pref="${CONFIG.AI_GROUP_EMOJI_PREF}"]`);
  emoji.checked = false; emoji.emit("change");
  assert.equal(env.values.get(CONFIG.AI_GROUP_EMOJI_PREF), false);
  assert.equal(primary.querySelector(`input[data-pref="${CONFIG.AI_REVIEW_PREF}"]`).checked, false);
  assert.equal(primary.querySelector(`input[data-pref="${CONFIG.AI_PROVIDER_CONSENT_PREF}"]`).checked, false);
  assert.equal(env.values.get(CONFIG.RULES_PREF), saved);
  await openAdvanced(dialog);
  assert.equal(dialog.querySelectorAll(".zao-row").length, 1);
  assert.ok(dialog.querySelector(".zao-advanced-content").querySelectorAll("button").some((button) => button.textContent === "Run advanced sorting"));
  assert.equal(env.values.get(CONFIG.RULES_PREF), saved);
}));

test("advanced native selects track effective modes and category providers", async () => withEnvironment(async (env) => {
  env.values.set(CONFIG.AI_ENGINE_PREF, "ollama");
  const { dialog, row } = mountSettings(env);
  await openAdvanced(dialog);
  const engine = row(CONFIG.AI_ENGINE_PREF).querySelector(".zao-settings-select");
  assert.equal(engine.localName, "select");
  assert.equal(engine.getAttribute("aria-labelledby"), row(CONFIG.AI_ENGINE_PREF).querySelector("label").id);
  assert.equal(row(CONFIG.AI_NEW_GROUP_BEHAVIOR_PREF).classList.contains("zao-pref-hidden"), false);

  const mode = row(CONFIG.AI_SORT_MODE_PREF).querySelector(".zao-settings-select");
  mode.value = "full-ai"; mode.emit("change");
  assert.equal(env.values.get(CONFIG.AI_SORT_MODE_PREF), "full-ai");
  for (const key of [CONFIG.AI_EXISTING_BEHAVIOR_PREF, CONFIG.AI_NEW_GROUP_BEHAVIOR_PREF, CONFIG.AI_TITLE_LEARNING_PREF])
    assert.equal(row(key).classList.contains("zao-pref-hidden"), true);
  assert.equal(dialog.querySelector(".zao-sort-mode-note").hidden, false);
  env.prefs.setStringPref(CONFIG.AI_SORT_MODE_PREF, "rules-first");
  assert.equal(mode.value, "rules-first");
  assert.equal(row(CONFIG.AI_NEW_GROUP_BEHAVIOR_PREF).classList.contains("zao-pref-hidden"), false);

  env.prefs.setStringPref(CONFIG.AI_ENGINE_PREF, "jev");
  env.prefs.setStringPref(CONFIG.AI_JEV_CATEGORY_PROVIDER_PREF, "gemini");
  assert.equal(row(CONFIG.AI_GEMINI_MODEL_PREF).classList.contains("zao-pref-hidden"), false);
  assert.ok(dialog.querySelector(".zao-simple-settings").querySelector(`input[data-pref="${CONFIG.AI_GEMINI_MODEL_PREF}"]`),
    "changing the category provider externally refreshes primary connection fields");
  assert.equal(row(CONFIG.AI_OPENAI_MODEL_PREF).classList.contains("zao-pref-hidden"), true);
  env.prefs.setStringPref(CONFIG.AI_JEV_CATEGORY_SOURCE_PREF, "manual");
  assert.equal(row(CONFIG.AI_JEV_CATEGORY_PROVIDER_PREF).classList.contains("zao-pref-hidden"), true);
  assert.equal(row(CONFIG.AI_GEMINI_MODEL_PREF).classList.contains("zao-pref-hidden"), true);
  teardownSettingsObserver();
  assert.equal([...env.observers.values()].flat().length, 0);
  assert.ok(env.mutationObservers.every((observer) => observer.disconnected));
}));

test("settings discovery does not accumulate dialog watchers and cleans detached dialogs", async () => withEnvironment(async (env) => {
  const { dialog } = mountSettings(env);
  const discovery = env.mutationObservers.find((observer) => observer.target === env.body);
  const watcherCount = env.mutationObservers.length;
  for (let index = 0; index < 5; index++) discovery.callback([{ addedNodes: [dialog], target: env.body }]);
  assert.equal(env.mutationObservers.length, watcherCount);
  dialog.remove();
  discovery.callback([{ addedNodes: [], target: env.body }]);
  assert.ok(env.mutationObservers.filter((observer) => observer.target === dialog).every((observer) => observer.disconnected));
}));

test("rules can be searched without changing priority and reordered by keyboard with focus retained", async () => withEnvironment(async (env) => {
  const rules = [
    { name: "Work", domains: ["github.com"], titleTerms: [] },
    { name: "Reading", domains: [], titleTerms: ["research"] },
  ];
  const editor = env.body.appendChild(buildRulesEditor(rules));
  const search = editor.querySelector(".zao-rules-search");
  search.focus(); search.value = "RESEARCH"; search.emit("input");
  assert.equal(editor.querySelectorAll(".zao-row").length, 1);
  assert.equal(editor.querySelector(".zao-rules-count").textContent, "1 of 2 groups");
  assert.equal(document.activeElement, search);
  assert.equal(editor.querySelector(".zao-row-grip").disabled, true);
  search.value = "no result"; search.emit("input");
  assert.match(editor.querySelector(".zao-empty").textContent, /No groups match/);
  editor.querySelector(".zao-rules-clear").emit("click");
  const firstHandle = editor.querySelector(".zao-row-grip");
  firstHandle.emit("keydown", { altKey: true, key: "ArrowDown" });
  assert.deepEqual(rules.map((rule) => rule.name), ["Reading", "Work"]);
  assert.equal(document.activeElement.getAttribute("aria-label"), "Reorder Work");
  assert.deepEqual(JSON.parse(env.values.get(CONFIG.RULES_PREF)).map((rule) => rule.name), ["Reading", "Work"]);
}));

test("unsaved workspace category drafts survive reopening and switching workspaces", async () => withEnvironment(async (env) => {
  env.values.set(CONFIG.AI_JEV_CATEGORIES_PREF, JSON.stringify({
    work: [{ name: "Work", description: "Project work", examples: [] }],
    personal: [{ name: "Reading", description: "Articles", examples: [] }],
  }));
  const editor = env.body.appendChild(buildSavedCategoryEditor());
  let name = editor.querySelector(".zao-category-row input");
  name.value = "Unsaved work"; name.emit("input");
  editor._zaoRefresh();
  assert.equal(editor.querySelector(".zao-category-row input"), name);
  window.gZenWorkspaces.activeWorkspace = "personal"; editor._zaoRefresh();
  assert.equal(editor.querySelector(".zao-category-row input").value, "Reading");
  window.gZenWorkspaces.activeWorkspace = "work"; editor._zaoRefresh();
  assert.equal(editor.querySelector(".zao-category-row input").value, "Unsaved work");
  const save = editor.querySelectorAll("button").find((button) => button.textContent === "Save categories");
  save.emit("click");
  assert.equal(JSON.parse(env.values.get(CONFIG.AI_JEV_CATEGORIES_PREF)).work[0].name, "Unsaved work");
  assert.equal(editor.querySelector(".zao-category-editor")._zaoIsDirty(), false);
}));
