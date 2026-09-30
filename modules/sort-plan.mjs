// Pure boundaries used before any workspace mutation.
import { ensureUniqueGroupNames } from "./dedupe.mjs";
export const captureTabSnapshot = (tabs) => tabs.map((tab) => ({
  ref: tab._tab, url: tab.url, title: tab.title,
  group: tab._tab?.closest("tab-group") || null, label: tab.currentGroup,
}));
export const isTabSnapshotCurrent = (snapshot, tabs) => snapshot.length === tabs.length && snapshot.every((saved, index) => {
  const tab = tabs[index];
  return saved.ref === tab._tab && tab._tab?.isConnected && saved.url === tab.url && saved.title === tab.title &&
    saved.group === (tab._tab.closest("tab-group") || null) && saved.label === tab.currentGroup;
});
export const validateAIPlan = (plan, tabs) => {
  const eligible = new Set(tabs.map((tab) => tab._tab));
  const assigned = new Set();
  const claim = (tab) => {
    if (!tab?._tab || !eligible.has(tab._tab) || assigned.has(tab._tab)) throw new Error("Invalid or duplicate AI tab assignment");
    assigned.add(tab._tab);
  };
  for (const entry of plan.assignedToExisting || []) {
    if (typeof entry.groupName !== "string" || !entry.groupName.trim()) throw new Error("Invalid AI group name");
    claim(entry.tabInfo);
  }
  for (const group of plan.newGroups || []) {
    if (typeof group.name !== "string" || !group.name.trim() || !Array.isArray(group.tabs) || !group.tabs.length) throw new Error("Invalid AI group");
    group.tabs.forEach(claim);
  }
};
export const reserveNewGroupNames = (plan, existingNames) => {
  plan.newGroups = ensureUniqueGroupNames(plan.newGroups || [], existingNames);
};
