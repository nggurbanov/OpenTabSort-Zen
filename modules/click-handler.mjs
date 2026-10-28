// The main action has one job: let AI organize this workspace. No saved rules
// or manually maintained categories influence this path.
import { CONFIG, LOG, BUILD_VERSION } from "./config.mjs";
import { getAIEngine, readSkipDomainsPref } from "./rules.mjs";
import { getEligibleTabs } from "./tabs.mjs";
import { matchesDomain } from "./pass1.mjs";
import { applyPass2 } from "./apply-plan.mjs";
import { dissolveEmptyGroups } from "./groups.mjs";
import { captureTabSnapshot, validateAIPlan } from "./sort-plan.mjs";
import { beginSortSession, captureSortSettings, primarySortPrefNames } from "./sort-session.mjs";
import { captureLayout, recordSortUndo, undoLastSort, clearSortUndo, canUndoLastSort } from "./tab-history.mjs";
import { readProviderSettings } from "./provider-settings.mjs";
import { readJevSettings } from "./jev-categories.mjs";
import { getProviderReadiness } from "./provider-readiness.mjs";
import { showSortProgress } from "./operation-ui.mjs";
import { showToast } from "./ui-toast.mjs";
import { openAISetup } from "./setup-navigation.mjs";
import { sortFailureNotice } from "./sort-failure.mjs";
import { safeProviderErrorMessage } from "./safe-log.mjs";
import { createSnapshotReconciler } from "./sort-reconciliation.mjs";

console.log(`${LOG} workspace AI loaded — v${BUILD_VERSION}`);
const busyWindows = new WeakSet();
const exclusive = async (action) => {
  if (busyWindows.has(window)) { showToast("Sorting is already running. Use Stop to interrupt it."); return; }
  busyWindows.add(window);
  try { await action(); } finally { busyWindows.delete(window); }
};
export const handleLegacyOrganizeClick = () => exclusive(async () => {
  const legacy = await import("./legacy-sort.mjs");
  await legacy.handleLegacyOrganizeClick();
});
export const handleOrganizeClick = () => exclusive(organizeWorkspace);

const organizeWorkspace = async () => {
  const workspaceId = window.gZenWorkspaces?.activeWorkspace;
  if (!workspaceId) return;
  const engine = getAIEngine();
  // Setup is explicit. A click never silently selects a provider or sends data.
  const settings = ["openai", "gemini", "custom"].includes(engine) ? readProviderSettings(Services.prefs) : null;
  if (engine === "off" || (settings && !getProviderReadiness(settings).ok)) { openAISetup(); return; }
  if (engine === "jev") {
    const decision = readProviderSettings(Services.prefs, "jev");
    const jev = readJevSettings(Services.prefs);
    const categoryProvider = readProviderSettings(Services.prefs, jev.categoryProvider);
    if (!getProviderReadiness(decision).ok || !getProviderReadiness(categoryProvider).ok) { openAISetup(); return; }
  }
  const allTabs = getEligibleTabs().tabs;
  const excludedDomains = readSkipDomainsPref();
  const tabs = allTabs.filter((tab) => !excludedDomains.some((pattern) => matchesDomain(tab.hostname, pattern)));
  if (!tabs.length) { showToast("No eligible tabs to organize in this workspace. Pinned, essential and excluded tabs stay in place."); return; }
  const snapshot = captureTabSnapshot(allTabs);
  const review = Services.prefs.getBoolPref(CONFIG.AI_REVIEW_PREF, false);
  const reconciler = createSnapshotReconciler(snapshot);
  let original = [], rulesBefore = "";
  let session, applying = false, finished = false;
  const ui = showSortProgress({ stage: `Preparing ${tabs.length} tabs…`, onStop: () => session?.stop(), onUndo: undoLastSort, onDismiss: clearSortUndo, onSetup: openAISetup, onRetry: handleOrganizeClick });
  const finish = (message, undo = canUndoLastSort(), label) => { finished = true; ui.finish(message, undo, { label }); };
  const prefNames = primarySortPrefNames(engine, engine === "jev" ? readJevSettings(Services.prefs).categoryProvider : undefined);
  const settingsBefore = captureSortSettings(Services.prefs, prefNames);
  try {
    session = beginSortSession({ isCurrent: () => window.gZenWorkspaces?.activeWorkspace !== workspaceId ? "workspace" :
      captureSortSettings(Services.prefs, prefNames) !== settingsBefore ? "settings" : true,
      prefNames, preferenceReason: "settings", onProgress: ui.stage,
      onTabChange: reconciler.onTabChange, onLocationChange: reconciler.onLocationChange });
    let plan;
    if (engine === "local") {
      const { runPass2Fresh } = await import("./ai.mjs");
      session.checkpoint();
      ui.stage(`Finding topics in ${tabs.length} tabs on this device…`);
      plan = await runPass2Fresh(tabs, [], workspaceId, { workspaceAI: true });
    } else if (engine === "jev") {
      const { planDecisionWorkspace } = await import("./ai-decision-plan.mjs");
      session.checkpoint();
      plan = await planDecisionWorkspace(tabs, { signal: session.signal });
    } else {
      const { planAIWorkspace } = await import("./ai-workspace-plan.mjs");
      session.checkpoint();
      plan = await planAIWorkspace(tabs, { engine, settings, signal: session.signal });
    }
    session.checkpoint();
    validateAIPlan(plan, tabs);
    if (plan.failed && !plan.assignedToExisting.length && !plan.newGroups.length) {
      const failure = sortFailureNotice(plan.failed, engine);
      const detail = safeProviderErrorMessage(new Error(plan.failed), [settings?.apiKey]);
      console.warn(`${LOG} workspace planning failed [${failure.code}]: ${detail}`);
      ui.setupAvailable();
      finish(failure.message, canUndoLastSort(), failure.label); return;
    }
    if (review && (plan.assignedToExisting.length || plan.newGroups.length)) {
      const { showPreviewModal } = await import("./preview-modal.mjs");
      ui.stage("Review the proposed groups…");
      plan = await showPreviewModal({ plan, existingNames: [...new Set(tabs.map((tab) => tab.currentGroup).filter(Boolean))], signal: session.signal });
      if (!plan) { session.checkpoint(); finish("Review cancelled. Your tabs are unchanged."); return; }
    }
    session.checkpoint();
    validateAIPlan(plan, tabs);
    const currentTabs = getEligibleTabs().tabs;
    const reconciled = reconciler.reconcile(plan, currentTabs, tabs);
    plan = reconciled.plan;
    validateAIPlan(plan, currentTabs);
    const assignedCount = plan.assignedToExisting.length + plan.newGroups.reduce((count, group) => count + group.tabs.length, 0);
    if (!assignedCount) {
      if (reconciled.changedCount) ui.retryAvailable();
      finish(reconciled.changedCount ? "The original tabs changed while AI was working. Retry to tidy the current tabs." :
        "AI kept these tabs in place. Your layout is unchanged.", canUndoLastSort(),
        reconciled.changedCount ? "Tabs changed" : "Tabs kept in place");
      return;
    }
    // Capture Undo after concurrent browsing, immediately before native apply.
    // New tabs and manual edits made during AI are part of the current layout.
    original = captureLayout();
    rulesBefore = Services.prefs.getStringPref(CONFIG.RULES_PREF, "");
    session.dispose(); applying = true;
    ui.stage("Putting your tabs into groups…");
    const applied = applyPass2(plan, workspaceId, [], { existingBehavior: "transient", newGroupBehavior: "transient", persistRules: false, workspaceAI: true });
    dissolveEmptyGroups(workspaceId, new Set(original.map((entry) => entry.group).filter(Boolean)));
    window.gZenWorkspaces?.updateTabsContainers?.();
    const canUndo = recordSortUndo(original, { workspaceId, rulesBefore, rulesAfter: rulesBefore });
    const before = new Map(original.map((entry) => [entry.ref, entry]));
    const assignedRefs = new Set([...plan.assignedToExisting.map((entry) => entry.tabInfo._tab), ...plan.newGroups.flatMap((group) => group.tabs.map((tab) => tab._tab))]);
    const moved = captureLayout().filter((entry) => assignedRefs.has(entry.ref) &&
      (entry.group !== before.get(entry.ref)?.group || entry.position !== before.get(entry.ref)?.position)).length;
    const unchanged = (plan.skipped?.length || 0) + (plan.unresolved?.length || 0) + (applied.failedTabs?.length || 0);
    finish(applied.errors?.length ? `Some tabs could not be moved. ${moved} changed; failed tabs were restored where possible.` :
      moved ? `Tidied ${assignedCount} tabs${unchanged ? ` · ${unchanged} kept in place` : ""}` :
      unchanged ? `AI kept ${unchanged} tabs in place. Your layout is unchanged.` : "Your tabs are already organized.", canUndo,
      applied.errors?.length ? "Some tabs stayed" : moved ? `${assignedCount} tabs tidy` : unchanged ? "Tabs kept in place" : "Already tidy");
  } catch (error) {
    if (error.name === "AbortError" || session?.signal.aborted) {
      ui.retryAvailable();
      if (session?.reason === "settings") {
        const sharingOff = !["local", "ollama"].includes(engine) && !Services.prefs.getBoolPref(CONFIG.AI_PROVIDER_CONSENT_PREF, false);
        if (sharingOff) ui.setupAvailable();
        finish(sharingOff ? "AI sharing is off. Your layout is unchanged. Open Setup to allow sending tab metadata." :
          "AI setup changed. Your layout is unchanged. Retry with the current setup.", canUndoLastSort(), sharingOff ? "Sharing off" : "New setup");
      } else finish(session?.reason === "workspace" ? "You switched workspaces. Your layout is unchanged. Retry to tidy this workspace." :
        "Sorting stopped. Your layout is unchanged.", canUndoLastSort(), session?.reason === "workspace" ? "New space" : "Stopped");
    } else {
      const failure = sortFailureNotice(error, engine);
      const detail = safeProviderErrorMessage(error, [settings?.apiKey]);
      console.warn(`${LOG} workspace sorting failed [${failure.code}]: ${detail}`);
      const canUndo = applying ? recordSortUndo(original, { workspaceId, rulesBefore, rulesAfter: rulesBefore }) : canUndoLastSort();
      ui.setupAvailable();
      finish(failure.message, canUndo, failure.label);
    }
  } finally {
    session?.dispose();
    if (!finished) finish("Sorting cancelled. Your tabs are unchanged.");
  }
};
