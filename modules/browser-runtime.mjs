// Browser-only lifecycle. Settings and classification engines are loaded on demand.

import { CONFIG, LOG, BUILD_VERSION } from "./config.mjs";
import { domCache, getEligibleTabs } from "./tabs.mjs";
import { readRulesPref, getAIEngine, getAISortMode, getOllamaHost, getOllamaModel, isOllamaWarmupEnabled } from "./rules.mjs";
import { syncAllGroupColors } from "./groups.mjs";

import {
  setupCommand,
  teardownCommand,
  teardownWorkspaceHooks,
  setupWorkspaceHooks,
  addButtonToAllSeparators,
} from "./browser-ui.mjs";
const handleOrganizeClick = async () => (await import("./click-handler.mjs")).handleOrganizeClick();
import {
  setupTabContextMenu,
  teardownTabContextMenu,
  setupTabGroupContextMenu,
  teardownTabGroupContextMenu,
  setupTabGroupCreateHook,
  teardownTabGroupCreateHook,
  teardownCollapsedStatePersistence,
  setupCollapsedStatePersistence,
  setupMinimalStylePrefObserver,
  teardownMinimalStylePrefObserver,
} from "./browser-hooks.mjs";

const tryInitializeBrowser = () => {
  try {
    const separatorExists = domCache.getSeparators().length > 0;
    const commandSetExists = !!domCache.getCommandSet();
    const gBrowserReady = typeof gBrowser !== "undefined" && gBrowser?.tabContainer;
    const gZenWorkspacesReady = typeof window.gZenWorkspaces !== "undefined";

    if (gBrowserReady && commandSetExists && separatorExists && gZenWorkspacesReady) {
      setupCommand();
      addButtonToAllSeparators();
      setupWorkspaceHooks();
      setupTabContextMenu();
      setupTabGroupContextMenu();
      setupTabGroupCreateHook();
      setupCollapsedStatePersistence();
      setupMinimalStylePrefObserver();
      window.OpenTabSortZen = Object.freeze({
        buildVersion: BUILD_VERSION,
        handleLegacyOrganizeClick: async () => (await import("./click-handler.mjs")).handleLegacyOrganizeClick(),
        handleOrganizeClick: async () => {
          window.OpenTabSortZenLastRun = {
            startedAt: Date.now(),
            finished: false,
            before: {
              eligibleTabs: getEligibleTabs().tabs.length,
              aiEngine: getAIEngine(),
              aiSortMode: getAISortMode(),
            },
          };
          try {
            await handleOrganizeClick();
            window.OpenTabSortZenLastRun.finished = true;
          } catch (e) {
            window.OpenTabSortZenLastRun.error = e?.stack || e?.message || String(e);
            throw e;
          }
          return window.OpenTabSortZenLastRun;
        },
      });

      // Apply colors to groups that were restored before our hook installed
      // (the TabGroupCreate event already fired by the time the listener registered).
      const workspaceId = window.gZenWorkspaces?.activeWorkspace;
      if (workspaceId) {
        const rules = readRulesPref();
        if (rules) syncAllGroupColors(workspaceId, rules);
      }

      // If the user has Ollama selected AND opted into warmup, preload the
      // model in the background so the first tidy click doesn't pay the
      // cold-start cost. Fire-and-forget — silent on failure (daemon may not
      // be running yet).
      if (getAIEngine() === "ollama" && isOllamaWarmupEnabled()) {
        void import("./ollama-transport.mjs").then(({ warmupOllama }) => warmupOllama(getOllamaHost(), getOllamaModel())).catch(() => {});
      }

      console.log(`${LOG} initialized (browser) — build ${BUILD_VERSION}`);
      return true;
    }
  } catch (e) {
    console.error(`${LOG} init error:`, e);
  }
  return false;
};

// Sine occasionally loads our entry script BEFORE Zen has finished setting up
// `gBrowser` and `gZenWorkspaces`. We try once immediately, then poll every
// INIT_CHECK_INTERVAL ms up to MAX_INIT_CHECKS times — default total ~5s before
// giving up with a warning. We track the interval id so cleanup() can stop it
// if the window is closed mid-poll (otherwise the timer keeps firing against
// a detached window until checkCount runs out).
let initInterval = null;
export const initializeBrowserScript = () => {
  if (tryInitializeBrowser()) return;
  let checkCount = 0;
  initInterval = setInterval(() => {
    checkCount++;
    if (tryInitializeBrowser()) {
      clearInterval(initInterval);
      initInterval = null;
    } else if (checkCount > CONFIG.MAX_INIT_CHECKS) {
      clearInterval(initInterval);
      initInterval = null;
      console.warn(`${LOG} init timed out`);
    }
  }, CONFIG.INIT_CHECK_INTERVAL);
};

export const teardownBrowserScript = () => {
  try {
    if (initInterval) {
      clearInterval(initInterval);
      initInterval = null;
    }
    domCache.invalidate();
    teardownTabContextMenu();
    teardownTabGroupContextMenu();
    teardownMinimalStylePrefObserver();
    teardownTabGroupCreateHook();
    teardownCollapsedStatePersistence();
    teardownWorkspaceHooks();
    teardownCommand();
    delete window.OpenTabSortZen;
    delete window.OpenTabSortZenLastRun;
  } catch (e) {
    console.error(`${LOG} cleanup error:`, e);
  }
};
