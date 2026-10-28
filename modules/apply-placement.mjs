// Native tab moves can fail after detaching a tab. Keep a receipt per placement
// so failure restores its source groups without replacing or reopening tabs.
import { collapseGroup, expandIfCollapsed, findSafeInsertAnchor } from "./groups.mjs";

export const capturePlacement = (tabs) => {
  let fallbackPositions;
  const groups = new Map();
  const entries = tabs.map((tab) => {
    const group = tab.closest("tab-group") || null;
    if (group && !groups.has(group)) groups.set(group, {
      label: group.getAttribute("label"), color: group.color,
      workspaceId: group.getAttribute("zen-workspace-id"),
      style: group.getAttribute("style"), className: group.className,
      collapsed: group.hasAttribute("collapsed"),
    });
    // Firefox maintains _tPos. Avoid enumerating the full window for every
    // individual assignment; the fallback is only for alternate/native shims.
    if (!Number.isInteger(tab._tPos)) fallbackPositions ||= new Map(Array.from(gBrowser.tabs || []).map((item, index) => [item, index]));
    return { tab, group, position: Number.isInteger(tab._tPos) ? tab._tPos : fallbackPositions.get(tab) };
  });
  return { entries, groups };
};

export const restorePlacement = ({ entries, groups }) => {
  const errors = [];
  const restored = new Map();
  for (const [original, appearance] of groups) {
    const members = entries.filter((entry) => entry.group === original && entry.tab.isConnected);
    // An empty native group may already be queued for removal. Recreate it
    // rather than refilling a node whose pending removal would take its tabs.
    if (!members.length) continue;
    let group = original.isConnected && original.querySelector("tab") ? original : null;
    try {
      if (!group) {
        for (const { tab } of members) if (tab.closest("tab-group")) gBrowser.ungroupTab(tab);
        group = gBrowser.addTabGroup(members.map((entry) => entry.tab), {
          label: appearance.label, color: appearance.color, insertBefore: findSafeInsertAnchor(),
        });
        if (!group?.isConnected) throw new Error("Source group could not be restored");
        if (appearance.workspaceId !== null) group.setAttribute("zen-workspace-id", appearance.workspaceId);
        if (appearance.style !== null) group.setAttribute("style", appearance.style);
        if (appearance.className !== undefined) group.className = appearance.className;
      } else {
        expandIfCollapsed(group);
        for (const { tab } of members) if (tab.closest("tab-group") !== group) gBrowser.moveTabToExistingGroup(tab, group);
      }
      if (members.some(({ tab }) => tab.closest("tab-group") !== group)) throw new Error("Source group membership was not restored");
      restored.set(original, group);
      if (appearance.collapsed) collapseGroup(group);
    } catch (error) { errors.push(error.message || String(error)); }
  }
  for (const { tab, group } of entries) {
    if (!tab.isConnected) { errors.push("A tab disconnected during placement"); continue; }
    if (!group && tab.closest("tab-group")) {
      try {
        gBrowser.ungroupTab(tab);
        if (tab.closest("tab-group")) throw new Error("Ungrouped source membership was not restored");
      } catch (error) { errors.push(error.message || String(error)); }
    }
  }
  // Positions are captured immediately before this placement, so restoring one
  // failed cluster preserves earlier successful clusters and unrelated tabs.
  const positionedGroups = new Set();
  for (const entry of entries) {
    if (!entry.tab.isConnected || !Number.isInteger(entry.position) || typeof gBrowser.moveTabTo !== "function") continue;
    const group = restored.get(entry.group);
    try {
      if (group && !positionedGroups.has(group)) {
        gBrowser.moveTabTo(group, { tabIndex: entry.position });
        positionedGroups.add(group);
      }
      gBrowser.moveTabTo(entry.tab, { tabIndex: entry.position, ...(!entry.group ? { forceUngrouped: true } : {}) });
    } catch (error) { errors.push(error.message || String(error)); }
  }
  return errors;
};
