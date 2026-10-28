// Apply a reviewed plan through native Zen tab APIs. Kept separate from the
// local embedding implementation so rule/remote paths do not load ML code.
import { LOG, PRESET_COLORS } from "./config.mjs";
import { getAIExistingBehavior, getAINewGroupBehavior, persistAIRules } from "./rules.mjs";
import { findExistingGroup, expandIfCollapsed, collapseGroup, applyGroupAppearance, applyGroupColor, findSafeInsertAnchor } from "./groups.mjs";
import { normalizeCase, ensureUniqueGroupNames } from "./dedupe.mjs";
import { capturePlacement, restorePlacement } from "./apply-placement.mjs";
import { uniqueGroupLabels } from "./group-emoji.mjs";
import { captureTidyMotion } from "./tidy-motion.mjs";

const existingGroupNames = (workspaceId) => Array.from(document.querySelectorAll?.(
  workspaceId ? `tab-group:has(tab[zen-workspace-id="${workspaceId}"])` : "tab-group"
) || []).filter((group) => group.isConnected).map((group) => group.getAttribute("label")).filter(Boolean);

// ─── Apply the AI decisions ───────────────────────────────────────────────────


const addDomainToRule = (ruleName, hostname, rules) => {
  const rule = rules.find((r) => r.name === ruleName);
  if (!rule) return false;
  if (!hostname || rule.domains.includes(hostname)) return false;
  rule.domains.push(hostname);
  return true;
};

const cleanTitleTerm = (term) => String(term || "").trim();

const titleTermsFromPatch = (patch) =>
  (patch?.titleTerms || [])
    .map((item) => cleanTitleTerm(item?.term))
    .filter(Boolean);

const addTitleTermsToRule = (ruleName, terms, rules) => {
  const rule = rules.find((r) => r.name === ruleName);
  if (!rule || !terms?.length) return 0;
  if (!Array.isArray(rule.titleTerms)) rule.titleTerms = [];
  const seen = new Set(rule.titleTerms.map(normalizeCase));
  let added = 0;
  for (const term of terms) {
    const key = normalizeCase(term);
    if (seen.has(key)) continue;
    seen.add(key);
    rule.titleTerms.push(term);
    added++;
  }
  return added;
};

// Pick a Zen palette color that isn't yet in `usedSet`. Falls back to a random
// preset if all are taken. Mutates `usedSet` to reserve the chosen color so
// subsequent calls within one apply pass don't double-up.
const pickAvailableColor = (usedSet) => {
  const available = PRESET_COLORS.filter((c) => !usedSet.has(c.name));
  const pool = available.length > 0 ? available : PRESET_COLORS;
  const pick = pool[Math.floor(Math.random() * pool.length)].name;
  usedSet.add(pick);
  return pick;
};

const openZenEditModalForGroup = (groupEl) => {
  // Falls back silently if no API is available — the group is still created, the
  // user just doesn't get the rename prompt.
  try {
    const tgm = window.gBrowser?.tabGroupMenu;
    if (tgm) {
      if (typeof tgm.openEditModal === "function") { tgm.openEditModal(groupEl); return true; }
      if (typeof tgm.openCreate === "function")    { tgm.openCreate(groupEl); return true; }
    }
    // Generic last-resort: click the group's label to invoke the inline rename, if any.
    const label = groupEl.querySelector(".tab-group-label");
    if (label) { label.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); return true; }
  } catch (e) {
    console.warn(`${LOG} could not open Zen edit modal:`, e);
  }
  return false;
};

const workspaceNameKey = (name) => String(name || "").trim().normalize("NFKC").toLowerCase();
const isWorkspaceGroup = (group, workspaceId) => {
  if (!group.isConnected) return false;
  const owner = group.getAttribute("zen-workspace-id");
  return owner === workspaceId || (!owner && Boolean(group.querySelector(`tab[zen-workspace-id="${workspaceId}"]`)));
};
const findWorkspaceTarget = (name, workspaceId) => Array.from(document.querySelectorAll?.("tab-group") || [])
  .find((group) => isWorkspaceGroup(group, workspaceId) && workspaceNameKey(group.getAttribute("label")) === workspaceNameKey(name));
const workspaceCategoryColor = (name) => {
  const hash = Array.from(workspaceNameKey(name)).reduce((value, char) => (Math.imul(value, 31) + char.codePointAt(0)) >>> 0, 0);
  return PRESET_COLORS[hash % PRESET_COLORS.length].name;
};

const applyPass2Native = (pass2Result, workspaceId, rules, options = {}) => {
  const workspaceAI = options.workspaceAI === true;
  const existingBehavior = workspaceAI ? "transient" : options.existingBehavior || getAIExistingBehavior();
  const newGroupBehavior = workspaceAI ? "transient" : options.newGroupBehavior || getAINewGroupBehavior();
  const persistRules = !workspaceAI && options.persistRules !== false;
  if (workspaceAI) rules = [];

  let movedToExisting = 0;
  let rulesGrown = 0;
  let titleTermsGrown = 0;
  let newGroupsCreated = 0;
  let newRulesCreated = 0;
  const rulePatches = Array.isArray(pass2Result.rulePatches) ? pass2Result.rulePatches : [];
  const errors = [];
  const failedTabs = [];
  const targets = new Map();
  const failPlacement = (name, members, receipt, error, createdGroup = null) => {
    const rollbackErrors = restorePlacement(receipt);
    try {
      if (createdGroup?.isConnected && !createdGroup.querySelector("tab")) createdGroup.remove();
    } catch (cleanupError) { rollbackErrors.push(cleanupError.message || String(cleanupError)); }
    errors.push({ group: name, error: error.message || String(error), rollbackErrors });
    failedTabs.push(...members);
    console.error(`${LOG} AI: placement failed for "${name}":`, error);
  };

  if (workspaceAI) {
    // A workspace taxonomy names destinations, not new rule proposals. Reuse
    // existing names directly so repeated clicks cannot produce suffix churn.
    const liveTabs = new Set(gBrowser.tabs || []);
    const claimed = new Set(), canonicalNames = new Map();
    for (const group of document.querySelectorAll?.("tab-group") || []) {
      if (!isWorkspaceGroup(group, workspaceId)) continue;
      const name = group.getAttribute("label"), key = workspaceNameKey(name);
      if (key && !canonicalNames.has(key)) { canonicalNames.set(key, name); targets.set(name, group); }
    }
    const assignments = [];
    const add = (tabInfo, proposedName) => {
      const key = workspaceNameKey(proposedName), tab = tabInfo?._tab;
      const valid = key && tab?.isConnected && liveTabs.has(tab) && !claimed.has(tab) &&
        tab.getAttribute?.("zen-workspace-id") === workspaceId && !tab.pinned &&
        !["zen-empty-tab", "zen-glance-tab", "zen-essential"].some((attribute) => tab.hasAttribute?.(attribute));
      if (!valid || window.gZenWorkspaces?.activeWorkspace !== workspaceId) {
        errors.push({ group: String(proposedName || ""), error: "Invalid, duplicate or foreign workspace tab assignment", rollbackErrors: [] });
        if (tabInfo) failedTabs.push(tabInfo);
        return;
      }
      claimed.add(tab);
      if (!canonicalNames.has(key)) canonicalNames.set(key, String(proposedName).trim());
      assignments.push({ tabInfo, groupName: canonicalNames.get(key) });
    };
    for (const assignment of pass2Result.assignedToExisting || []) add(assignment.tabInfo, assignment.groupName);
    for (const group of pass2Result.newGroups || []) for (const tabInfo of group.tabs || []) add(tabInfo, group.name);
    if (errors.length) return { movedToExisting, rulesGrown, titleTermsGrown, newGroupsCreated, newRulesCreated, errors, failedTabs };
    pass2Result = { ...pass2Result, assignedToExisting: assignments, newGroups: [] };
  }

  // Seed the in-use color set from existing rules so new AI groups don't
  // duplicate them. Updated as each new group is created within this batch.
  const usedColors = new Set(
    rules.map((r) => r.color).filter((c) => typeof c === "string" && c.length > 0)
  );

  // 1. A rule is a valid destination even when no tab currently occupies it.
  for (const a of pass2Result.assignedToExisting) {
    let groupEl = targets.get(a.groupName);
    if (!groupEl?.isConnected) groupEl = workspaceAI ? findWorkspaceTarget(a.groupName, workspaceId) : findExistingGroup(a.groupName, workspaceId);
    const tab = a.tabInfo._tab;
    if (!tab?.isConnected) { errors.push({ group: a.groupName, error: "Tab disconnected before placement", rollbackErrors: [] }); failedTabs.push(a.tabInfo); continue; }
    const receipt = capturePlacement([tab]);
    let createdGroup = null, wasCollapsed = false;
    try {
      if (!groupEl?.isConnected) {
        const rule = workspaceAI
          ? { name: a.groupName, domains: [], color: workspaceCategoryColor(a.groupName) }
          : rules.find((rule) => rule.name === a.groupName);
        if (!rule) throw new Error("Target rule no longer exists");
        if (tab.closest("tab-group")) gBrowser.ungroupTab(tab);
        groupEl = gBrowser.addTabGroup([tab], {
          label: rule.name, color: rule.color, insertBefore: findSafeInsertAnchor(),
        });
        createdGroup = groupEl;
        if (!groupEl?.isConnected) throw new Error("Zen could not create the rule group");
        groupEl.setAttribute("zen-workspace-id", workspaceId);
        applyGroupAppearance(groupEl, rule);
      } else {
        wasCollapsed = expandIfCollapsed(groupEl);
        if (tab.closest("tab-group") !== groupEl) gBrowser.moveTabToExistingGroup(tab, groupEl);
      }
      if (tab.closest("tab-group") !== groupEl) throw new Error("Zen did not move the tab into its target group");
      targets.set(a.groupName, groupEl);
      if (receipt.entries[0].group !== groupEl) movedToExisting++;
      if (createdGroup) newGroupsCreated++;
      if (persistRules && existingBehavior === "always-add") {
        if (addDomainToRule(a.groupName, a.tabInfo.hostname, rules)) rulesGrown++;
      }
    } catch (error) {
      targets.delete(a.groupName);
      failPlacement(a.groupName, [a.tabInfo], receipt, error, createdGroup);
    } finally {
      if (wasCollapsed && groupEl?.isConnected) collapseGroup(groupEl);
    }
  }

  // 2. Create new groups from each cluster.
  const uniqueNewGroups = ensureUniqueGroupNames(pass2Result.newGroups,
    [...rules.map((rule) => rule.name), ...existingGroupNames(workspaceId)]);
  for (const cluster of uniqueNewGroups) {
    const liveMembers = cluster.tabs.filter((tabInfo) => tabInfo._tab?.isConnected);
    const tabs = liveMembers.map((tabInfo) => tabInfo._tab);
    if (tabs.length === 0) continue;

    const color = pickAvailableColor(usedColors);

    const receipt = capturePlacement(tabs);
    let newGroup = null;
    try {
      if (typeof gBrowser.ungroupTab === "function") {
        for (const tab of tabs) {
          if (tab.closest("tab-group")) gBrowser.ungroupTab(tab);
        }
      }
      newGroup = gBrowser.addTabGroup(tabs, {
        label: cluster.name,
        // Must anchor OUTSIDE any enclosing tab-group, or Zen nests the new group
        // inside the old one — common in fresh-categories mode where tabs[0] is
        // usually already grouped under a rule.
        insertBefore: findSafeInsertAnchor(),
        color,
      });
      if (!newGroup?.isConnected) throw new Error("Zen could not create the category group");
      if (tabs.some((tab) => tab.closest("tab-group") !== newGroup)) throw new Error("Zen did not move every tab into the category group");
      newGroupsCreated++;

      // Defensive: Zen's addTabGroup may ignore the color option on older APIs.
      applyGroupColor(newGroup, color);

      if (persistRules && newGroupBehavior === "auto-add") {
        // Include the chosen color so syncAllGroupColors keeps it on future tidy-clicks.
        const hostnames = [...new Set(liveMembers.map((t) => t.hostname).filter((h) => h))];
        if (hostnames.length > 0 && !rules.some((r) => r.name === cluster.name)) {
          rules.push({
            name: cluster.name,
            domains: hostnames,
            color,
          });
          newRulesCreated++;
        }
      } else if (newGroupBehavior === "prompt") {
        openZenEditModalForGroup(newGroup);
        // Persisting the renamed group as a rule requires the tab's "Add to Rule…" submenu.
      }
      // "transient" — group exists in sidebar (with color) but rules aren't touched.
    } catch (error) {
      failPlacement(cluster.name, liveMembers, receipt, error, newGroup);
    }
  }

  // 3. Apply reviewed title-learning patches independently from tab/domain
  // grouping. These can grow existing rules or create title-only rules.
  for (const patch of persistRules ? rulePatches : []) {
    const name = String(patch.groupName || "").trim();
    const titleTerms = titleTermsFromPatch(patch);
    if (!name || titleTerms.length === 0) continue;
    let rule = rules.find((r) => normalizeCase(r.name) === normalizeCase(name));
    if (!rule) {
      const color = pickAvailableColor(usedColors);
      rule = { name, domains: [], titleTerms: [], color };
      rules.push(rule);
      newRulesCreated++;
    }
    titleTermsGrown += addTitleTermsToRule(rule.name, titleTerms, rules);
  }

  if (persistRules && (rulesGrown > 0 || titleTermsGrown > 0 || newRulesCreated > 0)) persistAIRules(rules);

  return { movedToExisting, rulesGrown, titleTermsGrown, newGroupsCreated, newRulesCreated, errors, failedTabs };
};

// Sorting remains synchronous. Only the visible final layout is animated;
// callers can show completion or offer Undo without waiting for the effect.
export const applyPass2 = (pass2Result, workspaceId, rules, options = {}) => {
  const motion = captureTidyMotion(workspaceId);
  try {
    const result = applyPass2Native(pass2Result, workspaceId, rules, options);
    if (options.workspaceAI && typeof options.emojiGroupNames === "boolean") {
      const failed = new Set(result.failedTabs.map((tab) => tab._tab));
      const refs = [...pass2Result.assignedToExisting.map((entry) => entry.tabInfo), ...pass2Result.newGroups.flatMap((group) => group.tabs)];
      const targets = [...new Set(refs.filter((tab) => !failed.has(tab._tab)).map((tab) => tab._tab.closest("tab-group")).filter(Boolean))];
      const reserved = Array.from(document.querySelectorAll("tab-group")).filter((group) => isWorkspaceGroup(group, workspaceId) && !targets.includes(group));
      const labels = uniqueGroupLabels(targets.map((group) => options.groupDisplayNames?.get(group.getAttribute("label")) || group.getAttribute("label")), reserved.map((group) => group.getAttribute("label")), options.emojiGroupNames);
      targets.forEach((group, index) => group.setAttribute("label", labels[index]));
    }
    motion.play();
    return result;
  } catch (error) {
    motion.cancel();
    throw error;
  }
};
