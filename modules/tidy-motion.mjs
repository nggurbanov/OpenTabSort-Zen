// A bounded FLIP pass over the visible sidebar, after native tab placement.
// Independent translate effects preserve Zen's own transform and inline styles.
const active = new WeakMap();
const MAX_ROWS = 40;
const DURATION = 260;
const EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
const idle = Object.freeze({ play() {}, cancel() {} });
const excluded = ["zen-empty-tab", "zen-glance-tab", "zen-essential"];

const rectOf = (element) => {
  const rect = element?.getBoundingClientRect?.();
  return rect && [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) &&
    rect.width > 0 && rect.height > 0 ? rect : null;
};
const intersect = (a, b) => ({
  left: Math.max(a.left, b.left), top: Math.max(a.top, b.top),
  right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom),
});
const inView = (rect, viewport) => rect && rect.right > viewport.left &&
  rect.left < viewport.right && rect.bottom > viewport.top && rect.top < viewport.bottom;
const viewportOf = (win, browser) => {
  const arrows = browser.tabContainer?.arrowScrollbox ||
    win.document?.getElementById?.("tabbrowser-arrowscrollbox");
  const scroller = arrows?.scrollbox || arrows;
  const bounds = rectOf(scroller || browser.tabContainer);
  if (!bounds) return null;
  const viewport = intersect(bounds, { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight });
  return viewport.right > viewport.left && viewport.bottom > viewport.top
    ? { ...viewport, scroller, scrollTop: scroller?.scrollTop, scrollLeft: scroller?.scrollLeft } : null;
};
const neutralTranslate = (value) => !value || value === "none" || /^0(?:px)?(?: 0(?:px)?){0,2}$/.test(value);
const canAnimate = (win, element) => {
  if (!element?.isConnected || typeof element.animate !== "function") return false;
  const style = win.getComputedStyle(element);
  return style.visibility === "visible" && style.display !== "none" &&
    style.opacity !== "0" && neutralTranslate(style.translate);
};

export const cancelTidyMotion = (win = globalThis.window) => {
  if (win) active.get(win)?.cancel();
};

export const captureTidyMotion = (workspaceId, win = globalThis.window) => {
  // Motion is optional: never let unsupported chrome APIs affect placement.
  try {
    cancelTidyMotion(win);
    const browser = win?.gBrowser || globalThis.gBrowser;
    if (!win || !browser || typeof win.requestAnimationFrame !== "function" ||
        typeof win.getComputedStyle !== "function" || win.document?.hidden ||
        win.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
        !win.CSS?.supports?.("translate", "1px 1px")) return idle;
    const viewport = viewportOf(win, browser);
    if (!viewport) return idle;
    const entries = [], seen = new Set();
    const remember = (row, target = row) => {
      if (entries.length >= MAX_ROWS || seen.has(row) || !canAnimate(win, target)) return;
      const rect = rectOf(row);
      if (!inView(rect, viewport)) return;
      seen.add(row);
      entries.push({ row, target, left: rect.left, top: rect.top });
    };
    for (const tab of browser.tabs || []) {
      if (!tab.isConnected || tab.pinned || tab.hidden ||
          tab.getAttribute?.("zen-workspace-id") !== workspaceId ||
          excluded.some((attribute) => tab.hasAttribute?.(attribute))) continue;
      const group = tab.closest?.("tab-group");
      if (group) {
        const label = group.querySelector?.(".tab-group-label-container") ||
          group.querySelector?.(".tab-group-label");
        if (label) remember(label);
      }
      remember(tab, tab.querySelector?.(".tab-stack") || tab);
      if (entries.length >= MAX_ROWS) break;
    }
    if (!entries.length) return idle;

    let frame = null, stopped = false;
    const animations = new Set();
    const release = () => {
      win.removeEventListener?.("unload", cancel);
      if (active.get(win) === token) active.delete(win);
      entries.length = 0;
    };
    const cancel = () => {
      if (stopped) return;
      stopped = true;
      if (frame !== null) win.cancelAnimationFrame?.(frame);
      frame = null;
      for (const animation of animations) { try { animation.cancel(); } catch {} }
      animations.clear();
      release();
    };
    const play = () => {
      if (stopped || frame !== null) return;
      frame = win.requestAnimationFrame(() => {
        frame = null;
        try {
          if (win.document?.hidden || win.gZenWorkspaces?.activeWorkspace !== workspaceId ||
              win.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
              viewport.scroller?.scrollTop !== viewport.scrollTop ||
              viewport.scroller?.scrollLeft !== viewport.scrollLeft) { cancel(); return; }
          const nextViewport = viewportOf(win, browser);
          if (!nextViewport) { cancel(); return; }
          // Read every final position before writing any effect. Native grouping
          // completes synchronously; this frame also lets its observers settle.
          const movements = [];
          for (const { row, target, left, top } of entries) {
            if (!row.isConnected || !canAnimate(win, target)) continue;
            const rect = rectOf(row);
            if (!inView(rect, nextViewport)) continue;
            const dx = left - rect.left, dy = top - rect.top;
            if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
            movements.push({ target, dx, dy });
          }
          for (const { target, dx, dy } of movements) {
            try {
              const animation = target.animate(
                [{ translate: `${dx}px ${dy}px` }, { translate: "0px 0px" }],
                { duration: DURATION, easing: EASING, fill: "none" },
              );
              animations.add(animation);
              Promise.resolve(animation.finished).catch(() => {}).then(() => {
                animations.delete(animation);
                if (!animations.size && !stopped) { stopped = true; release(); }
              });
            } catch {}
          }
          entries.length = 0;
          if (!animations.size) { stopped = true; release(); }
        } catch { cancel(); }
      });
    };
    const token = { play, cancel };
    active.set(win, token);
    win.addEventListener?.("unload", cancel, { once: true });
    return token;
  } catch { return idle; }
};
