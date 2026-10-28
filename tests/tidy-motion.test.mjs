import test from "node:test";
import assert from "node:assert/strict";
import { captureTidyMotion, cancelTidyMotion } from "../modules/tidy-motion.mjs";
import { applyPass2 } from "../modules/apply-plan.mjs";
import { workspaceId, withBrowser } from "./helpers/native-tabs.mjs";

const workspace = "current";
const rect = (left, top, width = 220, height = 24) => ({ left, top, right: left + width, bottom: top + height, width, height });
const makeWindow = () => {
  const frames = new Map(), listeners = new Map(), animations = [], reads = [];
  let serial = 0;
  const scroller = { scrollTop: 0, scrollLeft: 0, getBoundingClientRect: () => rect(0, 0, 260, 600) };
  const win = {
    innerWidth: 1000, innerHeight: 800, document: { hidden: false }, reduced: false,
    gZenWorkspaces: { activeWorkspace: workspace },
    CSS: { supports: () => true }, matchMedia: () => ({ matches: win.reduced }),
    getComputedStyle: (node) => ({ visibility: "visible", display: "block", opacity: "1", translate: node.translate || "none", transform: node.transform || "none" }),
    requestAnimationFrame: (fn) => { const id = ++serial; frames.set(id, fn); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); },
    gBrowser: { tabs: [], tabContainer: { arrowScrollbox: { scrollbox: scroller } } },
  };
  const row = (top, options = {}) => {
    const target = {
      isConnected: true, translate: options.translate, transform: options.transform,
      animate: (keyframes, timing) => {
        let finish, reject;
        const animation = { keyframes, timing, target, cancelled: false, readsAtStart: reads.length,
          finished: new Promise((resolve, fail) => { finish = resolve; reject = fail; }),
          cancel() { this.cancelled = true; reject(new Error("cancelled")); }, finish() { finish(); },
        };
        animations.push(animation); return animation;
      },
    };
    const node = {
      isConnected: true, pinned: Boolean(options.pinned), hidden: Boolean(options.hidden), top,
      getAttribute: () => options.workspace || workspace,
      hasAttribute: (attribute) => attribute === options.excluded,
      closest: () => options.group || null, querySelector: () => target,
      getBoundingClientRect: () => { reads.push(node); return rect(0, node.top); },
      target,
    };
    win.gBrowser.tabs.push(node); return node;
  };
  const frame = () => { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(); };
  return { win, row, frame, frames, listeners, animations, reads, scroller };
};

test("visible native rows move for 260ms without changing native transforms or inline styles", () => {
  const fixture = makeWindow(), { win, row, frame, animations, frames } = fixture;
  const first = row(24, { transform: "matrix(1, 0, 0, 1, 3, 0)" }), second = row(72);
  const motion = captureTidyMotion(workspace, win);
  first.top = 72; second.top = 24;
  motion.play();
  assert.equal(animations.length, 0); assert.equal(frames.size, 1);
  frame();
  assert.equal(animations.length, 2);
  assert.deepEqual(animations[0].keyframes, [{ translate: "0px -48px" }, { translate: "0px 0px" }]);
  assert.deepEqual(animations[0].timing, { duration: 260, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "none" });
  assert.equal(first.target.transform, "matrix(1, 0, 0, 1, 3, 0)");
  assert.equal(first.target.translate, undefined);
  assert.equal(animations[0].readsAtStart, animations[1].readsAtStart, "all final positions read before effects write");
  cancelTidyMotion(win);
});

test("hundreds of rows produce at most 40 visible effects and exclude pinned, special and foreign rows", () => {
  const { win, row, frame, animations } = makeWindow();
  const forbidden = [row(20, { pinned: true }), row(40, { excluded: "zen-essential" }),
    row(60, { excluded: "zen-glance-tab" }), row(80, { excluded: "zen-empty-tab" }),
    row(100, { workspace: "elsewhere" }), row(120, { hidden: true })];
  const candidates = Array.from({ length: 300 }, (_, i) => row(150 + i));
  const motion = captureTidyMotion(workspace, win);
  for (const item of [...forbidden, ...candidates]) item.top += 2;
  motion.play(); frame();
  assert.equal(animations.length, 40);
  assert.ok(animations.every((animation) => !forbidden.some((item) => item.target === animation.target)));
  cancelTidyMotion(win);
});

test("offscreen, detached, unchanged and externally translated rows never animate", () => {
  const { win, row, frame, animations } = makeWindow();
  const offscreen = row(700), leaving = row(580), detached = row(20), externallyTranslated = row(60, { translate: "2px 0px" });
  row(100);
  const motion = captureTidyMotion(workspace, win);
  offscreen.top = 200; leaving.top = 650; detached.isConnected = false; externallyTranslated.top += 50;
  motion.play(); frame();
  assert.equal(animations.length, 0);
});

test("reduced motion skips measurement and a late preference change cancels queued movement", () => {
  const fixture = makeWindow(), { win, row, reads, frame, animations, frames } = fixture;
  const item = row(30); win.reduced = true;
  captureTidyMotion(workspace, win).play();
  assert.equal(reads.length, 0); assert.equal(frames.size, 0);
  win.reduced = false; const motion = captureTidyMotion(workspace, win);
  item.top += 30; motion.play(); win.reduced = true; frame();
  assert.equal(animations.length, 0);
});

for (const change of ["scroll", "workspace", "hidden"]) {
  test(`${change} before final layout cancels rather than moving stale sidebar rows`, () => {
    const { win, row, frame, animations, scroller, listeners } = makeWindow();
    const item = row(30), motion = captureTidyMotion(workspace, win);
    item.top += 30; motion.play();
    if (change === "scroll") scroller.scrollTop = 10;
    if (change === "workspace") win.gZenWorkspaces.activeWorkspace = "other";
    if (change === "hidden") win.document.hidden = true;
    frame(); assert.equal(animations.length, 0); assert.equal(listeners.size, 0);
  });
}

test("new capture cancels older frames and active effects; unload releases all references", () => {
  const { win, row, frame, animations, frames, listeners } = makeWindow();
  const item = row(30), queued = captureTidyMotion(workspace, win);
  item.top += 30; queued.play();
  const motion = captureTidyMotion(workspace, win);
  assert.equal(frames.size, 0);
  item.top += 30; motion.play(); frame();
  assert.equal(animations.length, 1);
  captureTidyMotion(workspace, win);
  assert.equal(animations[0].cancelled, true);
  listeners.get("unload")();
  assert.equal(listeners.size, 0); assert.equal(frames.size, 0);
});

test("finishing effects removes lifecycle listeners and cancellation is idempotent", async () => {
  const { win, row, frame, animations, listeners } = makeWindow();
  const item = row(30), motion = captureTidyMotion(workspace, win);
  item.top += 30; motion.play(); frame();
  animations[0].finish(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(listeners.size, 0);
  motion.cancel(); motion.cancel(); cancelTidyMotion(win);
  assert.equal(animations[0].cancelled, false);
});

test("native animation rejection and unsupported chrome APIs cannot break sorting", () => {
  const { win, row, frame, listeners } = makeWindow();
  const item = row(30); item.target.animate = () => { throw new Error("unsupported native row"); };
  const motion = captureTidyMotion(workspace, win); item.top += 30; motion.play();
  assert.doesNotThrow(frame); assert.equal(listeners.size, 0);
  assert.doesNotThrow(() => captureTidyMotion(workspace, {}).play());
});

for (const failure of [false, true]) {
  test(`native ${failure ? "rollback is complete" : "placement returns"} before the animation frame`, () => withBrowser({ moveFailure: failure ? () => "throw-after" : undefined }, (browser) => {
    const original = browser.makeGroup("Original"), destination = browser.makeGroup("Destination");
    browser.makeTab("seed.test", destination);
    const member = browser.makeTab("moved.test", original);
    const fixture = makeWindow(), visual = fixture.row(30);
    const nativeWorkspace = window.gZenWorkspaces;
    Object.assign(window, fixture.win, { gBrowser, gZenWorkspaces: nativeWorkspace });
    gBrowser.tabContainer = fixture.win.gBrowser.tabContainer;
    member._tab.querySelector = () => visual.target;
    member._tab.getBoundingClientRect = () => rect(0, member._tab.group.getAttribute("label") === "Original" ? 30 : 90);
    const result = applyPass2({ assignedToExisting: [{ tabInfo: member, groupName: "Destination" }], newGroups: [] }, workspaceId, [], { persistRules: false });
    assert.equal(result.movedToExisting, failure ? 0 : 1);
    assert.equal(member._tab.group.getAttribute("label"), failure ? "Original" : "Destination");
    assert.equal(fixture.animations.length, 0, "sorting never waits for an effect");
    fixture.frame();
    assert.equal(fixture.animations.length, failure ? 0 : 1, "restored failed placement has no phantom movement");
    cancelTidyMotion(window);
  }));
}
