#!/usr/bin/env node
// Native operation controls and rollback acceptance in a disposable Sine profile.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { createLabProfile, findDefaultSineProfile, removeLabProfile, scenarioPrefs, writeUserPrefs } from "./zen-e2e-profile.mjs";
import { startFixturePageServer, startProviderServer } from "./zen-e2e-servers.mjs";
import { createSemanticFixture } from "./zen-e2e-fixtures.mjs";
import { MarionetteClient, reserveTcpPort } from "./zen-e2e-marionette.mjs";
import { assertConnectedProfile, launchZen, stopZen, waitForZenReady, prepareTabs, waitForWorkspaceUrls } from "./zen-e2e-driver.mjs";

let lab, zen, client, pages, provider;
try {
  pages = await startFixturePageServer(); provider = await startProviderServer("fake");
  lab = await createLabProfile(resolve(import.meta.dirname, ".."), process.env.SINE_PROFILE || await findDefaultSineProfile());
  const marionettePort = await reserveTcpPort();
  await writeUserPrefs(lab.profileDir, scenarioPrefs({ scenario: "full-ai", providerPort: provider.port, marionettePort }));
  zen = launchZen({ options: { headed: false, zenBinary: process.env.ZEN_BINARY || "/Applications/Zen.app/Contents/MacOS/zen" }, profileDir: lab.profileDir, marionettePort });
  client = await MarionetteClient.connect(marionettePort);
  await client.newSession(); await client.setScriptTimeout(); await client.setChromeContext();
  await assertConnectedProfile(client, lab.profileDir); await waitForZenReady(client);
  await prepareTabs(client, createSemanticFixture(120, pages.port)); await waitForWorkspaceUrls(client, 120);
  await client.execute(`
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    win.__qaTabs = [...win.gBrowser.tabs];
    win.__qaState = () => [...win.gBrowser.tabs].map((tab, position) => ({
      id: win.__qaTabs.indexOf(tab), url: win.gBrowser.getBrowserForTab(tab)?.currentURI.spec,
      group: tab.closest("tab-group")?.getAttribute("label") || null, position,
    }));
    const fixtureTabs = win.__qaTabs.filter((tab) => win.gBrowser.getBrowserForTab(tab)?.currentURI.spec.includes(".localhost"));
    const group = win.gBrowser.addTabGroup(fixtureTabs.slice(0, 12), { label: "My manual group", color: "pink",
      insertBefore: win.gZenWorkspaces.activeWorkspaceElement.tabsContainer.firstChild });
    group.collapsed = true;
    win.__qaOriginal = win.__qaState();
    const nativeFetch = win.fetch.bind(win);
    win.fetch = (url, init) => {
      if (String(url).includes("127.0.0.1:${provider.port}")) {
        win.__qaCalls++;
        if (win.__qaMode === "stop" && win.__qaCalls === 1) [...win.document.querySelectorAll(".zao-sort-progress button")].find((node) => node.textContent === "Stop").click();
        if (win.__qaMode === "settings" && win.__qaCalls === 1) Services.prefs.setStringPref("extensions.zen-auto-organize.skip-domains-json", '["work.localhost"]');
      }
      return nativeFetch(url, init);
    };
  `);
  const run = (mode) => client.executeAsync(`
    const done = arguments[arguments.length - 1];
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    win.__qaMode = ${JSON.stringify(mode)}; win.__qaCalls = 0;
    win.OpenTabSortZen.handleOrganizeClick().then(() => done({ state: win.__qaState(), calls: win.__qaCalls,
      status: win.document.querySelector(".zao-sort-progress [role=status]")?.title,
      canUndo: [...win.document.querySelectorAll(".zao-sort-progress button")].some((node) => node.dataset.action === "undo" && !node.hidden),
    })).catch((error) => done({ error: String(error) }));
  `);
  const original = await client.execute('return Services.wm.getMostRecentWindow("navigator:browser").__qaOriginal;');
  for (const mode of ["stop", "settings"]) {
    const result = await run(mode);
    assert.equal(result.error, undefined); assert.equal(result.calls, 1);
    assert.deepEqual(result.state, original); assert.match(result.status, mode === "stop" ? /stopped/ : /changed/);
    assert.equal(result.canUndo, false); console.log(`${mode}: in-flight request stopped, layout unchanged`);
    await client.execute('Services.prefs.setStringPref("extensions.zen-auto-organize.skip-domains-json", "[]");');
  }
  const sorted = await run("normal"); assert.equal(sorted.error, undefined); assert.equal(sorted.canUndo, true);
  assert.equal(new Set(sorted.state.map((tab) => tab.id)).size, original.length);
  if (process.env.OPERATIONS_QA_SCREENSHOT) {
    const geometry = await client.executeAsync(`
      const done = arguments[arguments.length - 1], win = Services.wm.getMostRecentWindow("navigator:browser");
      Promise.allSettled(win.document.getAnimations().filter((effect) => effect.effect?.target?.classList?.contains("tab-stack"))
        .map((effect) => effect.finished)).then(() => {
        const row = win.document.querySelector(".zao-sort-progress"), status = row.querySelector("[role=status]"), rect = row.getBoundingClientRect();
        done({ height: rect.height, width: rect.width, placement: row.dataset.placement, label: status.textContent,
          overflow: row.scrollWidth > row.clientWidth, statusOverflow: status.scrollWidth > status.clientWidth });
      });
    `);
    assert.equal(geometry.placement, "sidebar"); assert.equal(geometry.height, 32);
    assert.equal(geometry.overflow, false); assert.equal(geometry.statusOverflow, false);
    await writeFile(process.env.OPERATIONS_QA_SCREENSHOT, Buffer.from(await client.command("WebDriver:TakeScreenshot", {}), "base64"));
    await writeFile(process.env.OPERATIONS_QA_SCREENSHOT + ".json", JSON.stringify(geometry, null, 2));
  }
  const noOp = await run("normal");
  assert.deepEqual(noOp.state, sorted.state); assert.equal(noOp.canUndo, true);
  assert.match(noOp.status, /already organized/);
  console.log("second identical sort: stable groups and original Undo retained");
  const stoppedFollowup = await run("stop");
  assert.deepEqual(stoppedFollowup.state, sorted.state); assert.equal(stoppedFollowup.canUndo, true);
  console.log("stopped follow-up: previous valid Undo remains available");
  const undone = await client.execute(`
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    [...win.document.querySelectorAll(".zao-sort-progress button")].find((node) => node.dataset.action === "undo").click();
    return { state: win.__qaState(), collapsed: win.document.querySelector('tab-group[label="My manual group"]')?.collapsed };
  `);
  assert.deepEqual(undone.state, original); assert.equal(undone.collapsed, true);
  console.log("remote Undo: original tab identity, membership, order and collapse restored");
  // A preview closed during reassignment must abort the same operation.
  await client.execute('Services.prefs.setBoolPref("extensions.zen-auto-organize.ai-review-before-apply", true);');
  const preview = await client.executeAsync(`
    const done = arguments[arguments.length - 1]; const win = Services.wm.getMostRecentWindow("navigator:browser");
    win.__qaMode = "normal"; win.__qaCalls = 0;
    let summary, focusPreserved;
    const observer = new win.MutationObserver(() => {
      const modal = win.document.querySelector(".zao-preview-dialog[open]");
      if (!modal) return; observer.disconnect();
      const card = modal.querySelector(".zao-preview-group"); card.focus(); card.click();
      focusPreserved = win.document.activeElement?.dataset.zaoFocusKey === card.dataset.zaoFocusKey;
      summary = modal.querySelector(".zao-preview-summary")?.textContent;
      [...modal.querySelectorAll("button")].find((node) => node.textContent === "Cancel").click();
    });
    observer.observe(win.document.documentElement, { childList: true, subtree: true });
    win.OpenTabSortZen.handleOrganizeClick().then(() => { observer.disconnect(); done({ state: win.__qaState(), summary, focusPreserved }); })
      .catch((error) => { observer.disconnect(); done({ error: String(error) }); });
  `);
  assert.equal(preview.error, undefined); assert.deepEqual(preview.state, original);
  assert.equal(preview.focusPreserved, true); assert.match(preview.summary, /12 tab\(s\) unchanged/);
  console.log("preview: keyboard focus and exact unchanged count preserved; Cancel makes no moves");
  console.log("overhaul native acceptance: PASS");
} finally {
  client?.close(); if (zen) await stopZen(zen);
  await provider?.close(); await pages?.close(); if (lab) await removeLabProfile(lab.profileDir);
}
