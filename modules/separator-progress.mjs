// The native separator is the progress surface. No added row or layout shift.
import { CONFIG, h } from "./config.mjs";
const STATE = "_zaoSeparatorOperation";
const activeButton = () => window.gZenWorkspaces?.activeWorkspaceElement?.querySelector(`#${CONFIG.BUTTON_ID}`) ||
  [...document.querySelectorAll(`#${CONFIG.BUTTON_ID}`)].find((node) => node.getBoundingClientRect().width > 0);

export const createSeparatorProgress = ({ onStop, onUndo, onDismiss, onSetup, onRetry, stage = "Preparing tabs…", className = "" } = {}) => {
  const first = activeButton();
  if (!first?.closest?.(".pinned-tabs-container-separator")) return null;
  const restoreFocus = Boolean(document.activeElement?.closest?.(".zao-separator-feedback"));
  window[STATE]?.remove();
  document.querySelectorAll(".zao-operation").forEach((node) => node._zaoOperationCleanup?.() || node.remove());
  const root = h("span", { class: `zao-operation zao-sort-progress zao-separator-feedback ${className}`.trim() });
  root.setAttribute("role", "group"); root.setAttribute("aria-label", "Tab sorting");
  root.setAttribute("data-placement", "separator"); root.setAttribute("data-state", "busy");
  const status = h("span", { class: "zao-separator-status" });
  status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); status.setAttribute("aria-atomic", "true");
  status.id = "zao-sort-status"; root.appendChild(status);
  let host, button, observer, resizeObserver, timer, finished = false, removed = false, stopping = false;
  let canUndo = false, canSetup = false, canRetry = false, retryStarted = false, detail = stage, hover = false;
  const listeners = [];
  const listen = (node, type, callback) => { node.addEventListener(type, callback); listeners.push(() => node.removeEventListener(type, callback)); };
  const clearTimer = () => { if (timer) window.clearTimeout(timer); timer = null; };
  const resetHost = () => {
    host?.parentElement?.style?.removeProperty?.("--zao-pinned-top");
    host?.removeAttribute("data-zao-state"); host?.removeAttribute("aria-busy");
    if (button) {
      button.removeAttribute("aria-describedby");
      button.removeAttribute("data-zao-busy"); button.removeAttribute("disabled");
      button.setAttribute("label", "Organize tabs"); button.setAttribute("aria-label", "Organize tabs");
      button.setAttribute("tooltiptext", "Organize tabs in this workspace");
    }
  };
  const action = (text, name, callback) => {
    const node = h("button", { text }); node.type = "button";
    node.setAttribute("data-action", name); node.setAttribute("aria-label", `${text} sort`);
    listen(node, "click", callback); root.appendChild(node); return node;
  };
  const undo = action("Undo", "undo", () => onUndo?.());
  const setup = action("Setup", "setup", () => onSetup?.());
  const retry = action("Retry", "retry", () => {
    if (!finished || !canRetry || retryStarted || removed) return;
    retryStarted = true; retry.disabled = true;
    const failed = () => { if (!removed) { retryStarted = false; retry.disabled = false; } };
    try { Promise.resolve(onRetry?.()).then(failed, failed); } catch { failed(); }
  });
  const close = action("", "dismiss", () => { try { onDismiss?.(); } finally { api.remove(); } });
  close.setAttribute("aria-label", "Dismiss notification");
  close.className = "zao-separator-dismiss";
  const cross = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  cross.setAttribute("viewBox", "0 0 16 16"); cross.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "m4 4 8 8m0-8-8 8"); path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor"); path.setAttribute("stroke-width", "1.5"); path.setAttribute("stroke-linecap", "round");
  cross.appendChild(path); close.appendChild(cross);
  const actions = () => {
    undo.hidden = !finished || !canUndo || !onUndo;
    setup.hidden = !finished || canUndo || !canSetup || !onSetup;
    retry.hidden = !finished || canUndo || canSetup || !canRetry || !onRetry;
    close.hidden = !finished;
  };
  const scheduleDismiss = () => {
    clearTimer();
    if (finished && !canSetup && !canRetry && !hover && !root.contains(document.activeElement)) timer = window.setTimeout(api.remove, 5000);
  };
  const sync = () => {
    root.setAttribute("data-state", finished ? (canSetup || canRetry ? "error" : "finished") : "busy");
    if (!host || !button) return;
    host.setAttribute("data-zao-state", finished ? (canSetup || canRetry ? "error" : "finished") : "busy");
    host.setAttribute("aria-busy", String(!finished));

    button.setAttribute("aria-describedby", status.id);
    retry.title = setup.title = detail; undo.title = "Undo the last grouping"; close.title = "Dismiss";
    button.toggleAttribute("data-zao-busy", !finished);
    button.toggleAttribute("disabled", !finished && stopping);
    button.setAttribute("label", finished ? "Organize tabs" : "Stop sorting");
    button.setAttribute("aria-label", finished ? "Organize tabs" : "Stop sorting");
    button.setAttribute("tooltiptext", `${finished ? "Organize tabs" : "Stop sorting"} — ${detail}`);
  };
  const measurePinned = () => {
    if (removed) return;
    const pinned = host?.parentElement;
    if (pinned?.matches?.(".zen-workspace-pinned-tabs-section")) pinned.style.setProperty("--zao-pinned-top", `${host.getBoundingClientRect().height - pinned.getBoundingClientRect().height}px`);
  };
  const api = {
    refresh() {
      if (removed) return;
      const next = activeButton(), separator = next?.closest?.(".pinned-tabs-container-separator");
      if (!separator) return;
      if (host === separator && button === next) return;
      if (host !== separator || button !== next) {
        resetHost(); host = separator; button = next;
        observer?.disconnect(); resizeObserver?.disconnect(); host.insertBefore(root, button);
        if (window.MutationObserver) {
          observer = new window.MutationObserver(() => { if (!root.isConnected) api.remove(); });
          observer.observe(host, { childList: true });
        }
      }
      sync(); measurePinned();
      if (window.ResizeObserver && host.parentElement) { resizeObserver = new window.ResizeObserver(measurePinned); resizeObserver.observe(host.parentElement); }
    },
    stop() {
      if (finished || removed) return false;
      if (stopping) return true;
      stopping = true; api.stage("Stopping…"); onStop?.(); return true;
    },
    stage(message) { detail = String(message); status.textContent = detail; status.title = detail; status.setAttribute("aria-label", detail); sync(); },
    update({ processed, total }) { api.stage(`Tidying ${processed} / ${total} tabs…`); },
    finish(message, undoAvailable = false, { label = message } = {}) {
      const focusedStop = document.activeElement === button;
      finished = true; canUndo = undoAvailable;
      root.setAttribute("data-state", canSetup || canRetry ? "error" : "finished");
      detail = String(message); status.textContent = String(label); status.title = detail; status.setAttribute("aria-label", detail);
      api.refresh(); sync(); measurePinned(); actions(); scheduleDismiss();
      if (focusedStop && !undo.hidden) undo.focus();
    },
    setUndoAvailable(value) { canUndo = value; actions(); },
    setupAvailable() { canSetup = true; clearTimer(); actions(); sync(); },
    retryAvailable() { canRetry = true; clearTimer(); actions(); sync(); },
    notice(message) { detail = String(message); status.title = detail; status.textContent = detail; status.setAttribute("aria-label", detail); sync(); clearTimer(); return { remove: api.remove }; },
    remove() {
      if (removed) return;
      removed = true; clearTimer(); observer?.disconnect(); resizeObserver?.disconnect(); resetHost();
      for (const cleanup of listeners.splice(0)) cleanup();
      root.remove(); if (window[STATE] === api) delete window[STATE];
    },
  };
  root._zaoOperationCleanup = api.remove;
  listen(root, "mouseenter", () => { hover = true; clearTimer(); }); listen(root, "mouseleave", () => { hover = false; scheduleDismiss(); });
  listen(root, "focusin", clearTimer); listen(root, "focusout", () => queueMicrotask(scheduleDismiss));
  listen(root, "keydown", (event) => { if (finished && event.key === "Escape") { event.preventDefault(); close.click(); } });
  listen(window, "unload", api.remove);
  window[STATE] = api; api.refresh(); actions(); api.stage(stage);
  if (restoreFocus) button?.focus();
  return api;
};
