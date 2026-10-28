// Zen Tab Wand — preferences-context setup.
// Provides a small AI connection form and lazily loads previous workflow tools.
// Sine's chrome CSS pipeline does not reach about:preferences, so styles load here.

import { CONFIG, LOG, BUILD_VERSION, h } from "./config.mjs";
import { readRulesPref, getAIEngine } from "./rules.mjs";
import { buildSimpleSettings } from "./simple-settings.mjs";

console.log(`[OpenTabSort] prefs-ui.mjs loaded — v${BUILD_VERSION}`);

let settingsObserver = null;
let advancedWidget = null;
const dialogStates = new Map();

const releaseDialog = (dialog) => {
  const state = dialogStates.get(dialog);
  if (!state) return;
  state.watcher?.disconnect();
  clearTimeout(state.pollTimer);
  delete dialog._zaoOpenWatcher;
  dialogStates.delete(dialog);
};

// Returns true if `dialog` contains a Sine separator whose label starts with
// "Group Rules" — our marker for "this is our mod's settings dialog". We use
// this instead of matching on `[mod-id]` because Sine's exact attribute scheme
// has been inconsistent across versions and our id changed mid-flight.
const isOurDialog = (dialog) => {
  if (!dialog) return false;
  for (const lbl of dialog.querySelectorAll(".separator-label")) {
    if (lbl.textContent.trim().startsWith("Group Rules")) return true;
  }
  return false;
};

const injectStylesheet = async () => {
  try {
    // ?t=<timestamp> defeats Gecko's chrome:// fetch cache so iterative CSS edits
    // show up after a simple dialog close+reopen (no Zen restart needed).
    const res = await fetch(`${CONFIG.CSS_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const css = await res.text();
    const existing = document.querySelector("style[data-zao-style]");
    if (existing) existing.remove();
    const style = document.createElement("style");
    style.setAttribute("data-zao-style", "1");
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  } catch (e) {
    console.warn(`${LOG} failed to inject stylesheet:`, e);
  }
};

// Inline section descriptions injected as siblings AFTER a Sine separator.
// We can't put paragraph-length text in the separator's label itself — Sine
// renders that as a bold section header and the long string visually breaks the
// surrounding layout. Each entry: [labelPrefix, descriptionText].
const SECTION_DESCRIPTIONS = [
  [
    "Group Rules",
    "Add groups plus URL-domain and page-title matches below; changes save instantly.",
  ],
  [
    "Skip Domains",
    "Hostnames in this list are never touched by the tidy click — matching tabs are ejected from any group and parked at the top of the workspace. Useful for tabs you want to always keep visible and ungrouped.",
  ],
  [
    "Backup & Restore",
    "Export your rules, skip list, and custom icons as JSON for safekeeping, or import a previously-saved file to restore them.",
  ],
  [
    "Look & Feel",
    "Tweaks to how grouped tabs render and how URL/title rules are prioritized.",
  ],
  [
    "AI Sorting",
    "Choose a local or remote AI engine. Decision models organize tabs live using saved category meanings, with an optional LLM pass to suggest new categories.",
  ],
];

// Tag each separator's outer container so CSS can style the row (border-bottom,
// margins) without applying layout properties to the XUL <label> itself —
// XUL labels behave unpredictably with `display: block` and pseudo-element
// overrides.
const tagSeparatorContainers = (dialog) => {
  for (const lbl of dialog.querySelectorAll(".separator-label")) {
    const container = lbl.closest("vbox") || lbl.parentElement;
    container?.classList?.add("zao-section-header-row");
  }
};

const injectSectionDescriptions = (dialog) => {
  const seps = Array.from(dialog.querySelectorAll(".separator-label"));
  for (const [prefix, text] of SECTION_DESCRIPTIONS) {
    const sep = seps.find((lbl) => lbl.textContent.trim().startsWith(prefix));
    if (!sep) continue;
    const container = sep.closest("vbox") || sep.parentElement;
    // Idempotency — re-injecting on dialog reopen shouldn't pile up <div>s.
    if (container.nextElementSibling?.classList?.contains("zao-pref-description")) continue;
    const desc = h("div");
    desc.className = "zao-pref-description";
    desc.textContent = text;
    container.parentNode.insertBefore(desc, container.nextSibling);
  }
};

// ─── Conditional field visibility ────────────────────────────────────────────
// Sine renders controls unconditionally; visibility follows the selected
// engine, effective sorting mode, and category suggestion requirements.
//
// Strategy for locating a control's row:
//   1. element with `[pref=...]` or `[property=...]` set to the pref name
//   2. fallback: walk labels, match on text, climb to nearest vbox/hbox
// Sine's exact DOM is opaque to us, so we try both.

// Sine assigns each pref's outer container an `id` derived from the pref name
// with dots replaced by dashes. e.g. `extensions.zen-auto-organize.ai-engine`
// becomes id="extensions-zen-auto-organize-ai-engine". Targeting that id
// directly is way more reliable than guessing at class names.
const findPrefRow = (dialog, prefName) => {
  const id = prefName.replace(/\./g, "-");
  return dialog.querySelector(`#${CSS.escape(id)}`);
};

const CHECKBOX_RIGHT_PREFS = [
  CONFIG.MINIMAL_STYLE_PREF,
  CONFIG.STRICT_RULES_PREF,
  CONFIG.AI_OLLAMA_WARMUP_PREF,
  CONFIG.AI_JEV_PREVIEW_PREF,
];

const CONTROL_ROW_PREFS = [
  CONFIG.MINIMAL_STYLE_PREF,
  CONFIG.STRICT_RULES_PREF,
  CONFIG.MATCH_MODE_PREF,
  CONFIG.GRADIENT_STYLE_PREF,
  CONFIG.AI_ENGINE_PREF,
  CONFIG.AI_SORT_MODE_PREF,
  CONFIG.AI_TITLE_LEARNING_PREF,
  CONFIG.AI_EXISTING_BEHAVIOR_PREF,
  CONFIG.AI_NEW_GROUP_BEHAVIOR_PREF,
  CONFIG.AI_OLLAMA_HOST_PREF,
  CONFIG.AI_OLLAMA_MODEL_PREF,
  CONFIG.AI_OLLAMA_WARMUP_PREF,
  CONFIG.AI_LOCAL_BATCH_SIZE_PREF,
  CONFIG.AI_PROVIDER_CONSENT_PREF,
  CONFIG.AI_OPENAI_ENDPOINT_PREF, CONFIG.AI_OPENAI_API_KEY_PREF, CONFIG.AI_OPENAI_MODEL_PREF,
  CONFIG.AI_GEMINI_API_KEY_PREF, CONFIG.AI_GEMINI_MODEL_PREF,
  CONFIG.AI_CUSTOM_ENDPOINT_PREF, CONFIG.AI_CUSTOM_API_KEY_PREF, CONFIG.AI_CUSTOM_MODEL_PREF, CONFIG.AI_CUSTOM_FORMAT_PREF,
  CONFIG.AI_JEV_ENDPOINT_PREF, CONFIG.AI_JEV_API_KEY_PREF, CONFIG.AI_JEV_MODEL_PREF, CONFIG.AI_JEV_CATEGORY_PROVIDER_PREF,
  CONFIG.AI_JEV_CATEGORY_SOURCE_PREF, CONFIG.AI_JEV_PREVIEW_PREF, CONFIG.AI_JEV_CONFIDENCE_PREF,
];

const DROPDOWN_PREFS = [
  CONFIG.MATCH_MODE_PREF,
  CONFIG.GRADIENT_STYLE_PREF,
  CONFIG.AI_ENGINE_PREF,
  CONFIG.AI_SORT_MODE_PREF,
  CONFIG.AI_TITLE_LEARNING_PREF,
  CONFIG.AI_EXISTING_BEHAVIOR_PREF,
  CONFIG.AI_NEW_GROUP_BEHAVIOR_PREF,
  CONFIG.AI_CUSTOM_FORMAT_PREF,
  CONFIG.AI_JEV_CATEGORY_SOURCE_PREF, CONFIG.AI_JEV_CATEGORY_PROVIDER_PREF,
];

const DROPDOWN_CONFIGS = {
  [CONFIG.MATCH_MODE_PREF]: {
    defaultValue: "url-then-title",
    options: [
      ["url-only", "URL only"],
      ["title-only", "Title only"],
      ["url-then-title", "URL then Title"],
      ["title-then-url", "Title then URL"],
    ],
  },
  [CONFIG.GRADIENT_STYLE_PREF]: {
    defaultValue: "left-right",
    options: [
      ["left-right", "Left to right"],
      ["right-left", "Right to left"],
      ["top-bottom", "Top to bottom"],
      ["bottom-top", "Bottom to top"],
      ["diagonal-down", "Diagonal down"],
      ["diagonal-up", "Diagonal up"],
      ["radial", "Radial"],
    ],
  },
  [CONFIG.AI_ENGINE_PREF]: {
    defaultValue: "off",
    options: [
      ["off", "None"],
      ["local", "Local — Built-in model, limited capability"],
      ["ollama", "Ollama — Stronger model, requires Ollama running locally"],
      ["openai", "OpenAI-compatible — Remote or self-hosted"],
      ["gemini", "Gemini — Google AI Studio"],
      ["custom", "Custom — OpenAI or Ollama-compatible endpoint"],
      ["jev", "Decision models — Jev and compatible APIs"],
    ],
  },
  [CONFIG.AI_SORT_MODE_PREF]: {
    defaultValue: "rules-first",
    options: [["rules-first", "Rules + AI — Match rules, then classify leftovers"], ["full-ai", "Full AI — Regroup all eligible tabs without saving rules"]],
  },
  [CONFIG.AI_CUSTOM_FORMAT_PREF]: {
    defaultValue: "openai",
    options: [["openai", "OpenAI-compatible chat"], ["ollama", "Ollama generate"]],
  },
  [CONFIG.AI_JEV_CATEGORY_SOURCE_PREF]: {
    defaultValue: "reuse",
    options: [["reuse", "Reuse my categories — Suggest automatically on first use"], ["suggest", "Suggest from my tabs — Refresh categories every sort"], ["manual", "Define my own — Use only saved categories"]],
  },
  [CONFIG.AI_JEV_CATEGORY_PROVIDER_PREF]: {
    defaultValue: "openai",
    options: [["openai", "OpenAI-compatible"], ["gemini", "Gemini"], ["custom", "Custom"], ["ollama", "Ollama"]],
  },
  [CONFIG.AI_TITLE_LEARNING_PREF]: {
    defaultValue: "off",
    options: [
      ["off", "None"],
      ["review-save-simple", "Review and Save (Simple)"],
      ["review-save-complex", "Review and Save (Complex)"],
    ],
  },
  [CONFIG.AI_EXISTING_BEHAVIOR_PREF]: {
    defaultValue: "always-add",
    options: [
      ["always-add", "Move + Save Domain — Move the tab and add its domain to the matched rule"],
      ["transient", "Move Once — Move the tab now; do not update saved rules"],
    ],
  },
  [CONFIG.AI_NEW_GROUP_BEHAVIOR_PREF]: {
    defaultValue: "auto-add",
    options: [
      ["auto-add", "Preview + Save Rule — Review first; kept groups become saved rules"],
      ["transient", "Group Once — Create groups now; do not save rules"],
      ["prompt", "Zen Edit Prompt — Create groups, then open Zen's rename/color dialog"],
      ["fresh-categories", "Fresh Rebuild — Ignore current rules and regroup all tabs from scratch"],
      ["identify-only", "Preview Only — Review/re-assign first; apply groups without saving rules"],
    ],
  },
};

const normalizeMatchModeLabel = (row) => {
  const label = row.querySelector(".sineItemPreferenceLabel") || row.firstElementChild;
  if (!label) return;
  label.textContent = label.textContent.replace(/^\s+/, "");
  for (const attr of ["value", "label"]) {
    if (label.hasAttribute?.(attr)) {
      label.setAttribute(attr, label.getAttribute(attr).replace(/^\s+/, ""));
    }
  }
};

const alignSettingRows = (dialog) => {
  for (const prefName of CONTROL_ROW_PREFS) {
    const row = findPrefRow(dialog, prefName);
    if (!row) continue;
    row.classList.add("zao-control-row");
    if (prefName === CONFIG.MATCH_MODE_PREF) {
      row.classList.add("zao-match-mode-row");
      normalizeMatchModeLabel(row);
    }
  }
  for (const prefName of CHECKBOX_RIGHT_PREFS) {
    const row = findPrefRow(dialog, prefName);
    if (!row) continue;
    row.classList.add("zao-checkbox-right");
    const checkbox = row.querySelector('input[type="checkbox"], checkbox, [role="checkbox"]');
    if (checkbox) {
      checkbox.classList.add("zao-checkbox-control");
      if (row.firstElementChild !== checkbox) {
        row.insertBefore(checkbox, row.firstElementChild);
      }
    }
  }
};

const dropdownConfig = (prefName) => DROPDOWN_CONFIGS[prefName];

const readStringPref = (prefName, fallback = "") => {
  try {
    const value = Services.prefs.getStringPref(prefName, fallback);
    return prefName === CONFIG.AI_SORT_MODE_PREF && value === "hybrid" ? "rules-first" : value;
  }
  catch { return fallback; }
};

const writeStringPref = (prefName, value) => {
  try { Services.prefs.setStringPref(prefName, value); }
  catch (e) { console.warn(`${LOG} failed to set ${prefName}:`, e); }
};

const selectedDropdownOption = (config, value) =>
  config.options.find(([v]) => v === value) || config.options.find(([v]) => v === config.defaultValue) || config.options[0];

const syncSettingsSelect = (dialog, prefName) => {
  const select = findPrefRow(dialog, prefName)?.querySelector(".zao-settings-select");
  const config = dropdownConfig(prefName);
  if (!select || !config) return;
  const selected = selectedDropdownOption(config, readStringPref(prefName, config.defaultValue));
  select.value = selected[0];
  select.dataset.value = selected[0];
  select.title = selected[1];
};

// Let Gecko provide the complete select keyboard and accessibility behavior.
// Keep the wrapper class for the existing Sine integration and E2E discovery.
const installSettingsSelect = (dialog, prefName) => {
  const row = findPrefRow(dialog, prefName);
  const config = dropdownConfig(prefName);
  if (!row || !config || row.querySelector(".zao-settings-select")) return;
  for (const control of row.querySelectorAll("select, menulist, button, [role='button']")) {
    control.classList.add("zao-native-dropdown-hidden");
    control.setAttribute("aria-hidden", "true");
    control.tabIndex = -1;
  }
  const wrap = h("div", { class: "zao-custom-dropdown" });
  const select = h("select", { class: "zao-settings-select zao-custom-dropdown-button" });
  select.id = `${prefName.replace(/\./g, "-")}-control`;
  const label = row.querySelector(".sineItemPreferenceLabel");
  if (label) {
    if (!label.id) label.id = `${select.id}-label`;
    select.setAttribute("aria-labelledby", label.id);
  } else {
    select.setAttribute("aria-label", prefName.split(".").pop().replace(/-/g, " "));
  }
  for (const [value, text] of config.options) {
    const option = h("option", { text });
    option.value = value;
    select.appendChild(option);
  }
  select.addEventListener("change", () => {
    writeStringPref(prefName, select.value);
    updateConditionalFields(dialog);
  });
  wrap.appendChild(select);
  row.appendChild(wrap);
  syncSettingsSelect(dialog, prefName);
};

const installSettingsSelects = (dialog) => {
  for (const prefName of DROPDOWN_PREFS) installSettingsSelect(dialog, prefName);
};

const AI_NEW_GROUP_OPTIONS = {
  local: new Set(["auto-add", "transient", "prompt", "fresh-categories", "identify-only"]),
  ollama: new Set(["auto-add", "transient", "prompt", "fresh-categories", "identify-only"]),
};

const optionValue = (option) =>
  option?.value || option?.getAttribute?.("value") || option?.getAttribute?.("data-value") || "";

const setNewGroupOptionsForEngine = (dialog, engine) => {
  const row = findPrefRow(dialog, CONFIG.AI_NEW_GROUP_BEHAVIOR_PREF);
  if (!row) return;
  const allowed = AI_NEW_GROUP_OPTIONS[engine] || (["openai", "gemini", "custom"].includes(engine) ? AI_NEW_GROUP_OPTIONS.ollama : null);
  if (!allowed) return;

  try {
    const stored = Services.prefs.getStringPref(CONFIG.AI_NEW_GROUP_BEHAVIOR_PREF, "auto-add");
    if (!allowed.has(stored)) Services.prefs.setStringPref(CONFIG.AI_NEW_GROUP_BEHAVIOR_PREF, "auto-add");
  } catch {}

  for (const option of row.querySelectorAll("option, menuitem")) {
    const value = optionValue(option);
    const hidden = value && !allowed.has(value);
    option.hidden = hidden;
    option.disabled = hidden;
    option.setAttribute("aria-hidden", hidden ? "true" : "false");
  }

  for (const control of row.querySelectorAll("select, menulist")) {
    const value = optionValue(control);
    if (value && !allowed.has(value)) {
      control.value = "auto-add";
      try { Services.prefs.setStringPref(CONFIG.AI_NEW_GROUP_BEHAVIOR_PREF, "auto-add"); } catch {}
    }
  }

  syncSettingsSelect(dialog, CONFIG.AI_NEW_GROUP_BEHAVIOR_PREF);
};

const updateConditionalFields = (dialog) => {
  const engine = getAIEngine();
  const aiEnabled = engine !== "off";
  const remote = ["openai", "gemini", "custom"].includes(engine);
  const jev = engine === "jev";
  const categoryProvider = readStringPref(CONFIG.AI_JEV_CATEGORY_PROVIDER_PREF, "openai");
  const categorySource = readStringPref(CONFIG.AI_JEV_CATEGORY_SOURCE_PREF, "reuse");
  const needsCategoryProvider = jev && categorySource !== "manual";
  const fullAI = readStringPref(CONFIG.AI_SORT_MODE_PREF, "rules-first") === "full-ai";
  const newBehavior = readStringPref(CONFIG.AI_NEW_GROUP_BEHAVIOR_PREF, "auto-add");
  const freshLike = fullAI || ["fresh-categories", "identify-only"].includes(newBehavior);
  const titleLearningAvailable = !freshLike && newBehavior !== "prompt" &&
    (readStringPref(CONFIG.AI_EXISTING_BEHAVIOR_PREF, "always-add") === "always-add" || newBehavior === "auto-add");

  const setHidden = (row, hidden) => {
    if (!row) return;
    row.classList.toggle("zao-pref-hidden", hidden);
  };

  // Ollama: shows BOTH the existing-behavior and new-group-behavior rows
  //   (they govern different parts of the unified classifier).
  // Local: ONE row only — new-group-behavior.
  //   Existing-behavior is hidden because Local unifies both decisions into
  //   the single dropdown (auto-add = grow rules; transient = don't; fresh =
  //   re-cluster ignoring rules entirely).
  const rows = {
    engine: findPrefRow(dialog, CONFIG.AI_ENGINE_PREF),
    titleLearning: findPrefRow(dialog, CONFIG.AI_TITLE_LEARNING_PREF),
    existingBehavior: findPrefRow(dialog, CONFIG.AI_EXISTING_BEHAVIOR_PREF),
    newGroupBehavior: findPrefRow(dialog, CONFIG.AI_NEW_GROUP_BEHAVIOR_PREF),
    ollamaHost: findPrefRow(dialog, CONFIG.AI_OLLAMA_HOST_PREF),
    ollamaModel: findPrefRow(dialog, CONFIG.AI_OLLAMA_MODEL_PREF),
    ollamaWarmup: findPrefRow(dialog, CONFIG.AI_OLLAMA_WARMUP_PREF),
    localBatchSize: findPrefRow(dialog, CONFIG.AI_LOCAL_BATCH_SIZE_PREF),
  };

  setHidden(rows.existingBehavior, (engine !== "ollama" && !remote) || freshLike);
  setHidden(rows.titleLearning, engine !== "ollama" || !titleLearningAvailable);
  setHidden(rows.newGroupBehavior, !aiEnabled || jev || fullAI);
  setHidden(rows.ollamaHost, engine !== "ollama" && !(needsCategoryProvider && categoryProvider === "ollama"));
  setHidden(rows.ollamaModel, engine !== "ollama" && !(needsCategoryProvider && categoryProvider === "ollama"));
  setHidden(rows.ollamaWarmup,      engine !== "ollama");
  setHidden(rows.localBatchSize, engine !== "local");
  setHidden(findPrefRow(dialog, CONFIG.AI_SORT_MODE_PREF), !aiEnabled || jev);
  setHidden(findPrefRow(dialog, CONFIG.AI_PROVIDER_CONSENT_PREF), !remote && !jev);
  for (const field of [CONFIG.AI_JEV_ENDPOINT_PREF, CONFIG.AI_JEV_API_KEY_PREF, CONFIG.AI_JEV_MODEL_PREF, CONFIG.AI_JEV_CATEGORY_PROVIDER_PREF,
    CONFIG.AI_JEV_CATEGORY_SOURCE_PREF, CONFIG.AI_JEV_PREVIEW_PREF, CONFIG.AI_JEV_CONFIDENCE_PREF]) setHidden(findPrefRow(dialog, field), !jev);
  setHidden(findPrefRow(dialog, CONFIG.AI_JEV_CATEGORY_PROVIDER_PREF), !needsCategoryProvider);
  setHidden(dialog.querySelector(".zao-jev-category-settings"), !jev);
  setHidden(findSeparatorContainer(dialog, "Decision Quick Sort"), !jev);
  for (const [provider, fields] of Object.entries({
    openai: [CONFIG.AI_OPENAI_ENDPOINT_PREF, CONFIG.AI_OPENAI_API_KEY_PREF, CONFIG.AI_OPENAI_MODEL_PREF],
    gemini: [CONFIG.AI_GEMINI_API_KEY_PREF, CONFIG.AI_GEMINI_MODEL_PREF],
    custom: [CONFIG.AI_CUSTOM_ENDPOINT_PREF, CONFIG.AI_CUSTOM_API_KEY_PREF, CONFIG.AI_CUSTOM_MODEL_PREF, CONFIG.AI_CUSTOM_FORMAT_PREF],
  })) for (const field of fields) setHidden(findPrefRow(dialog, field), engine !== provider && !(needsCategoryProvider && categoryProvider === provider));
  setHidden(findSeparatorContainer(dialog, "Remote Provider Settings"),
    !remote && !(needsCategoryProvider && ["openai", "gemini", "custom"].includes(categoryProvider)));
  const modeRow = findPrefRow(dialog, CONFIG.AI_SORT_MODE_PREF);
  let modeNote = dialog.querySelector(".zao-sort-mode-note");
  if (!modeNote && modeRow) {
    modeNote = h("p", { class: "zao-pref-description zao-sort-mode-note",
      text: "Full AI regroups all eligible tabs. Saved rules stay unchanged." });
    modeRow.parentNode.insertBefore(modeNote, modeRow.nextSibling);
  }
  if (modeNote) modeNote.hidden = !aiEnabled || jev || !fullAI;
  setNewGroupOptionsForEngine(dialog, engine);
  for (const prefName of DROPDOWN_PREFS) syncSettingsSelect(dialog, prefName);
  alignSettingRows(dialog);
};

// Keep every select and dependent row in sync with external preference edits.
// One observer per preferences-window context, removed on window unload.
let enginePrefObserver = null;
const setupEnginePrefObserver = () => {
  if (enginePrefObserver) return;
  enginePrefObserver = {
    observe(_subject, topic, data) {
      if (topic !== "nsPref:changed") return;
      if (!DROPDOWN_PREFS.includes(data)) return;
      for (const d of document.querySelectorAll(".sineItemPreferenceDialog")) {
        if (isOurDialog(d)) {
          updateConditionalFields(d);
          d.querySelector(".zao-simple-settings")?._zaoRefresh?.();
          break;
        }
      }
    },
  };
  for (const prefName of DROPDOWN_PREFS) Services.prefs.addObserver(prefName, enginePrefObserver);
};

const teardownEnginePrefObserver = () => {
  if (!enginePrefObserver) return;
  for (const prefName of DROPDOWN_PREFS) {
    try { Services.prefs.removeObserver(prefName, enginePrefObserver); } catch {}
  }
  enginePrefObserver = null;
};

// Locate a Sine separator by the prefix of its visible label, returning the
// outer container element (so injectAfter places content as a sibling of it).
const findSeparatorContainer = (dialog, prefix) => {
  for (const lbl of dialog.querySelectorAll(".separator-label")) {
    if (lbl.textContent.trim().startsWith(prefix)) {
      return lbl.closest("vbox") || lbl.parentElement;
    }
  }
  return null;
};

const insertAfter = (parent, newNode, refNode) => {
  if (refNode && refNode.parentNode === parent) {
    parent.insertBefore(newNode, refNode.nextSibling);
  } else {
    parent.insertBefore(newNode, parent.firstChild);
  }
};

const performInject = (dialog) => {
  if (dialog.querySelector(".zao-simple-settings")) return;
  const content = dialog.querySelector(".sineItemPreferenceDialogContent");
  if (!content) return;

  const advanced = h("details", { class: "zao-advanced-settings" });
  advanced.appendChild(h("summary", { text: "Advanced & saved data" }));
  const advancedContent = h("div", { class: "zao-advanced-content" });
  advanced.appendChild(advancedContent);
  // Move Sine's existing controls without changing any saved preference.
  for (const child of [...content.children]) advancedContent.appendChild(child);
  const simple = buildSimpleSettings({ onChange: () => updateConditionalFields(dialog) });
  content.append(simple, advanced);
  let initialized = false, loading = false;
  advanced.addEventListener("toggle", async () => {
    if (!advanced.open) { simple._zaoRefresh(); return; }
    if (initialized || loading) return;
    loading = true;
    try {
      const [widget, colors, categories] = await Promise.all([
        import("./widget.mjs"), import("./color-picker.mjs"), import("./jev-ui.mjs"),
      ]);
      advancedWidget = widget;
      if (!dialog.isConnected || !advanced.open) return;
      colors.fetchZenColorsFromBrowser();
      const { buildRulesEditor, buildSkipDomainsEditor, buildCustomIconsEditor, buildBackupRestoreSection } = widget;
      const { buildSavedCategoryEditor } = categories;
      const initial = readRulesPref({ keepIncomplete: true }) || [];
      const insert = (node, prefix) => insertAfter(advancedContent, node, findSeparatorContainer(advancedContent, prefix));
      insert(buildRulesEditor(initial), "Group Rules");
      insert(buildSkipDomainsEditor(), "Skip Domains");
      insert(buildCustomIconsEditor(), "Look & Feel");
      insert(buildBackupRestoreSection(), "Backup & Restore");
      insert(buildSavedCategoryEditor(), "Decision Quick Sort");
      const run = h("button", { class: "zao-backup-btn", text: "Run advanced sorting" });
      run.type = "button";
      run.addEventListener("click", () => {
        Services.wm.getMostRecentWindow("navigator:browser")?.OpenTabSortZen?.handleLegacyOrganizeClick?.();
        dialog.close();
      });
      const note = h("p", { class: "zao-pref-description",
        text: "Optional tools and settings from the previous sorting workflow. Organize tabs uses AI and leaves this saved data unchanged." });
      advancedContent.insertBefore(note, advancedContent.firstChild);
      advancedContent.insertBefore(run, note.nextSibling);
      tagSeparatorContainers(dialog);
      injectSectionDescriptions(dialog);
      installSettingsSelects(dialog);
      updateConditionalFields(dialog);
      initialized = true;
    } catch (error) {
      console.warn(`${LOG} advanced tools could not load:`, error);
    } finally { loading = false; }
  });
  setupEnginePrefObserver();
  updateConditionalFields(dialog);
};

// Sine's loadPrefs() is async — the dialog is added to DOM before its content is
// populated. Poll for the "Group Rules" separator (or legacy "Rules") to appear,
// then inject once. Also wire a re-render hook for when the dialog is reopened.
const onOurDialogFound = (dialog) => {
  // Marker class — scopes our separator-restyling CSS to our dialog only,
  // so we don't restyle SuperPins or any other mod's section headers.
  dialog.classList.add("zao-our-dialog");

  // Child mutations from our editors must not refresh the dialog: category
  // refresh replaces its children and would feed this observer indefinitely.
  // Reopening is handled by the separate observer of the dialog's open attribute.
  if (dialog.querySelector(".zao-simple-settings")) return;

  if (dialogStates.has(dialog)) return;
  const state = { watcher: null, pollTimer: null };
  dialogStates.set(dialog, state);
  if (!dialog._zaoOpenWatcher) {
    const watcher = new MutationObserver(() => {
      if (dialog.hasAttribute("open")) {
        const editor = dialog.querySelector(".zao-rules-editor");
        editor?._zaoRefresh?.("dialog open attr");
        dialog.querySelector(".zao-jev-category-settings")?._zaoRefresh?.();
        // Re-sync visibility — Sine may have re-rendered controls on reopen.
        dialog.querySelector(".zao-simple-settings")?._zaoRefresh?.();
        updateConditionalFields(dialog);
      }
    });
    watcher.observe(dialog, { attributes: true, attributeFilter: ["open"] });
    dialog._zaoOpenWatcher = watcher;
    state.watcher = watcher;
  }

  injectStylesheet();

  let attempts = 0;
  const poll = () => {
    // If the dialog was removed mid-poll (user closed the prefs page), abandon —
    // querying a detached node burns CPU and pollutes the console with warnings.
    if (!dialog.isConnected) { releaseDialog(dialog); return; }
    if (dialog.querySelector(".zao-simple-settings")) return;
    let separator = null;
    for (const lbl of dialog.querySelectorAll(".separator-label")) {
      const text = lbl.textContent.trim();
      if (text.startsWith("Group Rules") || text.startsWith("Rules")) {
        separator = lbl.closest("vbox") || lbl.parentElement;
        break;
      }
    }
    if (separator) {
      try { performInject(dialog); }
      catch (e) { console.error(`${LOG} inject failed:`, e); }
      return;
    }
    attempts++;
    if (attempts >= CONFIG.INJECT_MAX_POLL_ATTEMPTS) {
      console.warn(`${LOG} Rules separator not found after ${attempts * CONFIG.INJECT_POLL_INTERVAL_MS}ms; injecting at content top`);
      try { performInject(dialog); }
      catch (e) { console.error(`${LOG} inject failed:`, e); }
      return;
    }
    state.pollTimer = setTimeout(poll, CONFIG.INJECT_POLL_INTERVAL_MS);
  };
  poll();
};

// Watch for Sine's per-mod settings dialog. Identify by the presence of a
// "Group Rules" separator inside any .sineItemPreferenceDialog — robust against
// Sine's mod-id attribute scheme changing across versions.
let setupRequestObserver = null;
let setupRequestTimer = null;
const handleSetupRequest = () => {
  clearTimeout(setupRequestTimer);
  const request = Services.prefs.getStringPref(CONFIG.SETUP_REQUEST_PREF, "");
  if (!request) return;
  let attempts = 0;
  const open = () => {
    if (Services.prefs.getStringPref(CONFIG.SETUP_REQUEST_PREF, "") !== request) return;
    const category = document.getElementById("category-sine-mods");
    if (category && !document.getElementById("SineModsCategory")?.getBoundingClientRect().height) {
      (category.shadowRoot?.querySelector("button") || category).click();
    }
    const item = [...document.querySelectorAll(".sineItem")].find((item) =>
      item.querySelector(".sineItemTitle")?.textContent.includes("OpenTabSort"));
    const configure = item?.querySelector(".sineItemConfigureButton");
    const dialog = item?.querySelector(".sineItemPreferenceDialog");
    if (configure?.getBoundingClientRect().height && !dialog?.hasAttribute("open")) configure.click();
    const simple = dialog?.querySelector(".zao-simple-settings");
    if (simple && dialog.getBoundingClientRect().height) {
      const advanced = dialog.querySelector(".zao-advanced-settings");
      if (advanced) advanced.open = false;
      dialog.scrollTop = 0;
      simple.querySelector("select")?.focus();
      if (Services.prefs.getStringPref(CONFIG.SETUP_REQUEST_PREF, "") === request) {
        Services.prefs.clearUserPref(CONFIG.SETUP_REQUEST_PREF);
      }
      setupRequestTimer = null;
      return;
    }
    if (++attempts < 100) setupRequestTimer = setTimeout(open, 100);
    else setupRequestTimer = null;
  };
  open();
};

export const setupSettingsObserver = () => {
  if (settingsObserver) return;

  const scanForOurDialog = (root) => {
    if (!root || root.nodeType !== 1) return;
    const dialogs = [];
    if (root.matches?.(".sineItemPreferenceDialog")) dialogs.push(root);
    root.querySelectorAll?.(".sineItemPreferenceDialog").forEach((d) => dialogs.push(d));
    for (const d of dialogs) {
      if (isOurDialog(d)) onOurDialogFound(d);
    }
  };

  settingsObserver = new MutationObserver((muts) => {
    for (const dialog of dialogStates.keys()) {
      if (!dialog.isConnected) releaseDialog(dialog);
    }
    for (const m of muts) {
      for (const node of m.addedNodes) {
        scanForOurDialog(node);
      }
      // Also: a child separator-label may be added LATER to an existing dialog
      // (Sine's loadPrefs is async). Re-check the dialog the mutation happened in.
      if (m.target?.closest) {
        const dialog = m.target.closest(".sineItemPreferenceDialog");
        if (dialog && isOurDialog(dialog)) onOurDialogFound(dialog);
      }
    }
  });
  settingsObserver.observe(document.body, { childList: true, subtree: true });
  setupRequestObserver = { observe: (_subject, topic) => {
    if (topic === "nsPref:changed") handleSetupRequest();
  } };
  Services.prefs.addObserver(CONFIG.SETUP_REQUEST_PREF, setupRequestObserver);
  handleSetupRequest();

  // Catch any dialog already in the DOM at init time.
  document.querySelectorAll(".sineItemPreferenceDialog").forEach((d) => {
    if (isOurDialog(d)) onOurDialogFound(d);
  });
  console.log(`${LOG} settings observer installed`);
};

export const teardownSettingsObserver = () => {
  clearTimeout(setupRequestTimer);
  setupRequestTimer = null;
  if (setupRequestObserver) {
    try { Services.prefs.removeObserver(CONFIG.SETUP_REQUEST_PREF, setupRequestObserver); } catch {}
    setupRequestObserver = null;
  }
  if (settingsObserver) {
    settingsObserver.disconnect();
    settingsObserver = null;
  }
  for (const dialog of dialogStates.keys()) releaseDialog(dialog);
  teardownEnginePrefObserver();
  advancedWidget?.teardownRulesPrefObserver();
  advancedWidget?.teardownSkipPrefObserver();
};
