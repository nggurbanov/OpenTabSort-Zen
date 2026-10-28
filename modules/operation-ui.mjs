import { createSeparatorProgress } from "./separator-progress.mjs";
import { CONFIG, h } from "./config.mjs";

// Browser-chrome feedback must work before any external stylesheet resolves.
// Keep this string identical to styles/operations.css (covered by a test).
const OPERATION_CSS = String.raw`/* Compact browser-chrome feedback. Also embedded in operation-ui.mjs so Sine
   never has to resolve an additional stylesheet before showing the first row. */
.zao-operation {
  box-sizing: border-box; display: flex; flex: 0 0 auto; align-items: center;
  align-self: stretch; min-width: 0; min-height: 32px; gap: 4px; margin: 0 4px 4px;
  padding: 2px 4px; border: 0; border-radius: 6px;
  color: var(--toolbar-color, CanvasText); background: transparent;
  font: menu; font-size: 12px; line-height: 1.3; text-align: start;
  animation: zao-feedback-appear 120ms ease-out;
}
.zao-operation[data-placement="overlay"] {
  position: fixed; z-index: 2147483646; width: min(300px, calc(100vw - 16px));
  margin: 0; background: var(--zen-colors-tertiary, Canvas);
  box-shadow: 0 2px 8px rgb(0 0 0 / 15%);
}
.zao-operation-message {
  flex: 1 1 auto; min-width: 0; margin: 0; overflow: hidden;
  white-space: nowrap; text-overflow: ellipsis;
}
.zao-operation-indicator { flex: none; width: 12px; height: 12px; animation: zao-feedback-work 900ms linear infinite; }
.zao-operation button {
  appearance: none; -moz-appearance: none; box-sizing: border-box; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 0; min-height: 24px; margin: 0; padding: 2px;
  border: 0; border-radius: 4px; background: transparent; color: inherit;
  font: inherit; line-height: inherit; white-space: nowrap; cursor: pointer;
}
.zao-operation button:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
.zao-operation button:active { background: color-mix(in srgb, currentColor 16%, transparent); }
.zao-operation button:focus-visible { outline: 2px solid var(--zen-primary-color, AccentColor); outline-offset: 1px; }
.zao-operation button:disabled { opacity: .55; cursor: default; }
.zao-operation .zao-operation-close { width: 24px; padding: 4px; }
.zao-operation-close svg { width: 12px; height: 12px; pointer-events: none; }
.zao-operation [hidden] { display: none !important; }
@keyframes zao-feedback-appear { from { opacity: .5; } to { opacity: 1; } }
@keyframes zao-feedback-work { to { rotate: 360deg; } }
@media (prefers-reduced-motion: reduce) {
  .zao-operation, .zao-operation *, #tab-wand-button, #tab-wand-button *,
  .zao-spinner, .zao-sort-highlight { animation: none !important; transition: none !important; }
}`;
const AUTO_DISMISS_MS = 5000;
const CLEANUP = "_zaoOperationCleanup";
const progressRows = new WeakMap();
const ensureStyles = () => {
  const existing = document.getElementById("zao-operation-styles");
  if (existing?.localName === "style" && existing.textContent === OPERATION_CSS) return;
  existing?.remove();
  const sheet = h("style", { text: OPERATION_CSS });
  sheet.id = "zao-operation-styles";
  (document.head || document.documentElement).appendChild(sheet);
};
const icon = (path) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [name, value] of Object.entries({ viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round", "aria-hidden": "true" })) svg.setAttribute(name, value);
  const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
  line.setAttribute("d", path); svg.appendChild(line); return svg;
};
const removeRow = (node) => { if (node?.[CLEANUP]) node[CLEANUP](); else node?.remove(); };
const createRow = (className, label, message) => {
  ensureStyles();
  // A new operation or notification replaces the preceding row, not its receipt.
  document.querySelectorAll(".zao-operation").forEach(removeRow);
  const root = h("section", { class: `zao-operation ${className}`.trim() });
  root.setAttribute("aria-label", label);
  root.setAttribute("data-state", "busy");
  const indicator = icon("M8 2a6 6 0 1 1-6 6"); indicator.classList.add("zao-operation-indicator");
  const status = h("p", { class: "zao-operation-message" });
  status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); status.setAttribute("aria-atomic", "true");
  const setMessage = (value, label = value) => {
    status.textContent = String(label); status.title = String(value); status.setAttribute("aria-label", String(value));
  };
  setMessage(message); root.append(indicator, status);
  let removed = false, timer = null, observer = null, hover = false, focus = false, canDismiss = false;
  const listeners = [];
  const listen = (target, type, callback) => { target.addEventListener(type, callback); listeners.push(() => target.removeEventListener(type, callback)); };
  const clearTimer = () => { if (timer !== null) { window.clearTimeout(timer); timer = null; } };
  const remove = () => {
    if (removed) return;
    removed = true; clearTimer(); observer?.disconnect();
    for (const cleanup of listeners.splice(0)) cleanup();
    delete root[CLEANUP]; root.remove();
  };
  root[CLEANUP] = remove;
  const scheduleDismiss = () => {
    clearTimer();
    if (!removed && canDismiss && !hover && !focus) timer = window.setTimeout(remove, AUTO_DISMISS_MS);
  };
  listen(root, "mouseenter", () => { hover = true; clearTimer(); });
  listen(root, "mouseleave", () => { hover = false; scheduleDismiss(); });
  listen(root, "focusin", () => { focus = true; clearTimer(); });
  listen(root, "focusout", (event) => { focus = root.contains(event.relatedTarget); scheduleDismiss(); });
  listen(window, "unload", remove);
  const candidates = [...document.querySelectorAll(`#${CONFIG.BUTTON_ID}`)];
  const anchor = candidates.find((node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; });
  // Workspace separators live inside Zen's tab scroll area. Native selected-tab
  // scrolling can move them thousands of pixels offscreen after applying a plan.
  // The outer toolbox is the stable sidebar column; keep feedback before its
  // tab-area child so Stop and Undo remain reachable at every scroll position.
  const sidebar = document.getElementById("navigator-toolbox");
  const tabArea = document.getElementById("titlebar");
  const sidebarBounds = sidebar?.getBoundingClientRect();
  const stableSidebar = tabArea?.parentElement === sidebar && sidebarBounds?.width >= 120 &&
    window.getComputedStyle(sidebar).flexDirection === "column";
  if (stableSidebar) {
    root.setAttribute("data-placement", "sidebar");
    sidebar.insertBefore(root, tabArea);
  } else {
    root.setAttribute("data-placement", "overlay");
    const position = () => {
      const rect = anchor?.getBoundingClientRect();
      const width = Math.min(300, Math.max(0, window.innerWidth - 16));
      root.style.insetInlineStart = `${Math.max(8, Math.min(rect?.left ?? 8, window.innerWidth - width - 8))}px`;
      root.style.top = `${Math.max(8, Math.min((rect?.bottom ?? 40) + 6, window.innerHeight - 48))}px`;
    };
    position(); listen(window, "resize", position);
    document.documentElement.appendChild(root);
  }
  // Some native callers remove the element directly when invalidating Undo.
  // Release timers and window listeners on that path as well.
  if (window.MutationObserver) {
    observer = new window.MutationObserver(() => { if (!root.isConnected) remove(); });
    observer.observe(root.parentElement, { childList: true });
  }
  const button = (text, callback, className = "") => {
    const node = h("button", { class: className, text }); node.type = "button";
    listen(node, "click", callback); root.appendChild(node); return node;
  };
  const dismiss = (callback) => { try { callback?.(); } finally { remove(); } };
  return { root, indicator, status, button, listen, remove, dismiss, setMessage,
    autoDismiss(value) { canDismiss = value; scheduleDismiss(); } };
};
const addClose = (row, callback) => {
  const close = row.button("", () => row.dismiss(callback), "zao-operation-close");
  close.setAttribute("aria-label", "Dismiss notification"); close.setAttribute("data-action", "dismiss"); close.title = "Dismiss";
  close.appendChild(icon("m4 4 8 8m0-8-8 8")); return close;
};
export const showNotice = (message) => {
  if (window._zaoSeparatorOperation) return window._zaoSeparatorOperation.notice(message);
  // A duplicate-click notice should not replace the active Stop control.
  const progress = document.querySelector(".zao-sort-progress");
  if (progress?.getAttribute("data-state") === "busy") return;
  // A refusal to Undo belongs in the existing feedback. Replacing that row
  // would remove its controls and keyboard focus while leaving a live receipt.
  const existing = progressRows.get(progress);
  if (existing?.preserveUndo) { existing.setMessage(message); existing.autoDismiss(false); return { remove: existing.remove }; }
  const row = createRow("zao-notice", "OpenTabSort notification", message);
  row.root.setAttribute("data-state", "notice"); row.indicator.setAttribute("hidden", "");
  addClose(row); row.autoDismiss(true);
  return { remove: row.remove };
};
export const showSortProgress = ({ onStop, onUndo, onDismiss, onSetup, onRetry, stage = "Preparing tabs…", className = "" } = {}) => {
  const separator = createSeparatorProgress({ onStop, onUndo, onDismiss, onSetup, onRetry, stage, className });
  if (separator) return separator;
  const restoreFocus = Boolean(document.activeElement?.closest?.(".zao-operation"));
  const row = createRow(`zao-sort-progress ${className}`, "Tab sorting", stage);
  progressRows.set(row.root, { ...row, preserveUndo: Boolean(onUndo) });
  let finished = false, undoAvailable = false, setupAvailable = false, retryAvailable = false, retryStarted = false;
  const stop = row.button("Stop", () => { stop.disabled = true; row.setMessage("Stopping…"); onStop?.(); });
  stop.setAttribute("data-action", "stop");
  const undo = row.button("Undo", () => onUndo?.()); undo.hidden = true;
  undo.setAttribute("aria-label", "Undo sort"); undo.setAttribute("data-action", "undo");
  const setup = row.button("Setup", () => onSetup?.()); setup.hidden = true;
  setup.setAttribute("aria-label", "AI setup"); setup.setAttribute("data-action", "setup");
  const retry = row.button("Retry", () => {
    if (!finished || !retryAvailable || retryStarted || retry.hidden || !row.root.isConnected) return;
    retryStarted = true; retry.disabled = true;
    const failed = () => {
      if (!row.root.isConnected) return;
      retryStarted = false; retry.disabled = false;
    };
    try { Promise.resolve(onRetry?.()).catch(failed); } catch { failed(); }
  }); retry.hidden = true;
  retry.setAttribute("aria-label", "Retry sort"); retry.setAttribute("data-action", "retry");
  const close = addClose(row, onDismiss); close.hidden = true;
  const actions = () => {
    const focused = document.activeElement;
    stop.hidden = finished; close.hidden = !finished;
    // Keep a previous valid Undo reachable, even if a follow-up failed.
    undo.hidden = !finished || !undoAvailable || !onUndo;
    setup.hidden = !finished || undoAvailable || !setupAvailable || !onSetup;
    retry.hidden = !finished || undoAvailable || setupAvailable || !retryAvailable || !onRetry;
    if ([stop, undo, setup, retry].includes(focused) && focused.hidden) {
      [undo, setup, retry, close].find((node) => !node.hidden)?.focus?.();
    }
  };
  if (restoreFocus) stop.focus?.();
  row.listen(row.root, "keydown", (event) => { if (finished && event.key === "Escape") { event.preventDefault(); row.dismiss(onDismiss); } });
  return {
    stage(message) { row.setMessage(message); },
    update({ processed, total }) { row.setMessage(`Tidying ${processed} / ${total} tabs…`); },
    finish(message, canUndo = false, { label = message } = {}) {
      finished = true; undoAvailable = canUndo;
      row.setMessage(message, label); row.indicator.setAttribute("hidden", "");
      row.root.setAttribute("data-state", setupAvailable || retryAvailable ? "error" : "finished");
      actions(); row.autoDismiss(!setupAvailable && !retryAvailable);
    },
    setUndoAvailable(value) { undoAvailable = value; actions(); },
    setupAvailable() {
      setupAvailable = true;
      if (finished) row.root.setAttribute("data-state", "error");
      actions(); row.autoDismiss(false);
    },
    retryAvailable() {
      retryAvailable = true;
      if (finished) row.root.setAttribute("data-state", "error");
      actions(); row.autoDismiss(false);
    },
    remove: row.remove,
  };
};
