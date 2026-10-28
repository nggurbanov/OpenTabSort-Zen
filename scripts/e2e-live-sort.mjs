#!/usr/bin/env node
// Keep browsing during a held AI request in a disposable, real Zen + Sine profile.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { createLabProfile, findDefaultSineProfile, removeLabProfile, scenarioPrefs, writeUserPrefs } from "./zen-e2e-profile.mjs";
import { startFixturePageServer, startProviderServer } from "./zen-e2e-servers.mjs";
import { createSemanticFixture } from "./zen-e2e-fixtures.mjs";
import { MarionetteClient, reserveTcpPort } from "./zen-e2e-marionette.mjs";
import { assertConnectedProfile, launchZen, stopZen, waitForZenReady, prepareTabs, waitForWorkspaceUrls } from "./zen-e2e-driver.mjs";

const baseline = process.argv.includes("--baseline");
const count = Number(process.env.LIVE_SORT_TABS || 120);
const results = { baseline, tabCount: count, scenarios: [] };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const bounded = async (promise, label, ms = 15000) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })]); }
  finally { clearTimeout(timer); }
};
let lab, zen, client, pages, provider, gate;
const gates = new Set(), responses = new Set();
const chrome = (source) => client.execute('const win = Services.wm.getMostRecentWindow("navigator:browser");\n' + source);
const state = () => chrome("return win.__liveState();");
const finish = () => client.executeAsync(`
  const done = arguments[arguments.length - 1], win = Services.wm.getMostRecentWindow("navigator:browser");
  const started = Date.now();
  const poll = () => {
    if (win.__liveResult) done(win.__liveResult);
    else if (Date.now() - started > 12000) done({ error: "Sort did not finish in 12 seconds" });
    else win.setTimeout(poll, 25);
  }; poll();
`);
const startHeld = async () => {
  gate = { entered: deferred(), release: deferred(), closed: deferred(), claimed: false, disconnected: false };
  const current = gate; gates.add(current);
  await chrome(`
    win.__liveResult = null;
    win.OpenTabSortZen.handleOrganizeClick().then(() => {
      const row = win.document.querySelector(".zao-sort-progress");
      win.__liveResult = { state: win.__liveState(), status: row?.querySelector("[role=status]")?.title,
        label: row?.querySelector("[role=status]")?.textContent,
        actions: [...(row?.querySelectorAll("button") || [])].filter((node) => !node.hidden).map((node) => node.dataset.action) };
    }).catch((error) => { win.__liveResult = { error: error?.stack || String(error) }; });
  `);
  await bounded(current.entered.promise, "No AI request arrived");
  return current;
};
const undo = async () => chrome(`
  const button = win.document.querySelector('.zao-sort-progress button[data-action="undo"]');
  if (!button || button.hidden) throw new Error("Undo was not offered");
  button.click(); return win.__liveState();
`);
const ambient = async () => {
  await client.command("Marionette:SetContext", { value: "content" });
  const handles = await client.command("WebDriver:GetWindowHandles");
  await client.command("WebDriver:SwitchToWindow", { handle: handles[15] });
  try {
    return await client.execute(`
      document.title = "A page updated its title during AI sorting";
      const icon = document.createElement("link"); icon.rel = "icon";
      icon.href = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>');
      document.head.appendChild(icon);
      return { title: document.title, href: location.href };
    `);
  } finally { await client.setChromeContext(); }
};
const reset = async () => {
  // Loaded tabs may close asynchronously through permitUnload. Clear the owned
  // disposable fixture explicitly before the legacy prepareTabs loop runs.
  await chrome(`
    const all = [...win.gBrowser.tabs];
    const keep = all.find((tab) => tab.hasAttribute("zen-empty-tab")) ||
      all.find((tab) => win.gBrowser.getBrowserForTab(tab)?.currentURI.spec === "about:blank") || all[0];
    if (keep?.pinned) win.gBrowser.unpinTab(keep);
    win.gBrowser.selectedTab = keep;
    for (const tab of all) if (tab !== keep) win.gBrowser.removeTab(tab, { skipPermitUnload: true, animate: false });
  `);
  const cleared = await client.executeAsync(`
    const done = arguments[arguments.length - 1], win = Services.wm.getMostRecentWindow("navigator:browser"), started = Date.now();
    const poll = () => {
      const remaining = [...win.gBrowser.tabs].filter((tab) => !tab.closing);
      if (win.gBrowser.tabs.length <= 1) done({ count: win.gBrowser.tabs.length });
      else if (Date.now() - started > 5000) done({ error: "Fixture cleanup did not finish", count: win.gBrowser.tabs.length, live: remaining.length });
      else win.setTimeout(poll, 25);
    }; poll();
  `);
  assert.equal(cleared.error, undefined, JSON.stringify(cleared));
  await prepareTabs(client, createSemanticFixture(count, pages.port));
  await waitForWorkspaceUrls(client, count);
  await chrome(`
    win.__liveTabs = [...win.gBrowser.tabs].filter((tab) => win.gBrowser.getBrowserForTab(tab)?.currentURI.spec.includes(".localhost"));
    win.__liveIds = new Map(win.__liveTabs.map((tab, index) => [tab, index]));
    win.__liveGroups = new Map();
    win.__liveState = () => [...win.gBrowser.tabs].filter((tab) => win.__liveIds.has(tab)).map((tab, position) => {
      const group = tab.closest("tab-group");
      if (group && !win.__liveGroups.has(group)) win.__liveGroups.set(group, win.__liveGroups.size);
      return { id: win.__liveIds.get(tab), url: win.gBrowser.getBrowserForTab(tab)?.currentURI.spec,
        group: group?.getAttribute("label") || null, groupId: group ? win.__liveGroups.get(group) : null,
        collapsed: group ? group.hasAttribute("collapsed") : null, pinned: tab.pinned,
        position, title: tab.getAttribute("label") || "" };
    });
    const group = win.gBrowser.addTabGroup(win.__liveTabs.slice(0, 12), {
      label: "My original manual group", color: "pink",
      insertBefore: win.gZenWorkspaces.activeWorkspaceElement.tabsContainer.firstChild });
    group.collapsed = true;
    win.gZenWorkspaces?.updateTabsContainers?.();
  `);
};


const retryFinished = async () => client.executeAsync(`
  const done = arguments[arguments.length - 1], win = Services.wm.getMostRecentWindow("navigator:browser");
  const old = win.document.querySelector(".zao-sort-progress"), started = Date.now();
  const button = old?.querySelector('button[data-action="retry"]');
  if (!button || button.hidden) { done({ error: "Retry was not offered" }); return; }
  button.click();
  const poll = () => {
    const row = win.document.querySelector(".zao-sort-progress");
    if (row && row !== old && row.getAttribute("data-state") !== "busy") done({
      state: win.__liveState(), status: row.querySelector("[role=status]")?.title,
      undo: [...row.querySelectorAll("button")].some((node) => node.dataset.action === "undo" && !node.hidden) });
    else if (Date.now() - started > 12000) done({ error: "Retry did not finish" });
    else win.setTimeout(poll, 25);
  }; poll();
`);

const captureNarrowRetry = async ({ label = "New setup", suffix = "" } = {}) => {
  const geometry = await client.execute(`
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    const row = win.document.querySelector(".zao-sort-progress");
    row.style.inlineSize = "158px"; row.style.maxInlineSize = "158px";
      const rect = row.getBoundingClientRect(), status = row.querySelector("[role=status]");
      return { width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom,
        viewportHeight: win.innerHeight, label: status.textContent, detail: status.title,
        rowOverflow: row.scrollWidth > row.clientWidth, labelOverflow: status.scrollWidth > status.clientWidth,
        labelWidth: status.clientWidth, labelContentWidth: status.scrollWidth,
        actions: [...row.querySelectorAll("button")].filter((node) => !node.hidden).map((node) => {
          const bounds = node.getBoundingClientRect();
          return { action: node.dataset.action, left: bounds.left - rect.left, right: bounds.right - rect.left };
        }) };
  `);
  const base = process.env.LIVE_SORT_SCREENSHOT || "/tmp/opentabsort-live-sort-retry.png";
  const path = suffix ? base.replace(/\.png$/, "-" + suffix + ".png") : base;
  await writeFile(path, Buffer.from(await client.command("WebDriver:TakeScreenshot", {}), "base64"));
  await writeFile(path + ".json", JSON.stringify(geometry, null, 2) + "\n");
  assert.equal(geometry.width, 158); assert.equal(geometry.height, 32);
  assert.equal(geometry.label, label);
  assert.equal(geometry.rowOverflow, false); assert.equal(geometry.labelOverflow, false);
  assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.viewportHeight);
  assert.deepEqual(geometry.actions.map((action) => action.action), ["retry", "dismiss"]);
  assert.ok(geometry.actions.every((action) => action.left >= 0 && action.right <= geometry.width));
  return geometry;
};

const layout = (tabs) => tabs.map(({ title, groupId, ...entry }) => entry);

try {
  pages = await startFixturePageServer();
  provider = await startProviderServer("fake", { beforeFakeResponse: async ({ response }) => {
    const current = gate;
    if (!current || current.claimed) return false;
    current.claimed = true; responses.add(response);
    response.once("close", () => { responses.delete(response); current.disconnected = !response.writableFinished; current.closed.resolve(); });
    current.entered.resolve();
    await current.release.promise;
    if (response.destroyed) return true;
    return false;
  } });
  lab = await createLabProfile(resolve(process.env.QA_SOURCE_ROOT || resolve(import.meta.dirname, "..")), process.env.SINE_PROFILE || await findDefaultSineProfile());
  const marionettePort = await reserveTcpPort();
  await writeUserPrefs(lab.profileDir, scenarioPrefs({ scenario: "full-ai", providerPort: provider.port, marionettePort }));
  zen = launchZen({ options: { headed: false, zenBinary: process.env.ZEN_BINARY || "/Applications/Zen.app/Contents/MacOS/zen" }, profileDir: lab.profileDir, marionettePort });
  client = await MarionetteClient.connect(marionettePort);
  await client.newSession(); await client.setScriptTimeout(30000); await client.setChromeContext();
  await assertConnectedProfile(client, lab.profileDir); await waitForZenReady(client);
  await reset();

  // A real content document updates its title and favicon while HTTP is held.
  const ambientGate = await startHeld();
  const ambientChange = await ambient();
  const ambientBefore = await state();
  if (baseline) {
    const interrupted = await finish();
    assert.equal(interrupted.error, undefined);
    assert.match(interrupted.status, /Tabs or settings changed/);
    assert.deepEqual(layout(interrupted.state), layout(ambientBefore));
    assert.equal(interrupted.actions.includes("undo"), false);
    results.scenarios.push({ name: "baseline-title-update", status: interrupted.status, content: ambientChange, beforeRelease: true, httpAborted: true });
    await bounded(ambientGate.closed.promise, "Cancelled baseline HTTP was left running");
    assert.equal(ambientGate.disconnected, true);
    ambientGate.release.resolve();
    console.log("baseline: ordinary page title/favicon activity cancels a held request and shows 'Tabs or settings changed'");
  } else {
    assert.equal(await chrome("return Boolean(win.__liveResult);"), false, "Ambient page activity must not cancel sorting");
    ambientGate.release.resolve();
    const sorted = await finish();
    assert.equal(sorted.error, undefined);
    assert.equal(sorted.actions.includes("undo"), true);
    assert.equal(sorted.state.length, count);
    assert.equal(new Set(sorted.state.map((tab) => tab.id)).size, count);
    assert.ok(sorted.state.filter((tab) => tab.group?.endsWith(" AI")).length > count / 2);

    const postSortTitle = "The same page updates its title after sorting";
    await client.command("Marionette:SetContext", { value: "content" });
    try {
      const updated = await client.execute("document.title = " + JSON.stringify(postSortTitle) + "; return { title: document.title, href: location.href };");
      assert.equal(updated.href, ambientChange.href);
    } finally { await client.setChromeContext(); }
    const titleSettled = await client.executeAsync(`
      const done = arguments[arguments.length - 1], win = Services.wm.getMostRecentWindow("navigator:browser"), started = Date.now();
      const poll = () => {
        const tab = win.__liveTabs.find((tab) => win.gBrowser.getBrowserForTab(tab)?.currentURI.spec === ${JSON.stringify(ambientChange.href)});
        if (tab?.getAttribute("label") === ${JSON.stringify(postSortTitle)}) done(true);
        else if (Date.now() - started > 5000) done(false); else win.setTimeout(poll, 25);
      }; poll();
    `);
    assert.equal(titleSettled, true);

    const restored = await undo();
    assert.deepEqual(layout(restored), layout(ambientBefore));
    assert.equal(restored.find((tab) => tab.url === ambientChange.href)?.title, postSortTitle);
    results.scenarios.push({ name: "ambient-title-favicon", status: sorted.status, identities: sorted.state.length, undo: true, postSortTitleUpdate: true });
    console.log("ambient title/favicon/load: sort completes and Undo restores original layout");

    await reset();
    const activityGate = await startHeld();
    await chrome(`
      const principal = Services.scriptSecurityManager.getSystemPrincipal();
      win.gBrowser.removeTab(win.__liveTabs[20], { skipPermitUnload: true, animate: false });
      const added = win.gBrowser.addTab("http://new-activity.localhost:${pages.port}/new-user-tab", {
        inBackground: true, skipAnimation: true, triggeringPrincipal: principal });
      added.setAttribute("zen-workspace-id", win.gZenWorkspaces.activeWorkspace);
      win.__liveIds.set(added, ${count});
      win.__liveAdded = added;
      win.gBrowser.getBrowserForTab(win.__liveTabs[21]).loadURI(
        Services.io.newURI("http://navigation.localhost:${pages.port}/changed-while-sorting"), { triggeringPrincipal: principal });
      win.gBrowser.pinTab(win.__liveTabs[22]);
      const manual = win.gBrowser.addTabGroup([win.__liveTabs[23], win.__liveTabs[24]], {
        label: "User grouped while waiting", color: "green",
        insertBefore: win.gZenWorkspaces.activeWorkspaceElement.tabsContainer.firstChild });
      manual.collapsed = true;
      win.gBrowser.selectedTab = win.__liveTabs[25];
      win.gZenWorkspaces?.updateTabsContainers?.();
    `);
    await client.executeAsync(`
      const done = arguments[arguments.length - 1], win = Services.wm.getMostRecentWindow("navigator:browser"), started = Date.now();
      const poll = () => {
        const url = win.gBrowser.getBrowserForTab(win.__liveTabs[21])?.currentURI.spec || "";
        if (url.includes("changed-while-sorting")) done(true);
        else if (Date.now() - started > 5000) done(false); else win.setTimeout(poll, 25);
      }; poll();
    `).then((ready) => assert.equal(ready, true));
    assert.equal(await chrome("return Boolean(win.__liveResult);"), false, "New tabs, closes, navigation, pinning and manual groups must reconcile");
    const activityBefore = await state();
    const selectedBefore = await chrome("return win.__liveIds.get(win.gBrowser.selectedTab);");
    activityGate.release.resolve();
    const sortedActivity = await finish();
    assert.equal(sortedActivity.error, undefined);
    assert.equal(sortedActivity.actions.includes("undo"), true);
    assert.deepEqual(new Set(sortedActivity.state.map((tab) => tab.id)), new Set(activityBefore.map((tab) => tab.id)));
    assert.equal(sortedActivity.state.some((tab) => tab.id === 20), false, "Closed tab must never be recreated");
    for (const id of [count, 21, 22, 23, 24]) {
      const before = activityBefore.find((tab) => tab.id === id), after = sortedActivity.state.find((tab) => tab.id === id);
      for (const key of ["url", "group", "groupId", "collapsed", "pinned"]) assert.equal(after[key], before[key], "Intervening user edit changed: tab " + id + " " + key);
    }
    assert.ok(sortedActivity.state.filter((tab) => tab.group?.endsWith(" AI")).length > count / 2);
    assert.equal(await chrome("return win.__liveIds.get(win.gBrowser.selectedTab);"), selectedBefore);
    const restoredActivity = await undo();
    assert.deepEqual(layout(restoredActivity), layout(activityBefore), "Undo must restore the pre-apply layout, preserving activity during the AI request");
    results.scenarios.push({ name: "open-close-navigate-pin-manual-group", status: sortedActivity.status, identities: sortedActivity.state.length, undo: true, protectedIds: [count, 21, 22, 23, 24] });
    console.log("new/closed/navigated/pinned/manually grouped tabs: user activity survives sorting and Undo");

    await reset();
    for (const mode of ["settings", "consent", "stop"]) {
      console.log(mode + ": checking held HTTP cancellation");
      const held = await startHeld(), before = await state();
      await chrome(mode === "settings"
        ? 'Services.prefs.setStringPref("extensions.zen-auto-organize.ai-custom-model", "changed-model");'
        : mode === "consent"
          ? 'Services.prefs.setBoolPref("extensions.zen-auto-organize.ai-provider-consent", false);'
          : 'win.document.querySelector(\'.zao-sort-progress button[data-action="stop"]\').click();');
      const stopped = await finish();
      assert.equal(stopped.error, undefined);
      assert.deepEqual(layout(stopped.state), layout(before));
      assert.equal(stopped.actions.includes("undo"), false);
      assert.match(stopped.status, mode === "stop" ? /stopped/i : mode === "settings" ? /settings|setup|model|connection/i : /consent|permission|sharing/i);
      if (mode === "settings") {
        assert.equal(stopped.actions.includes("retry"), true, "Config cancellation should offer Retry");
        results.retryGeometry = await captureNarrowRetry();
      }
      if (mode === "consent") {
        assert.equal(stopped.label, "Sharing off");
        assert.equal(stopped.actions.includes("setup"), true, "Revoked sharing must offer Setup");
        assert.equal(stopped.actions.includes("retry"), false);
      }
      await bounded(held.closed.promise, "Cancelled HTTP was left running");
      assert.equal(held.disconnected, true);
      held.release.resolve();
      await chrome('Services.prefs.setStringPref("extensions.zen-auto-organize.ai-custom-model", "opentabsort-e2e"); Services.prefs.setBoolPref("extensions.zen-auto-organize.ai-provider-consent", true);');
      if (mode === "settings") {
        const retried = await retryFinished();
        assert.equal(retried.error, undefined); assert.equal(retried.undo, true);
        assert.equal(retried.state.length, count);
        assert.ok(retried.state.filter((tab) => tab.group?.endsWith(" AI")).length > count / 2);
        assert.deepEqual(layout(await undo()), layout(before));
      }
      results.scenarios.push({ name: mode, status: stopped.status, beforeRelease: true, httpAborted: true, actions: stopped.actions });
      console.log(mode + ": held request aborted promptly, no layout change");
    }


    const workspaces = await client.executeAsync(`
      const done = arguments[arguments.length - 1], win = Services.wm.getMostRecentWindow("navigator:browser");
      win.__liveOriginalSpace = win.gZenWorkspaces.activeWorkspace;
      win.gZenWorkspaces.createAndSaveWorkspace("Live sorting other workspace").then((space) => {
        win.__liveOtherSpace = space.uuid;
        return win.gZenWorkspaces.changeWorkspaceWithID(win.__liveOriginalSpace);
      }).then(() => done({ original: win.__liveOriginalSpace, other: win.__liveOtherSpace }))
        .catch((error) => done({ error: String(error) }));
    `);
    assert.equal(workspaces.error, undefined);
    assert.notEqual(workspaces.original, workspaces.other);
    const workspaceGate = await startHeld(), workspaceBefore = await state();
    await client.executeAsync(`
      const done = arguments[arguments.length - 1], win = Services.wm.getMostRecentWindow("navigator:browser");
      win.gZenWorkspaces.changeWorkspaceWithID(win.__liveOtherSpace).then(() => done(true))
        .catch((error) => done({ error: String(error) }));
    `).then((changed) => assert.equal(changed, true));
    const workspaceStopped = await finish();
    assert.equal(workspaceStopped.error, undefined);
    assert.equal(workspaceStopped.label, "New space");
    results.workspaceGeometry = await captureNarrowRetry({ label: "New space", suffix: "workspace" });
    assert.equal(workspaceStopped.actions.includes("retry"), true);
    assert.equal(workspaceStopped.actions.includes("undo"), false);
    await bounded(workspaceGate.closed.promise, "Workspace change left HTTP running");
    assert.equal(workspaceGate.disconnected, true);
    workspaceGate.release.resolve();
    await client.executeAsync(`
      const done = arguments[arguments.length - 1], win = Services.wm.getMostRecentWindow("navigator:browser");
      win.gZenWorkspaces.changeWorkspaceWithID(win.__liveOriginalSpace).then(() => done(true))
        .catch((error) => done({ error: String(error) }));
    `).then((changed) => assert.equal(changed, true));
    assert.deepEqual(layout(await state()), layout(workspaceBefore));
    results.scenarios.push({ name: "workspace", status: workspaceStopped.status,
      actions: workspaceStopped.actions, beforeRelease: true, httpAborted: true });
    console.log("workspace switch: held request aborted, exact feedback and Retry; original workspace unchanged");

  }
  results.providerCalls = provider.calls.length;
  if (process.env.LIVE_SORT_ARTIFACT) await writeFile(process.env.LIVE_SORT_ARTIFACT, JSON.stringify(results, null, 2) + "\n");
  console.log("live browsing native acceptance: PASS");
} catch (error) { console.error(error); throw error; } finally {
  for (const current of gates) current.release.resolve();
  for (const response of responses) response.destroy();
  client?.close(); if (zen) await stopZen(zen);
  await provider?.close(); await pages?.close(); if (lab) await removeLabProfile(lab.profileDir);
}
