// The main action has one job: let AI organize this workspace. No saved rules
// or manually maintained categories influence this path.
import { CONFIG, LOG, BUILD_VERSION } from "./config.mjs";
import { getAIEngine, readSkipDomainsPref } from "./rules.mjs";
import { getEligibleTabs } from "./tabs.mjs";
import { matchesDomain } from "./pass1.mjs";
import { applyPass2 } from "./apply-plan.mjs";
import { dissolveEmptyGroups } from "./groups.mjs";
import { captureTabSnapshot, isTabSnapshotCurrent, validateAIPlan } from "./sort-plan.mjs";
import { beginSortSession, captureSortSettings } from "./sort-session.mjs";
import { captureLayout, recordSortUndo, undoLastSort, clearSortUndo, canUndoLastSort } from "./tab-history.mjs";
import { readProviderSettings } from "./provider-settings.mjs";
import { readJevSettings } from "./jev-categories.mjs";
import { getProviderReadiness } from "./provider-readiness.mjs";
import { showSortProgress } from "./operation-ui.mjs";
import { showToast } from "./ui-toast.mjs";
import { openAISetup } from "./setup-navigation.mjs";

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
  const original = captureLayout();
  const rulesBefore = Services.prefs.getStringPref(CONFIG.RULES_PREF, "");
  if (engine === "jev") {
    const { runJevSort } = await import("./jev-sort.mjs");
    if (window.gZenWorkspaces?.activeWorkspace !== workspaceId || !isTabSnapshotCurrent(snapshot, getEligibleTabs().tabs)) { showToast("Tabs changed before sorting started. Run it again."); return; }
    await runJevSort({ tabs, workspaceId, snapshot, sourceOverride: "suggest", previewOverride: review, persistCategories: false });
    return;
  }
  let session, applying = false, finished = false;
  const ui = showSortProgress({ stage: `Preparing ${tabs.length} tabs…`, onStop: () => session?.stop(), onUndo: undoLastSort, onDismiss: clearSortUndo, onSetup: openAISetup });
  const finish = (message, undo = canUndoLastSort()) => { finished = true; ui.finish(message, undo); };
  const settingsBefore = captureSortSettings(Services.prefs);
  try {
    session = beginSortSession({ isCurrent: () => window.gZenWorkspaces?.activeWorkspace === workspaceId &&
      isTabSnapshotCurrent(snapshot, getEligibleTabs().tabs) && captureSortSettings(Services.prefs) === settingsBefore,
      onProgress: ui.stage });
    let plan;
    if (engine === "local") {
      const { runPass2Fresh } = await import("./ai.mjs");
      session.checkpoint();
      ui.stage(`Finding topics in ${tabs.length} tabs on this device…`);
      plan = await runPass2Fresh(tabs, [], workspaceId, { workspaceAI: true });
    } else {
      const { planAIWorkspace } = await import("./ai-workspace-plan.mjs");
      session.checkpoint();
      plan = await planAIWorkspace(tabs, { engine, settings, signal: session.signal });
    }
    session.checkpoint();
    validateAIPlan(plan, tabs);
    if (plan.failed && !plan.assignedToExisting.length && !plan.newGroups.length) {
      ui.setupAvailable();
      finish("AI could not organize these tabs. Your layout is unchanged. Check the connection in AI setup and try again."); return;
    }
    if (review && (plan.assignedToExisting.length || plan.newGroups.length)) {
      const { showPreviewModal } = await import("./preview-modal.mjs");
      ui.stage("Review the proposed groups…");
      plan = await showPreviewModal({ plan, existingNames: [...new Set(tabs.map((tab) => tab.currentGroup).filter(Boolean))], signal: session.signal });
      if (!plan) { session.checkpoint(); finish("Review cancelled. Your tabs are unchanged."); return; }
    }
    session.checkpoint();
    validateAIPlan(plan, tabs);
    // The native apply is synchronous. Remove planning observers before our own
    // moves, then keep one receipt for the entire operation.
    session.dispose(); applying = true;
    ui.stage("Putting your tabs into groups…");
    const applied = applyPass2(plan, workspaceId, [], { existingBehavior: "transient", newGroupBehavior: "transient", persistRules: false, workspaceAI: true });
    dissolveEmptyGroups(workspaceId, new Set(original.map((entry) => entry.group).filter(Boolean)));
    window.gZenWorkspaces?.updateTabsContainers?.();
    const canUndo = recordSortUndo(original, { workspaceId, rulesBefore, rulesAfter: rulesBefore });
    const before = new Map(original.map((entry) => [entry.ref, entry]));
    const moved = captureLayout().filter((entry) => entry.group !== before.get(entry.ref)?.group || entry.position !== before.get(entry.ref)?.position).length;
    const unchanged = (plan.skipped?.length || 0) + (plan.unresolved?.length || 0) + (applied.failedTabs?.length || 0);
    finish(applied.errors?.length ? `Some tabs could not be moved. ${moved} changed; failed tabs were restored where possible.` :
      moved ? `Organized ${tabs.length} tabs · ${moved} moved${unchanged ? ` · ${unchanged} kept in place` : ""}` :
      unchanged ? `AI kept ${unchanged} tabs in place. Your layout is unchanged.` : "Your tabs are already organized.", canUndo);
  } catch (error) {
    if (error.name === "AbortError" || session?.signal.aborted) {
      finish(session?.reason === "stale" ? "Tabs or settings changed. Your layout is unchanged. Run it again." : "Sorting stopped. Your layout is unchanged.");
    } else {
      console.error(`${LOG} workspace sorting failed:`, error);
      const canUndo = applying ? recordSortUndo(original, { workspaceId, rulesBefore, rulesAfter: rulesBefore }) : canUndoLastSort();
      ui.setupAvailable();
      finish("AI sorting could not finish. Check AI setup and try again.", canUndo);
    }
  } finally {
    session?.dispose();
    if (!finished) finish("Sorting cancelled. Your tabs are unchanged.");
  }
};
