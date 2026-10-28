import { CONFIG, h } from "./config.mjs";

const ensureStyles = () => {
  if (document.getElementById("zao-operation-styles")) return;
  const sheet = h("link"); sheet.id = "zao-operation-styles"; sheet.rel = "stylesheet";
  sheet.href = CONFIG.CSS_URL.replace("userChrome.css", "styles/operations.css");
  (document.head || document.documentElement).appendChild(sheet);
};
const button = (text, onClick) => {
  const node = h("button", { text }); node.type = "button";
  node.addEventListener("click", onClick); return node;
};
export const showNotice = (message) => {
  ensureStyles();
  document.querySelector(".zao-notice")?.remove();
  const root = h("section", { class: "zao-operation zao-notice" });
  root.setAttribute("aria-label", "OpenTabSort notification");
  const status = h("p", { class: "zao-operation-message", text: message });
  status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  root.append(status, button("Dismiss", () => root.remove()));
  document.documentElement.appendChild(root);
};
export const showSortProgress = ({ onStop, onUndo, onDismiss, onSetup, stage = "Preparing tabs…", className = "" } = {}) => {
  ensureStyles();
  document.querySelector(".zao-sort-progress")?.remove();
  const root = h("section", { class: `zao-operation zao-sort-progress ${className}`.trim() });
  root.setAttribute("aria-label", "Tab sorting");
  const status = h("p", { class: "zao-operation-message", text: stage });
  status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const meter = h("progress"); meter.setAttribute("aria-label", "Tab sorting progress");
  const stop = button("Stop", () => { onStop?.(); stop.disabled = true; status.textContent = "Stopping…"; });
  const undo = button("Undo sort", () => { onUndo?.(); }); undo.hidden = true;
  const dismiss = button("Dismiss", () => { onDismiss?.(); root.remove(); }); dismiss.hidden = true;
  const setup = button("AI setup", () => onSetup?.()); setup.hidden = true;
  root.append(status, meter, stop, undo, setup, dismiss);
  document.documentElement.appendChild(root);
  return {
    stage(message) { status.textContent = message; meter.removeAttribute("value"); },
    update({ processed, total, moved = 0, skipped = 0, unresolved = 0 }) {
      meter.max = Math.max(1, total); meter.value = processed;
      status.textContent = `Organizing · ${processed} / ${total} · ${moved} moved${skipped + unresolved ? ` · ${skipped + unresolved} kept` : ""}`;
    },
    finish(message, canUndo = false) {
      status.textContent = message; meter.hidden = true; stop.hidden = true;
      undo.hidden = !canUndo; dismiss.hidden = false;
    },
    setUndoAvailable(value) { undo.hidden = !value; },
    setupAvailable() { setup.hidden = !onSetup; },
    remove() { root.remove(); },
  };
};
