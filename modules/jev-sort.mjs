import { CONFIG, LOG, PRESET_COLORS } from "./config.mjs";
import { getEligibleTabs } from "./tabs.mjs";
import { findExistingGroup, findSafeInsertAnchor, expandIfCollapsed, collapseGroup, applyGroupColor } from "./groups.mjs";
import { captureTabSnapshot, isTabSnapshotCurrent } from "./sort-plan.mjs";
import { readJevSettings, readSavedCategories, writeSavedCategories, suggestCategories } from "./jev-categories.mjs";
import { readProviderSettings } from "./provider-settings.mjs";
import { getProviderReadiness } from "./provider-readiness.mjs";
import { providerJson } from "./remote-provider.mjs";
import { JevError, sortJevBatches, decisionEndpoint } from "./jev-provider.mjs";
import { previewCategories, showJevProgress } from "./jev-ui.mjs";
import { showToast } from "./ui-toast.mjs";
import { captureTidyMotion } from "./tidy-motion.mjs";
import { sortFailureNotice } from "./sort-failure.mjs";
import { openAISetup } from "./setup-navigation.mjs";
import { captureLayout, recordSortUndo, undoLastSort, clearSortUndo, canUndoLastSort } from "./tab-history.mjs";

let activeSort = null;
export const stopJevSort = () => activeSort?.abort();
export const invalidateJevUndo = () => { clearSortUndo(); document.querySelector(".zao-sort-progress")?.remove(); };

const settingsStamp = () => Object.entries(CONFIG).filter(([key]) => key.endsWith("_PREF") && (key.startsWith("AI_") || key === "RULES_PREF" || key === "SKIP_DOMAINS_PREF"))
  .map(([, name]) => {
    const type = Services.prefs.getPrefType(name);
    return [name, type === Services.prefs.PREF_BOOL ? Services.prefs.getBoolPref(name) : type === Services.prefs.PREF_STRING ? Services.prefs.getStringPref(name) : null];
  });

export const undoJevSort = () => { if (!activeSort) return undoLastSort(); };

export const runJevSort = async ({ tabs, workspaceId, snapshot, sourceOverride, previewOverride, persistCategories = true }) => {
  const settings = { ...readJevSettings(Services.prefs), ...(sourceOverride ? { source: sourceOverride } : {}), ...(previewOverride !== undefined ? { preview: previewOverride } : {}) };
  if (!settings.consent || !settings.endpoint || !settings.apiKey || !settings.model) { showToast("Configure a decision provider and allow sending tab metadata in settings first."); return; }
  try { decisionEndpoint(settings.endpoint); } catch (error) { showToast(error.message); return; }
  let categories = sourceOverride === "suggest" ? [] : readSavedCategories(Services.prefs, workspaceId);
  const needsSuggestion = settings.source === "suggest" || (!categories.length && settings.source === "reuse");
  const categoryProvider = readProviderSettings(Services.prefs, settings.categoryProvider);
  if (needsSuggestion && !getProviderReadiness(categoryProvider).ok) { showToast("Configure the category suggestion provider, or define your categories in settings."); return; }
  if (!needsSuggestion && !categories.length) { showToast("Define at least one category in settings before sorting."); return; }
  const controller = new AbortController(); activeSort = controller;
  const original = captureLayout();
  const rulesBefore = Services.prefs.getStringPref(CONFIG.RULES_PREF, "");
  let expected = snapshot, stamp = JSON.stringify(settingsStamp());
  const created = new Set();
  const targets = new Map();
  const isCurrent = () => window.gZenWorkspaces?.activeWorkspace === workspaceId &&
    isTabSnapshotCurrent(expected, getEligibleTabs().tabs) && stamp === JSON.stringify(settingsStamp());
  const ui = showJevProgress(stopJevSort, undoJevSort, openAISetup);
  const refresh = () => { expected = captureLayout(); };
  let moved = 0, changed = false;
  const move = ({ tabInfo, groupName }) => {
    const tab = tabInfo._tab;
    let group = targets.get(groupName);
    if (!group?.isConnected) group = findExistingGroup(groupName, workspaceId);
    if (group && tab.closest("tab-group") === group) return false;
    changed = true;
    if (group) {
      const collapsed = expandIfCollapsed(group);
      gBrowser.moveTabToExistingGroup(tab, group);
      if (collapsed && !group.querySelector("tab[selected]")) collapseGroup(group);
    } else {
      if (tab.closest("tab-group")) gBrowser.ungroupTab(tab);
      const color = PRESET_COLORS[categories.findIndex((category) => category.name === groupName) % PRESET_COLORS.length].name;
      group = gBrowser.addTabGroup([tab], { label: groupName, color, insertBefore: findSafeInsertAnchor() });
      if (!group) throw new JevError("Zen could not create a category group.");
      group.setAttribute("zen-workspace-id", workspaceId);
      applyGroupColor(group, color); created.add(group);
    }
    targets.set(groupName, group); moved++;
    return true;
  };
  try {
    if (needsSuggestion) categories = await suggestCategories(tabs, categories,
      (prompt, signal) => providerJson(categoryProvider, prompt, 4096, signal), controller.signal);
    controller.signal.throwIfAborted();
    if (!isCurrent()) throw new JevError("Tabs or settings changed while preparing categories. Run sorting again.");
    if (settings.preview) {
      ui.stage("Review categories to start sorting…");
      categories = await previewCategories(categories, controller.signal);
      if (!categories) { ui.finish("Review cancelled. Your tabs are unchanged.", canUndoLastSort()); return; }
    }
    controller.signal.throwIfAborted();
    if (!isCurrent()) throw new JevError("Tabs or settings changed while reviewing categories. Run sorting again.");
    if (persistCategories) { writeSavedCategories(Services.prefs, workspaceId, categories); stamp = JSON.stringify(settingsStamp()); }
    ui.stage(`Organizing · 0 / ${tabs.length}`);
    // Keep the selected tab stationary until the last batch, without selecting
    // another tab or slowing down the animation for other tabs.
    const orderedTabs = [...tabs.filter((tab) => tab._tab !== gBrowser.selectedTab), ...tabs.filter((tab) => tab._tab === gBrowser.selectedTab)];
    const result = await sortJevBatches({ tabs: orderedTabs, categories, settings, signal: controller.signal, isCurrent,
      applyBatch: (assignments) => {
        let count = 0;
        const motion = captureTidyMotion(workspaceId);
        try { for (const assignment of assignments) if (move(assignment)) count++; }
        finally { window.gZenWorkspaces.updateTabsContainers?.(); refresh(); motion.play(); }
        return count;
      }, onProgress: ui.update,
    });
    ui.finish(`Sorted ${result.processed} tabs · ${moved} moved · ${result.skipped + result.unresolved} kept`, changed);
  } catch (error) {
    const message = controller.signal.aborted ? "Sorting stopped. Completed moves were kept." :
      /Tabs or settings changed/.test(error.message) ? error.message : sortFailureNotice(error, "jev").message;
    if (!controller.signal.aborted) ui.setupAvailable?.();
    console.warn(`${LOG} ${message}`); ui.finish(message, changed);
  } finally {
    const canUndo = recordSortUndo(original, { workspaceId, expectedLayout: expected, rulesBefore, rulesAfter: rulesBefore });
    ui.setUndoAvailable(canUndo);
    activeSort = null;
  }
};
