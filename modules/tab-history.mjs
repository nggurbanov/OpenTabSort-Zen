// A single session-only undo receipt per window. Never serialize live tabs.
import { CONFIG, LOG } from "./config.mjs";
import { getEligibleTabs } from "./tabs.mjs";
import { findSafeInsertAnchor, expandIfCollapsed, collapseGroup } from "./groups.mjs";
import { captureTabSnapshot, isTabSnapshotCurrent } from "./sort-plan.mjs";
import { showToast } from "./ui-toast.mjs";
import { getActiveSortSignal } from "./sort-session.mjs";
const receipts = new WeakMap();
export const clearSortUndo = () => receipts.delete(window);
export const recordSortUndo = (original, { rulesBefore, rulesAfter, expectedLayout, workspaceId = window.gZenWorkspaces.activeWorkspace } = {}) => {
  // Progressive sorts must retain the last layout they produced. Recapturing
  // after a user edit would bless that edit and let Undo overwrite it.
  const expected = expectedLayout ?? captureLayout();
  const changed = original.length !== expected.length || original.some((entry, index) => {
    const next = expected[index];
    return entry.ref !== next?.ref || entry.group !== next?.group || entry.label !== next?.label ||
      entry.position !== next?.position || JSON.stringify(entry.appearance) !== JSON.stringify(next?.appearance);
  }) ||
    (rulesBefore !== undefined && rulesBefore !== rulesAfter);
  if (!changed) return canUndoLastSort();
  const oldGroups = new Set(original.map((entry) => entry.group));
  const created = new Set(expected.map((entry) => entry.group).filter((group) => group && !oldGroups.has(group)));
  receipts.set(window, { workspaceId, original, expected, created, rulesBefore, rulesAfter });
  return true;
};
const groupAppearance = (group) => group ? { label: group.getAttribute("label"), color: group.color,
  collapsed: group.hasAttribute("collapsed"), style: group.getAttribute("style"), className: group.className } : null;
export const captureLayout = () => {
  const positions = new Map(Array.from(gBrowser.tabs).map((tab, index) => [tab, index]));
  return captureTabSnapshot(getEligibleTabs().tabs).map((entry) => ({ ...entry,
    position: positions.get(entry.ref), appearance: groupAppearance(entry.group),
  }));
};

export const canUndoLastSort = () => {
  const receipt = receipts.get(window);
  if (!receipt || window.gZenWorkspaces?.activeWorkspace !== receipt.workspaceId) return false;
  if (receipt.rulesAfter !== undefined && Services.prefs.getStringPref(CONFIG.RULES_PREF, "") !== receipt.rulesAfter) return false;
  const tabs = getEligibleTabs().tabs;
  if (!isTabSnapshotCurrent(receipt.expected, tabs)) return false;
  const current = captureLayout();
  return receipt.expected.every((entry, index) => entry.position === current[index]?.position &&
    JSON.stringify(entry.appearance) === JSON.stringify(current[index]?.appearance));
};

export const undoLastSort = () => {
  try { if (getActiveSortSignal()) return false; } catch { return false; }
  const lastSort = receipts.get(window);
  if (!lastSort) return false;
  const { workspaceId, original, expected, created, rulesBefore, rulesAfter } = lastSort;
  if (rulesAfter !== undefined && Services.prefs.getStringPref(CONFIG.RULES_PREF, "") !== rulesAfter) { showToast("Rules changed after sorting; undo would overwrite those edits."); return false; }
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
        if (!group?.isConnected) throw new Error("Group could not be restored.");
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
    const appearances = new Map(original.filter((entry) => entry.group).map((entry) => [entry.group, entry.appearance]));
    for (const [old, group] of restoredGroups) {
      const appearance = appearances.get(old);
      group.color = appearance.color;
      group.className = appearance.className;
      if (appearance.style === null) group.removeAttribute("style");
      else group.setAttribute("style", appearance.style);
      if (appearance.collapsed && !group.querySelector("tab[selected]")) collapseGroup(group);
      else expandIfCollapsed(group);
    }
    if (original.some((entry) => entry.ref.closest("tab-group") !== (restoredGroups.get(entry.group) || null))) {
      throw new Error("Zen did not restore every tab to its original group.");
    }
    for (const group of created) if (group.isConnected && !group.querySelector("tab")) group.remove();
    window.gZenWorkspaces.updateTabsContainers?.();
    if (rulesBefore !== undefined && rulesBefore !== rulesAfter) Services.prefs.setStringPref(CONFIG.RULES_PREF, rulesBefore);
    receipts.delete(window); document.querySelector(".zao-sort-progress")?.remove(); showToast("Sort undone."); return true;
  } catch (error) { console.warn(`${LOG} undo failed: ${error.message}`); showToast("Undo could not finish. The remaining tabs were kept."); }
};
