// A sort owns the tabs captured at the click, while the browser stays usable.
// Reconcile by native identity immediately before apply; never replay user edits.
const structuralEvents = new Set(["TabMove", "TabGrouped", "TabUngrouped", "TabPinned", "TabUnpinned"]);
const normalize = (name) => String(name || "").normalize("NFKC").trim().toLowerCase();
const groupOf = (ref) => ref?.closest?.("tab-group") || null;
const labelOf = (group) => group?.getAttribute?.("label") ?? group?.label ?? "";

export const createSnapshotReconciler = (snapshot) => {
  const savedByRef = new Map(snapshot.map((saved) => [saved.ref, saved]));
  const originalGroups = new Set(snapshot.map((saved) => saved.group).filter(Boolean));
  const protectedRefs = new Set(), protectedGroups = new Set();
  return {
    onTabChange(event) {
      if (!structuralEvents.has(event?.type)) return;
      const target = event.target;
      if (savedByRef.has(target)) protectedRefs.add(target);
      else if (target?.localName === "tab-group" || originalGroups.has(target)) {
        protectedGroups.add(target);
        for (const saved of snapshot) {
          if (saved.group === target || target.contains?.(saved.ref)) protectedRefs.add(saved.ref);
        }
      }
    },
    onLocationChange(browser, progress, _request, location) {
      if (progress?.isTopLevel === false) return;
      for (const saved of snapshot) {
        if ((saved.ref?.linkedBrowser === browser || saved.ref?._linkedBrowser === browser) &&
            location?.spec && location.spec !== saved.url) protectedRefs.add(saved.ref);
      }
    },
    reconcile(plan, currentTabs, requestedTabs) {
      const current = new Map(currentTabs.map((tab) => [tab._tab, tab]));
      // Added/closed tabs change absolute positions innocently. Only compare
      // the projected order of surviving original refs; conservatively protect
      // every displaced ref if a move event was unavailable.
      const before = snapshot.filter((saved) => current.has(saved.ref) && !protectedRefs.has(saved.ref)).map((saved) => saved.ref);
      const after = currentTabs.filter((tab) => savedByRef.has(tab._tab) && !protectedRefs.has(tab._tab)).map((tab) => tab._tab);
      before.forEach((ref, index) => {
        if (ref !== after[index]) { protectedRefs.add(ref); protectedRefs.add(after[index]); }
      });
      const blockedNames = new Set();
      for (const tab of currentTabs) {
        const group = groupOf(tab._tab);
        const saved = savedByRef.get(tab._tab);
        if (group && (!originalGroups.has(group) || protectedGroups.has(group) ||
            (saved?.group === group && saved.label !== tab.currentGroup))) {
          blockedNames.add(normalize(labelOf(group)));
        }
      }
      const allowed = new Set();
      for (const saved of snapshot) {
        const tab = current.get(saved.ref);
        if (tab && saved.ref?.isConnected && !protectedRefs.has(saved.ref) && saved.url === tab.url &&
            saved.group === groupOf(saved.ref) && saved.label === tab.currentGroup) allowed.add(saved.ref);
      }
      const removed = [];
      const keep = (tab, groupName) => {
        const result = allowed.has(tab._tab) && !blockedNames.has(normalize(groupName));
        if (!result) removed.push(tab);
        return result;
      };
      const assignedToExisting = (plan.assignedToExisting || []).filter((entry) => keep(entry.tabInfo, entry.groupName));
      const newGroups = (plan.newGroups || []).map((group) => ({ ...group,
        tabs: group.tabs.filter((tab) => keep(tab, group.name)),
      })).filter((group) => group.tabs.length);
      const live = (tab) => tab?._tab?.isConnected;
      const unresolved = [...new Set([...(plan.unresolved || []), ...removed].filter(live))];
      const removedRefs = new Set(removed.map((tab) => tab._tab));
      const changedCount = requestedTabs.filter((tab) => !allowed.has(tab._tab) || removedRefs.has(tab._tab)).length;
      return { plan: { ...plan, assignedToExisting, newGroups,
        skipped: (plan.skipped || []).filter(live), unresolved }, changedCount };
    },
  };
};
