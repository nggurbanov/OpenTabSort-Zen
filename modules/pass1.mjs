// OpenTabSort Zen — Pass 1: deterministic domain → group matching.
// Pure logic over rules + tab info; applyPass1 mutates the DOM via gBrowser APIs.

import { LOG } from "./config.mjs";
import { findExistingGroup, expandIfCollapsed, collapseGroup, applyGroupAppearance, findSafeInsertAnchor } from "./groups.mjs";
import { getMatchMode } from "./rules.mjs";
import { normalizeCase } from "./dedupe.mjs";
import { capturePlacement, restorePlacement } from "./apply-placement.mjs";

// Match a hostname against a single rule-domain pattern.
//   "host.com"    matches the bare host AND any subdomain
//   "*.host.com"  matches subdomains only (NOT the bare host)
export const matchesDomain = (hostname, pattern) => {
  if (!hostname || !pattern) return false;
  if (pattern.startsWith("*.")) {
    const base = pattern.slice(2);
    return hostname.endsWith("." + base);
  }
  return hostname === pattern || hostname.endsWith("." + pattern);
};

export const matchesTitle = (title, term) => {
  if (!title || !term) return false;
  return normalizeCase(title).includes(normalizeCase(term));
};

const ruleMatchesDomain = (tabInfo, rule) =>
  (rule.domains || []).some((d) => matchesDomain(tabInfo.hostname, d));

const ruleMatchesTitle = (tabInfo, rule) =>
  (rule.titleTerms || []).some((t) => matchesTitle(tabInfo.title, t));

const findByDomain = (tabInfo, rules) => {
  for (const rule of rules) {
    if (ruleMatchesDomain(tabInfo, rule)) return rule.name;
  }
  return null;
};

const findByTitle = (tabInfo, rules) => {
  for (const rule of rules) {
    if (ruleMatchesTitle(tabInfo, rule)) return rule.name;
  }
  return null;
};

// First-match-wins within the active match source. Global mode decides whether
// URL or title terms are considered, and which source gets first crack.
export const findGroupForTab = (tabInfo, rules) => {
  const mode = getMatchMode();
  if (mode === "url-only") return findByDomain(tabInfo, rules);
  if (mode === "title-only") return findByTitle(tabInfo, rules);
  if (mode === "title-then-url") {
    return findByTitle(tabInfo, rules) || findByDomain(tabInfo, rules);
  }
  return findByDomain(tabInfo, rules) || findByTitle(tabInfo, rules);
};

/**
 * Plan what to do with each eligible tab based on the current rules. PURE — no DOM
 * mutation. `applyPass1` consumes the byGroup bucket to actually move tabs.
 *
 * @param {Array} tabs   — output of `getEligibleTabs().tabs`
 * @param {Array} rules  — output of `loadRules()`
 * @returns {{
 *   assignments,    // tabs with .group set (target rule name) or null
 *   byGroup,        // Map<groupName, items[]> — tabs to MOVE into the named group
 *   unmatched,      // items[] — no rule matches; left wherever they are
 *   alreadyCorrect, // items[] — matched and already in the right group; no-op
 * }}
 */
export const runPass1 = (tabs, rules) => {
  const assignments = tabs.map((t) => ({ ...t, group: findGroupForTab(t, rules) }));
  const byGroup = new Map();
  const unmatched = [];
  const alreadyCorrect = [];
  for (const a of assignments) {
    if (!a.group) {
      unmatched.push(a);
    } else if (a.group === a.currentGroup) {
      alreadyCorrect.push(a);
    } else {
      if (!byGroup.has(a.group)) byGroup.set(a.group, []);
      byGroup.get(a.group).push(a);
    }
  }
  return { assignments, byGroup, unmatched, alreadyCorrect };
};

/**
 * Execute the moves planned by `runPass1`. Creates new tab-groups when needed,
 * reuses existing ones, and applies per-rule colors after placement.
 *
 * @returns {{ movedToExisting, createdGroups, movedToNew, errors, failedTabs }} Successful counts and explicit placement/rollback failures.
 */
export const applyPass1 = (byGroup, workspaceId, rules) => {
  let movedToExisting = 0, createdGroups = 0, movedToNew = 0;
  const errors = [], failedTabs = [];
  const ruleByName = new Map(rules.map((rule) => [rule.name, rule]));
  for (const [groupName, items] of byGroup) {
    const liveMembers = items.filter((item) => item._tab?.isConnected &&
      item._tab.closest("tab-group")?.getAttribute("label") !== groupName);
    const tabsForGroup = liveMembers.map((item) => item._tab);
    if (!tabsForGroup.length) continue;
    const receipt = capturePlacement(tabsForGroup);
    const existing = findExistingGroup(groupName, workspaceId);
    let target = existing, created = false, wasCollapsed = false;
    try {
      if (existing?.isConnected) {
        wasCollapsed = expandIfCollapsed(existing);
        for (const tab of tabsForGroup) {
          if (tab.closest("tab-group") !== existing) gBrowser.moveTabToExistingGroup(tab, existing);
        }
      } else {
        // Use the native ungroup API before creating a sibling group. Capture
        // first: native creation may fail after detaching one or more tabs.
        for (const tab of tabsForGroup) if (tab.closest("tab-group")) gBrowser.ungroupTab(tab);
        target = gBrowser.addTabGroup(tabsForGroup, {
          label: groupName, insertBefore: findSafeInsertAnchor(),
        });
        created = true;
      }
      if (!target?.isConnected || tabsForGroup.some((tab) => tab.closest("tab-group") !== target)) {
        throw new Error("Zen did not place every tab into its rule group");
      }
      if (ruleByName.has(groupName)) applyGroupAppearance(target, ruleByName.get(groupName));
      if (created) { createdGroups++; movedToNew += tabsForGroup.length; }
      else movedToExisting += tabsForGroup.length;
    } catch (error) {
      const rollbackErrors = restorePlacement(receipt);
      try {
        if (created && target?.isConnected && !target.querySelector("tab")) target.remove();
      } catch (cleanupError) { rollbackErrors.push(cleanupError.message || String(cleanupError)); }
      errors.push({ group: groupName, error: error.message || String(error), rollbackErrors });
      failedTabs.push(...liveMembers);
      console.error(`${LOG} failed to place rule group "${groupName}":`, error);
    } finally {
      if (wasCollapsed && existing?.isConnected) collapseGroup(existing);
    }
  }
  return { movedToExisting, createdGroups, movedToNew, errors, failedTabs };
};
