// Plan first; only an accepted, still-current plan may change the workspace.
import { CONFIG, LOG, BUILD_VERSION } from "./config.mjs";
import { loadRules, readSkipDomainsPref, isStrictRulesEnforced, getAIEngine, getAISortMode,
  getOllamaHost, getOllamaModel, getAINewGroupBehavior, getAIExistingBehavior, getAITitleLearning } from "./rules.mjs";
import { getEligibleTabs } from "./tabs.mjs";
import { consolidateDuplicateGroups, dissolveEmptyGroups, moveTabsToTop, moveUngroupedToTop, syncAllGroupColors } from "./groups.mjs";
import { runPass1, applyPass1, matchesDomain } from "./pass1.mjs";
import { runPass2, runPass2Fresh, applyPass2 } from "./ai.mjs";
import { checkOllamaReady, reportOllamaError, runPass2Ollama, runPass2OllamaFresh, classifyExistingGroupsBatch, proposeTitleTermPatches } from "./ollama.mjs";
import { runPass2Remote, runPass2RemoteFresh, classifyExistingGroupsRemoteBatch } from "./remote-provider.mjs";
import { readProviderSettings } from "./provider-settings.mjs";
import { getProviderReadiness } from "./provider-readiness.mjs";
import { resolveEffectiveSortingMode, isFullAIMode, resolvePass2ApplyOptions } from "./sorting-mode.mjs";
import { showPreviewModal } from "./preview-modal.mjs";
import { showToast } from "./ui-toast.mjs";
import { captureTabSnapshot, isTabSnapshotCurrent, validateAIPlan, reserveNewGroupNames } from "./sort-plan.mjs";
import { runJevSort, invalidateJevUndo } from "./jev-sort.mjs";

console.log(`${LOG} click-handler.mjs loaded — v${BUILD_VERSION}`);
let organizing = false;
const emptyPlan = () => ({ assignedToExisting: [], newGroups: [], skipped: [], unresolved: [] });
const assignmentsFromMap = (tabs, map) => ({
  assignments: tabs.flatMap((tabInfo, index) => map.get(index) ? [{ tabInfo, groupName: map.get(index) }] : []),
  skipped: tabs.filter((_, index) => !map.get(index) && !map.unresolved?.has(index)),
  unresolved: tabs.filter((_, index) => map.unresolved?.has(index)),
  ...(map.failed ? { failed: map.failed } : {}),
});

export const handleOrganizeClick = async () => {
  if (organizing) { showToast("Sorting is already running."); return; }
  const workspaceId = window.gZenWorkspaces?.activeWorkspace;
  if (!workspaceId) return;
  organizing = true;
  const tidyButton = window.gZenWorkspaces?.activeWorkspaceElement?.querySelector(`#${CONFIG.BUTTON_ID}`);
  try {
    tidyButton?.classList.remove("zao-wiggling");
    if (tidyButton) void tidyButton.offsetWidth;
    tidyButton?.classList.add("zao-wiggling");
    setTimeout(() => tidyButton?.classList.remove("zao-wiggling"), CONFIG.WIGGLE_DURATION_MS);
    const rules = (await loadRules()).filter((rule) => rule.name && (rule.domains?.length || rule.titleTerms?.length));
    const allTabs = getEligibleTabs().tabs;
    if (!allTabs.length) return;
    const snapshot = captureTabSnapshot(allTabs);
    const originalGroups = new Set(snapshot.map((tab) => tab.group).filter(Boolean));
    const rulesBefore = Services.prefs.getStringPref(CONFIG.RULES_PREF, "");
    const engine = getAIEngine();
    const mode = resolveEffectiveSortingMode({ aiEngine: engine, preferredMode: getAISortMode() });
    const fullAI = isFullAIMode(mode);
    const remote = ["openai", "gemini", "custom"].includes(engine);
    const settings = remote ? readProviderSettings(Services.prefs) : null;
    if (remote) {
      const readiness = getProviderReadiness(settings);
      if (!readiness.ok) {
        showToast(readiness.reason === "consent_required" ? "Allow sending tab data in settings before using this provider."
          : "Complete the selected provider's settings before sorting.");
        return;
      }
    }
    const skipPatterns = readSkipDomainsPref();
    const excluded = allTabs.filter((tab) => skipPatterns.some((pattern) => matchesDomain(tab.hostname, pattern)));
    const excludedRefs = new Set(excluded.map((tab) => tab._tab));
    const tabs = allTabs.filter((tab) => !excludedRefs.has(tab._tab));
    if (engine === "jev") {
      if (!tabs.length) return;
      tidyButton?.classList.add("zao-thinking");
      await runJevSort({ tabs, workspaceId, snapshot });
      return;
    }
    const pass1 = runPass1(tabs, rules);
    const newBehavior = engine === "off" ? "" : getAINewGroupBehavior();
    const freshLike = fullAI || ["fresh-categories", "identify-only"].includes(newBehavior);
    const existingBehavior = getAIExistingBehavior();
    const titleMode = getAITitleLearning();
    const titleLearning = engine === "ollama" && !freshLike && newBehavior !== "prompt" && titleMode !== "off" &&
      (existingBehavior === "always-add" || newBehavior === "auto-add");
    const byRule = new Map();
    if (titleLearning) {
      const ruleNames = new Set(rules.map((rule) => rule.name));
      for (const tab of pass1.assignments) {
        const target = tab.group || tab.currentGroup;
        if (!ruleNames.has(target)) continue;
        if (!byRule.has(target)) byRule.set(target, { name: target, tabs: [] });
        byRule.get(target).tabs.push(tab);
      }
    }
    const existingNames = [...rules.map((rule) => rule.name), ...allTabs.map((tab) => tab.currentGroup).filter(Boolean)];
    const input = freshLike ? tabs : pass1.unmatched;
    let plan = emptyPlan();
    const failedRefs = new Set();
    if (engine !== "off" && (input.length || byRule.size)) {
      tidyButton?.classList.add("zao-thinking");
      if (engine === "local" && input.length > CONFIG.AI_LOCAL_CONFIRM_THRESHOLD &&
          !window.confirm(`Local AI will sort ${input.length} tabs. This may take minutes.\n\nContinue?`)) return;
      if (engine === "ollama") {
        const status = await checkOllamaReady(getOllamaHost(), getOllamaModel());
        if (!status.reachable || !status.modelAvailable) { reportOllamaError(getOllamaHost(), getOllamaModel(), status); return; }
        if (input.length) plan = freshLike ? await runPass2OllamaFresh(input) : await runPass2Ollama(input, rules);
      } else if (remote) {
        if (input.length) plan = freshLike ? await runPass2RemoteFresh(input, settings) : await runPass2Remote(input, rules, settings);
      } else if (input.length) {
        plan = freshLike ? await runPass2Fresh(input, rules, workspaceId) : await runPass2(input, rules, workspaceId, { projectedAssignments: pass1.assignments });
      }
      if (!freshLike) {
        const kept = [];
        plan.newGroups = (plan.newGroups || []).map((group) => ({ ...group, tabs: group.tabs.filter((tab) => {
          if (!tab.currentGroup) return true;
          kept.push(tab); return false;
        }) })).filter((group) => group.tabs.length);
        plan.skipped = [...(plan.skipped || []), ...kept];
      }
      for (const tab of plan.unresolved || []) failedRefs.add(tab._tab);
      plan.titleAuditGroups = [...byRule.values()];
      reserveNewGroupNames(plan, existingNames);
      const hasMoves = plan.assignedToExisting.length || plan.newGroups.length;
      const preview = newBehavior === "identify-only" || (!fullAI && newBehavior !== "fresh-categories" && newBehavior !== "prompt" &&
        ((newBehavior === "auto-add" && plan.newGroups.length) ||
         ((remote || engine === "ollama") && existingBehavior === "always-add" && plan.assignedToExisting.length) || byRule.size));
      if (preview && titleLearning) plan.rulePatches = await proposeTitleTermPatches(plan, rules, getOllamaHost(), getOllamaModel(), titleMode);
      if (preview && (hasMoves || plan.rulePatches?.length)) {
        const classify = engine === "ollama"
          ? (pending, targetRules) => classifyExistingGroupsBatch(pending, targetRules, getOllamaHost(), getOllamaModel())
          : remote ? (pending, targetRules) => classifyExistingGroupsRemoteBatch(pending, targetRules, settings) : null;
        plan = await showPreviewModal({
          plan, existingNames,
          onReassignToNew: async (pending) => {
            const result = engine === "local" ? await runPass2Fresh(pending, rules, workspaceId)
              : remote ? await runPass2RemoteFresh(pending, settings) : await runPass2OllamaFresh(pending);
            return { newGroups: result.newGroups, skipped: result.skipped, unresolved: result.unresolved, ...(result.failed ? { failed: result.failed } : {}) };
          },
          onAssignToPlanned: classify ? async (pending, kept) => assignmentsFromMap(pending, await classify(pending,
            kept.map((group) => ({ name: group.name, domains: [...new Set(group.tabs.map((tab) => tab.hostname))] })))) : undefined,
          onAssignToExisting: classify && rules.length ? async (pending) => assignmentsFromMap(pending, await classify(pending, rules)) : undefined,
        });
        if (plan === null) return;
      }
    }
    // Awaiting AI/preview must never apply to a changed tab list or workspace.
    if (window.gZenWorkspaces?.activeWorkspace !== workspaceId || !isTabSnapshotCurrent(snapshot, getEligibleTabs().tabs) ||
        Services.prefs.getStringPref(CONFIG.RULES_PREF, "") !== rulesBefore) {
      showToast("Tabs or rules changed while sorting. Run it again to use the current workspace."); return;
    }
    validateAIPlan(plan, tabs);
    if (plan.failed && !plan.assignedToExisting.length && !plan.newGroups.length) return;
    invalidateJevUndo();
    consolidateDuplicateGroups(workspaceId);
    if (excluded.length) moveTabsToTop(excluded.map((tab) => tab._tab), workspaceId);
    if (!freshLike) applyPass1(pass1.byGroup, workspaceId, rules);
    const applyOptions = fullAI ? resolvePass2ApplyOptions(mode) : freshLike
      ? { existingBehavior: "transient", newGroupBehavior: "transient", persistRules: false } : {};
    applyPass2(plan, workspaceId, rules, applyOptions);
    if (!freshLike && isStrictRulesEnforced()) {
      const assigned = new Set([...plan.assignedToExisting.map((entry) => entry.tabInfo._tab),
        ...plan.newGroups.flatMap((group) => group.tabs.map((tab) => tab._tab)), ...(plan.unresolved || []).map((tab) => tab._tab), ...failedRefs]);
      moveTabsToTop(pass1.unmatched.filter((tab) => tab.currentGroup && !assigned.has(tab._tab)).map((tab) => tab._tab), workspaceId);
    }
    // Failed/skipped classifications retain their original group membership.
    dissolveEmptyGroups(workspaceId, originalGroups);
    moveUngroupedToTop(workspaceId);
    syncAllGroupColors(workspaceId, rules);
    window.gZenWorkspaces?.updateTabsContainers?.();
    void window.gBrowser?.tabs?.length;
  } catch (error) {
    console.error(`${LOG} sorting failed:`, error);
    showToast("Sorting could not finish. Check the selected engine and try again.");
  } finally {
    tidyButton?.classList.remove("zao-thinking"); organizing = false;
  }
};
