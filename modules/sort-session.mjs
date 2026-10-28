// One cancellable planning session per browser window. No background polling.
import { CONFIG } from "./config.mjs";

const sessions = new WeakMap();
const relevantPrefNames = () => Object.entries(CONFIG)
  .filter(([key]) => key.endsWith("_PREF") && (key.startsWith("AI_") ||
    ["RULES_PREF", "SKIP_DOMAINS_PREF", "STRICT_RULES_PREF", "MATCH_MODE_PREF"].includes(key)))
  .map(([, value]) => value);
export const primarySortPrefNames = (engine, categoryProvider = "openai") => {
  const fields = {
    openai: [CONFIG.AI_OPENAI_ENDPOINT_PREF, CONFIG.AI_OPENAI_API_KEY_PREF, CONFIG.AI_OPENAI_MODEL_PREF],
    gemini: [CONFIG.AI_GEMINI_API_KEY_PREF, CONFIG.AI_GEMINI_MODEL_PREF],
    custom: [CONFIG.AI_CUSTOM_ENDPOINT_PREF, CONFIG.AI_CUSTOM_API_KEY_PREF, CONFIG.AI_CUSTOM_MODEL_PREF, CONFIG.AI_CUSTOM_FORMAT_PREF],
    ollama: [CONFIG.AI_OLLAMA_HOST_PREF, CONFIG.AI_OLLAMA_MODEL_PREF],
    local: [CONFIG.AI_LOCAL_BATCH_SIZE_PREF],
    jev: [CONFIG.AI_JEV_ENDPOINT_PREF, CONFIG.AI_JEV_API_KEY_PREF, CONFIG.AI_JEV_MODEL_PREF,
      CONFIG.AI_JEV_CATEGORY_PROVIDER_PREF, CONFIG.AI_JEV_CONFIDENCE_PREF],
  };
  return [...new Set([CONFIG.AI_ENGINE_PREF, CONFIG.AI_REVIEW_PREF, CONFIG.SKIP_DOMAINS_PREF,
    ...(!["local", "ollama"].includes(engine) ? [CONFIG.AI_PROVIDER_CONSENT_PREF] : []),
    ...(fields[engine] || []), ...(engine === "jev" ? fields[categoryProvider] || [] : [])].filter(Boolean))];
};
export const captureSortSettings = (prefs, names = relevantPrefNames()) => JSON.stringify(names.map((name) => {
  const type = prefs.getPrefType?.(name);
  const value = type === prefs.PREF_BOOL && type !== undefined ? prefs.getBoolPref(name) :
    type === prefs.PREF_INT && type !== undefined ? prefs.getIntPref(name) : prefs.getStringPref(name, "");
  return [name, value];
}));
const currentWindow = () => typeof window === "undefined" ? null : window;
const currentSession = () => { const win = currentWindow(); return win ? sessions.get(win) : null; };
const stoppedError = (message = "Sorting stopped.") => new DOMException(message, "AbortError");

export const getActiveSortSignal = () => {
  const session = currentSession();
  session?.checkpoint();
  return session?.signal;
};
export const throwIfSortCancelled = () => currentSession()?.checkpoint();
export const reportSortProgress = (stage) => currentSession()?.onProgress?.(stage);
export const stopActiveSort = () => currentSession()?.stop();

export const beginSortSession = ({ isCurrent = () => true, onProgress, onTabChange, onLocationChange,
  prefNames = relevantPrefNames(), preferenceReason = "stale" } = {}) => {
  const win = currentWindow();
  if (!win) throw new Error("A browser window is required to sort tabs.");
  if (sessions.has(win)) throw new Error("Sorting is already running.");
  const controller = new AbortController();
  const relevantPrefs = new Set(prefNames);
  let disposed = false, queued = false;
  const session = {
    signal: controller.signal, onProgress, reason: "",
    stop(reason = "stopped") {
      if (disposed || controller.signal.aborted) return;
      session.reason = reason;
      controller.abort(stoppedError(reason === "stale" ? "Tabs or settings changed while sorting. Run it again." : "Sorting stopped."));
    },
    checkpoint() {
      if (disposed) return;
      if (!controller.signal.aborted) {
        const current = isCurrent();
        if (current !== true) session.stop(typeof current === "string" ? current : "stale");
      }
      controller.signal.throwIfAborted();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try { Services.prefs.removeObserver("extensions.zen-auto-organize.", prefObserver); } catch {}
      for (const name of events) win.gBrowser?.tabContainer?.removeEventListener(name, scheduleCheck);
      try { win.gBrowser?.removeTabsProgressListener?.(navigation); } catch {}
      try { win.gZenWorkspaces?.removeChangeListeners?.(scheduleCheck); } catch {}
      win.removeEventListener?.("beforeunload", unload);
      if (sessions.get(win) === session) sessions.delete(win);
    },
  };
  const scheduleCheck = (event) => {
    if (disposed || controller.signal.aborted) return;
    onTabChange?.(event);
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!disposed) { try { session.checkpoint(); } catch {} }
    });
  };
  const events = ["TabOpen", "TabClose", "TabMove", "TabPinned", "TabUnpinned", "TabGrouped", "TabUngrouped", "TabAttrModified"];
  const prefObserver = { observe(_subject, topic, name) {
    if (topic === "nsPref:changed" && relevantPrefs.has(name)) session.stop(preferenceReason);
  } };
  const navigation = { onLocationChange: (...args) => {
    if (disposed || controller.signal.aborted) return;
    onLocationChange?.(...args); scheduleCheck();
  } };
  const unload = () => { session.stop(); session.dispose(); };
  sessions.set(win, session);
  try {
    Services.prefs.addObserver("extensions.zen-auto-organize.", prefObserver);
    for (const name of events) win.gBrowser?.tabContainer?.addEventListener(name, scheduleCheck);
    win.gBrowser?.addTabsProgressListener?.(navigation);
    win.gZenWorkspaces?.addChangeListeners?.(scheduleCheck);
    win.addEventListener?.("beforeunload", unload, { once: true });
    session.checkpoint();
  } catch (error) { session.dispose(); throw error; }
  return session;
};
