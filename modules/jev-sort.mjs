import { CONFIG, LOG, PRESET_COLORS } from "./config.mjs";
import { getEligibleTabs } from "./tabs.mjs";
import { findExistingGroup, findSafeInsertAnchor, expandIfCollapsed, collapseGroup, applyGroupColor } from "./groups.mjs";
import { captureTabSnapshot, isTabSnapshotCurrent } from "./sort-plan.mjs";
import { readJevSettings, readSavedCategories, writeSavedCategories, suggestCategories } from "./jev-categories.mjs";
import { readProviderSettings } from "./provider-settings.mjs";
import { getProviderReadiness } from "./provider-readiness.mjs";
import { providerJson } from "./remote-provider.mjs";
import { JevError, sortJevBatches } from "./jev-provider.mjs";
import { previewCategories, showJevProgress, highlightSortedTab } from "./jev-ui.mjs";
import { showToast } from "./ui-toast.mjs";

let activeSort = null;
let lastSort = null;
export const stopJevSort = () => activeSort?.abort();
export const invalidateJevUndo = () => { lastSort = null; document.querySelector(".zao-jev-progress")?.remove(); };

const settingsStamp = () => Object.entries(CONFIG).filter(([key]) => key.endsWith("_PREF") && (key.startsWith("AI_") || key === "RULES_PREF" || key === "SKIP_DOMAINS_PREF"))
  .map(([, name]) => {
    const type = Services.prefs.getPrefType(name);
    return [name, type === Services.prefs.PREF_BOOL ? Services.prefs.getBoolPref(name) : type === Services.prefs.PREF_STRING ? Services.prefs.getStringPref(name) : null];
  });

const groupAppearance = (group) => group ? { label: group.getAttribute("label"), color: group.color,
  collapsed: group.hasAttribute("collapsed"), style: group.getAttribute("style"), className: group.className } : null;
const captureLayout = () => {
  const positions = new Map(Array.from(gBrowser.tabs).map((tab, index) => [tab, index]));
  return captureTabSnapshot(getEligibleTabs().tabs).map((entry) => ({ ...entry,
    position: positions.get(entry.ref), appearance: groupAppearance(entry.group),
  }));
};

export const undoJevSort = () => {
  if (!lastSort || activeSort) return;
  const { workspaceId, original, expected, created } = lastSort;
  if (window.gZenWorkspaces?.activeWorkspace !== workspaceId) { showToast("Switch back to the sorted workspace to undo."); return; }
  // Refuse a stale undo rather than overwriting a later manual regroup/reorder.
  // The receipt remains available if the user switches back without editing.
  const current = captureLayout();
  if (!isTabSnapshotCurrent(expected, getEligibleTabs().tabs) || expected.some((entry, index) =>
    entry.position !== current[index]?.position || JSON.stringify(entry.appearance) !== JSON.stringify(current[index]?.appearance))) {
    showToast("The tab layout changed after sorting; undo would overwrite those changes."); return;
  }
  const restoredGroups = new Map();
  for (const entry of original) {
    // Empty native groups can still be connected while Firefox's queued
    // removal is pending. Refilling one would lose its tabs on that removal.
    if (entry.group?.isConnected && entry.group.querySelector("tab")) restoredGroups.set(entry.group, entry.group);
  }
  try {
    for (const entry of original) {
      const tab = entry.ref;
      if (!entry.group) { if (tab.closest("tab-group")) gBrowser.ungroupTab(tab); continue; }
      let group = restoredGroups.get(entry.group);
      if (!group) {
        if (tab.closest("tab-group")) gBrowser.ungroupTab(tab);
        group = gBrowser.addTabGroup([tab], { label: entry.appearance.label, color: entry.appearance.color, insertBefore: findSafeInsertAnchor() });
        if (!group) throw new Error("Group could not be restored.");
        if (entry.appearance.style !== null) group.setAttribute("style", entry.appearance.style);
        group.className = entry.appearance.className;
        restoredGroups.set(entry.group, group);
      } else if (tab.closest("tab-group") !== group) { expandIfCollapsed(group); gBrowser.moveTabToExistingGroup(tab, group); }
    }
    const positionedGroups = new Set();
    for (const entry of original) {
      if (!entry.group) { gBrowser.moveTabTo(entry.ref, { tabIndex: entry.position, forceUngrouped: true }); continue; }
      const group = restoredGroups.get(entry.group);
      if (!positionedGroups.has(group)) {
        gBrowser.moveTabTo(group, { tabIndex: entry.position });
        positionedGroups.add(group);
      }
      gBrowser.moveTabTo(entry.ref, { tabIndex: entry.position });
    }
    for (const [old, group] of restoredGroups) {
      if (original.find((entry) => entry.group === old)?.appearance.collapsed && !group.querySelector("tab[selected]")) collapseGroup(group);
    }
    for (const group of created) if (group.isConnected && !group.querySelector("tab")) group.remove();
    window.gZenWorkspaces.updateTabsContainers?.();
    lastSort = null; document.querySelector(".zao-jev-progress")?.remove(); showToast("Jev sort undone.");
  } catch (error) { console.warn(`${LOG} undo failed: ${error.message}`); showToast("Undo could not finish. The remaining tabs were kept."); }
};

export const runJevSort = async ({ tabs, workspaceId, snapshot }) => {
  const settings = readJevSettings(Services.prefs);
  if (!settings.consent || !settings.apiKey || !settings.model) { showToast("Configure Jev and allow sending tab metadata in settings first."); return; }
  let categories = readSavedCategories(Services.prefs, workspaceId);
  const needsSuggestion = settings.source === "suggest" || (!categories.length && settings.source === "reuse");
  const categoryProvider = readProviderSettings(Services.prefs, settings.categoryProvider);
  if (needsSuggestion && !getProviderReadiness(categoryProvider).ok) { showToast("Configure the category suggestion provider, or define your Jev categories in settings."); return; }
  if (!needsSuggestion && !categories.length) { showToast("Define at least one Jev category in settings before sorting."); return; }
  invalidateJevUndo();
  const controller = new AbortController(); activeSort = controller;
  const original = captureLayout();
  let expected = snapshot, stamp = JSON.stringify(settingsStamp());
  const created = new Set();
  const targets = new Map();
  const isCurrent = () => window.gZenWorkspaces?.activeWorkspace === workspaceId &&
    isTabSnapshotCurrent(expected, getEligibleTabs().tabs) && stamp === JSON.stringify(settingsStamp());
  const ui = showJevProgress(stopJevSort, undoJevSort);
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
    targets.set(groupName, group); highlightSortedTab(tab); moved++;
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
      if (!categories) { ui.remove(); return; }
    }
    controller.signal.throwIfAborted();
    if (!isCurrent()) throw new JevError("Tabs or settings changed while reviewing categories. Run sorting again.");
    writeSavedCategories(Services.prefs, workspaceId, categories); stamp = JSON.stringify(settingsStamp());
    ui.stage(`Organizing · 0 / ${tabs.length}`);
    // Keep the selected tab stationary until the last batch, without selecting
    // another tab or slowing down the animation for other tabs.
    const orderedTabs = [...tabs.filter((tab) => tab._tab !== gBrowser.selectedTab), ...tabs.filter((tab) => tab._tab === gBrowser.selectedTab)];
    const result = await sortJevBatches({ tabs: orderedTabs, categories, settings, signal: controller.signal, isCurrent,
      applyBatch: (assignments) => {
        let count = 0;
        try { for (const assignment of assignments) if (move(assignment)) count++; }
        finally { window.gZenWorkspaces.updateTabsContainers?.(); refresh(); }
        return count;
      }, onProgress: ui.update,
    });
    ui.finish(`Sorted ${result.processed} tabs · ${moved} moved · ${result.skipped + result.unresolved} kept`, changed);
  } catch (error) {
    const message = controller.signal.aborted ? "Sorting stopped. Completed moves were kept." : error instanceof JevError ? error.message : "Jev sorting could not finish. Check your provider settings.";
    console.warn(`${LOG} ${message}`); ui.finish(message, changed);
  } finally {
    if (changed) lastSort = { workspaceId, original, expected, created };
    activeSort = null;
  }
};
