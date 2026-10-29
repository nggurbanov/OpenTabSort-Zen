#!/usr/bin/env node
// Native separator states, cancellation and emoji labels in a disposable profile.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createLabProfile, findDefaultSineProfile, removeLabProfile, scenarioPrefs, writeUserPrefs } from "./zen-e2e-profile.mjs";
import { startFixturePageServer, startProviderServer } from "./zen-e2e-servers.mjs";
import { createSemanticFixture, GOLD_FAMILIES } from "./zen-e2e-fixtures.mjs";
import { MarionetteClient, reserveTcpPort } from "./zen-e2e-marionette.mjs";
import { assertConnectedProfile, launchZen, stopZen, waitForZenReady, prepareTabs, waitForWorkspaceUrls } from "./zen-e2e-driver.mjs";
import { groupEmoji, stripGroupEmoji } from "../modules/group-emoji.mjs";

const output = process.env.SEPARATOR_QA_OUTPUT || "/tmp/opentabsort-separator-qa";
await mkdir(output, { recursive: true });
let lab, zen, client, pages, provider, gate, release;
const receipt = {};
let groupingRequests = 0;
const chrome = (source) => client.execute('const win = Services.wm.getMostRecentWindow("navigator:browser");\n' + source);
const wait = (expression) => client.executeAsync(`
  const done = arguments[arguments.length - 1], win = Services.wm.getMostRecentWindow("navigator:browser"), started = Date.now();
  const poll = () => { try { if (${expression}) return done(true); } catch {} if (Date.now() - started > 15000) return done(false); win.setTimeout(poll, 25); }; poll();
`);
const pause = () => client.executeAsync('const done = arguments[arguments.length - 1]; Services.wm.getMostRecentWindow("navigator:browser").setTimeout(() => done(true), 180);');
const screenshot = async (name) => process.env.SEPARATOR_NO_SCREENSHOTS ? undefined : writeFile(resolve(output, name + ".png"), Buffer.from(await client.command("WebDriver:TakeScreenshot", {}), "base64"));
const state = () => chrome(`
  const button = win.gZenWorkspaces.activeWorkspaceElement.querySelector("#tab-wand-button"), host = button.closest(".pinned-tabs-container-separator");
  const rect = host.getBoundingClientRect(), br = button.getBoundingClientRect();
  return { label: button.getAttribute("aria-label"), opacity: win.getComputedStyle(button).opacity, busy: button.hasAttribute("data-zao-busy"),
    stopIcon: win.getComputedStyle(button.querySelector(".zao-stop-icon")).display, sortIcon: win.getComputedStyle(button.querySelector(".zao-sort-icon")).display,
    animation: win.getComputedStyle(host.querySelector("toolbarseparator"), "::after").animationName,
    placement: win.document.querySelector(".zao-sort-progress")?.dataset.placement,
    background: win.getComputedStyle(host).backgroundColor,
    y: rect.y, height: rect.height, width: rect.width, button: {x:br.x,y:br.y,width:br.width,height:br.height},
    ancestors: [...(function*(){for(let n=host;n;n=n.parentElement)yield n;})()].slice(0,8).map(n=>({tag:n.localName,id:n.id,cls:n.className,height:n.getBoundingClientRect().height,overflow:win.getComputedStyle(n).overflow,position:win.getComputedStyle(n).position})),
    html: host.outerHTML, before: {content:win.getComputedStyle(host,"::before").content, width:win.getComputedStyle(host,"::before").width},
    topRows: win.document.querySelectorAll('.zao-operation[data-placement="sidebar"],.zao-operation[data-placement="overlay"]').length };
`);
const pointer = async (x, y) => { await client.command("WebDriver:PerformActions", { actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: [{ type: "pointerMove", duration: 0, origin: "viewport", x: Math.round(x), y: Math.round(y) }] }] }); await pause(); };
const clickSort = async () => {
  const idle = (await state()).button;
  await pointer(idle.x + 5, idle.y + 10);
  const rect = (await state()).button;
  await pointer(rect.x + rect.width/2, rect.y + rect.height/2);
  assert.equal(await chrome(`return win.document.elementFromPoint(${rect.x + rect.width/2}, ${rect.y + rect.height/2})?.closest("toolbarbutton")?.id;`), "tab-wand-button", "sort pointer must hit the visible sorting control");
  await client.command("WebDriver:PerformActions", {actions:[{type:"pointer",id:"mouse",parameters:{pointerType:"mouse"},actions:[{type:"pointerDown",button:0},{type:"pointerUp",button:0}]}]});
};
const labels = () => chrome('return [...win.document.querySelectorAll("tab-group")].filter(g=>g.isConnected && g.querySelector("tab")).map(g=>g.getAttribute("label"));');
try {
  pages = await startFixturePageServer();
  provider = await startProviderServer("fake", { beforeFakeResponse: async ({ response, content, lines }) => {
    if (gate) {
      const current = gate; gate = null; current();
      await new Promise((resolve) => release = resolve);
      if (response.destroyed) return true;
    }
    if (process.env.SEPARATOR_REVIEW_LARGE_GROUP && content.startsWith("AI WORKSPACE GROUPING")) {
      groupingRequests++;
      if (groupingRequests % 2 === 1) {
        const answer = { groups: [{ name: "Infrastructure", description: "Overly broad initial workspace group", tabs: lines.map(line => Number(line.index)) }], unresolved: [] };
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
        return true;
      }
    }
    return false;
  } });
  lab = await createLabProfile(resolve(import.meta.dirname, ".."), process.env.SINE_PROFILE || await findDefaultSineProfile());
  const marionettePort = await reserveTcpPort();
  await writeUserPrefs(lab.profileDir, [...scenarioPrefs({ scenario: "full-ai", providerPort: provider.port, marionettePort }), ["ui.systemUsesDarkTheme", 1]]);
  zen = launchZen({ options: { headed: true, zenBinary: process.env.ZEN_BINARY }, profileDir: lab.profileDir, marionettePort });
  client = await MarionetteClient.connect(marionettePort); await client.newSession(); await client.setScriptTimeout(25000); await client.setChromeContext();
  await assertConnectedProfile(client, lab.profileDir); await waitForZenReady(client);
  await prepareTabs(client, createSemanticFixture(120, pages.port)); await waitForWorkspaceUrls(client, 120);
  await chrome(`
    win.__separatorTabs = [...win.gBrowser.tabs];
    win.__separatorState = () => [...win.gBrowser.tabs].map(tab=>({ id:win.__separatorTabs.indexOf(tab), group:tab.closest("tab-group")?.getAttribute("label") || null }));
    win.__separatorOriginal = win.__separatorState();
    const tabs = [...win.gBrowser.tabs].filter(tab=>win.gBrowser.getBrowserForTab(tab)?.currentURI.spec.includes(".localhost"));
    for (const tab of tabs.slice(0,3)) win.gBrowser.pinTab(tab);
    win.gBrowser.selectedTab = tabs[4];
  `);
  await pause();
  await chrome('win.gZenWorkspaces.activeWorkspaceElement.querySelector(".pinned-tabs-container-separator").scrollIntoView({block:"nearest",behavior:"instant"});');
  await pause();
  await pointer(600, 300); receipt.idle = await state(); assert.equal(receipt.idle.button.width, 0, "hidden sorting button must leave no gap in the divider"); await screenshot("dark-idle");
  await pointer(receipt.idle.button.x + 10, receipt.idle.button.y + 10); assert.equal(await wait('win.getComputedStyle(win.gZenWorkspaces.activeWorkspaceElement.querySelector("#tab-wand-button")).opacity === "1"'), true); receipt.hover = await state(); await screenshot("dark-hover");
  const entered = new Promise((resolve) => gate = resolve); await clickSort();
  let timer; try { await Promise.race([entered,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error("Sort click did not start an HTTP request")),15000))]); } finally {clearTimeout(timer);}
  await pointer(600, 300); receipt.busy = await state(); await screenshot("dark-busy");
  assert.equal(receipt.busy.placement, "separator"); assert.equal(receipt.busy.label, "Stop sorting");
  assert.equal(receipt.busy.stopIcon, "flex"); assert.equal(receipt.busy.sortIcon, "none");
  assert.equal(receipt.busy.opacity, "1"); assert.equal(receipt.busy.animation, "zao-divider-work");
  assert.equal(receipt.busy.background, "rgba(0, 0, 0, 0)", "sorting must preserve the workspace background");
  assert.equal(receipt.busy.topRows, 0); assert.equal(receipt.busy.height, receipt.idle.height);
  await chrome('Services.prefs.setIntPref("ui.prefersReducedMotion", 1);');
  assert.equal(await wait('win.matchMedia("(prefers-reduced-motion: reduce)").matches'),true);
  assert.equal(await wait('win.getComputedStyle(win.gZenWorkspaces.activeWorkspaceElement.querySelector(".pinned-tabs-container-separator > toolbarseparator"), "::after").animationName === "none"'), true);
  await chrome('Services.prefs.setIntPref("ui.prefersReducedMotion", 0);');
  assert.equal(await wait('!win.matchMedia("(prefers-reduced-motion: reduce)").matches'),true);
  await clickSort(); assert.equal(await wait('win.document.querySelector(".zao-sort-progress")?.dataset.state !== "busy"'), true);
  receipt.stopped = await state(); release(); release = null;
  assert.equal(receipt.stopped.busy, false); assert.equal(receipt.stopped.label, "Organize tabs");
  console.log("native Stop command interrupts the held request and restores grouping icon");
  await clickSort(); assert.equal(await wait('!!win.document.querySelector(\'.zao-sort-progress button[data-action="undo"]:not([hidden])\')'), true);
  receipt.labels = await labels(); assert.ok(receipt.labels.length > 1);
  assert.ok(receipt.labels.every((label) => groupEmoji(label).length === 1));
  assert.equal(new Set(receipt.labels.map((label) => groupEmoji(label)[0])).size, receipt.labels.length);
  receipt.complete = await state();
  assert.ok(receipt.complete.y >= 0 && receipt.complete.y < 650, JSON.stringify(receipt.complete));
  await screenshot("dark-complete");
  const folderButtonState = () => chrome(`
    const button = win.gZenWorkspaces.activeWorkspaceElement.querySelector("#zao-toggle-folders"), rect = button.getBoundingClientRect();
    const groups = [...win.gZenWorkspaces.activeWorkspaceElement.querySelectorAll('tab-group:not([split-view-group]), zen-folder:not([split-view-group])')];
    return {disabled: button.hasAttribute("disabled"), hit: win.document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.closest("toolbarbutton")?.id, label: button.getAttribute("aria-label"), opacity: win.getComputedStyle(button).opacity, width: rect.width, x:rect.x, y:rect.y, height:rect.height, collapsed:groups.map(group=>group.hasAttribute("collapsed"))};
  `);
  const clickFolders = async () => {
    const sort = (await state()).button;
    await pointer(sort.x + 5, sort.y + 10);
    const rect = await folderButtonState();
    await pointer(rect.x + rect.width/2, rect.y + rect.height/2);
    await client.command("WebDriver:PerformActions", {actions:[{type:"pointer",id:"mouse",parameters:{pointerType:"mouse"},actions:[{type:"pointerDown",button:0},{type:"pointerUp",button:0}]}]});
  };
  const providerCalls = provider.calls.length;
  await clickFolders();
  receipt.folderFirst = await folderButtonState();
  assert.equal(await wait('win.gZenWorkspaces.activeWorkspaceElement.querySelector("#zao-toggle-folders").getAttribute("aria-label") === "Expand all folders"'), true, JSON.stringify(receipt.folderFirst));
  assert.ok((await folderButtonState()).collapsed.every(Boolean));
  await clickFolders();
  assert.ok((await folderButtonState()).collapsed.every(value => !value));
  await chrome('win.gZenWorkspaces.activeWorkspaceElement.querySelector("tab-group").collapsed = true;');
  assert.equal(await wait('win.gZenWorkspaces.activeWorkspaceElement.querySelector("#zao-toggle-folders").getAttribute("aria-label") === "Collapse all folders"'), true);
  await clickFolders(); assert.ok((await folderButtonState()).collapsed.every(Boolean));
  await clickFolders(); assert.ok((await folderButtonState()).collapsed.every(value => !value));
  await chrome('win.document.activeElement?.blur();');
  await pointer(600,300);
  assert.equal(await wait('win.getComputedStyle(win.gZenWorkspaces.activeWorkspaceElement.querySelector("#zao-toggle-folders")).width === "0px"'), true);
  assert.equal(provider.calls.length, providerCalls, "folding folders must not call AI");
  console.log("native folder button collapses and expands all groups, handles mixed state and leaves no idle gap");
  // Reproduce Zia's real folder-name skeleton CSS without loading its model or changing preferences.
  receipt.ziaHeader = await chrome(`
    const group = win.document.querySelector("tab-group[label]"), header = group.querySelector(".tab-group-label-container"), label = header.querySelector(".tab-group-label");
    const style = win.document.createElement("style");
    style.textContent = '.tab-group-label-container[zia-skeleton-on="true"] > *:not(.zia-skeleton-overlay) { opacity: 0 !important; }';
    win.document.documentElement.appendChild(style);
    const overlay = win.document.createElement("div"); overlay.className = "zia-skeleton-overlay";
    header.appendChild(overlay); header.setAttribute("zia-skeleton-on", "true");
    const saved = group.hasAttribute("collapsed"), states = [];
    try {
      for (const collapsed of [false, true]) {
        group.collapsed = collapsed;
        states.push({ collapsed, name: group.getAttribute("label"), opacity: win.getComputedStyle(label).opacity, overlay: win.getComputedStyle(overlay).display });
      }
    } finally {
      group.collapsed = saved; header.removeAttribute("zia-skeleton-on"); overlay.remove(); style.remove();
    }
    return states;
  `);
  for (const header of receipt.ziaHeader) {
    assert.ok(header.name.trim());
    assert.equal(header.opacity, "1", "a named group must stay readable during Zia icon inference, expanded or collapsed");
    assert.equal(header.overlay, "none", "the skeleton must not cover an existing name");
  }
  console.log("named group titles stay visible through Zia skeleton state, expanded and collapsed");
  const firstLabels = [...receipt.labels]; await clickSort();
  assert.equal(await wait('!!win.document.querySelector(\'.zao-sort-progress button[data-action="undo"]:not([hidden])\') && !win.document.querySelector("#tab-wand-button[data-zao-busy]")'), true);
  assert.deepEqual(await labels(), firstLabels);
  console.log("default-on unique emoji labels remain stable across repeated sorts");
  await chrome('Services.prefs.setBoolPref("extensions.zen-auto-organize.ai-group-emoji", false);');
  await clickSort(); assert.equal(await wait('!!win.document.querySelector(\'.zao-sort-progress button[data-action="undo"]:not([hidden])\') && !win.document.querySelector("#tab-wand-button[data-zao-busy]")'), true);
  receipt.withoutEmoji = await labels(); assert.ok(receipt.withoutEmoji.every((label) => groupEmoji(label).length === 0));
  assert.deepEqual(receipt.withoutEmoji, firstLabels.map(stripGroupEmoji));
  await chrome('win.document.querySelector(\'.zao-sort-progress button[data-action="undo"]\').click();');
  assert.deepEqual(await labels(), firstLabels);
  console.log("disabling emoji uses plain names and Undo restores decorated native groups");
  await chrome('Services.prefs.setIntPref("ui.systemUsesDarkTheme", 0); const arrows = win.gZenWorkspaces.activeWorkspaceElement.querySelector(".workspace-arrowscrollbox"); (arrows.scrollbox || arrows).scrollTop = 0; win.gBrowser.selectedTab = win.__separatorTabs.find(tab=>tab.pinned);'); await pause();
  receipt.light = await state(); await screenshot("light-idle");
  await pointer(receipt.light.button.x+10,receipt.light.button.y+10); await screenshot("light-hover");
  assert.equal(receipt.idle.opacity, "0"); assert.equal(receipt.hover.opacity, "1");
  await writeFile(resolve(output,"receipt.json"), JSON.stringify(receipt,null,2)+"\n");
  if (process.env.SEPARATOR_REVIEW_LARGE_GROUP) {
    assert.equal(groupingRequests, 6, "three sorts must each review the oversized initial group once");
    assert.equal(receipt.labels.length, GOLD_FAMILIES.length);
    receipt.groupingRequests = groupingRequests;
    console.log("native semantic refinement: three broad initial plans reviewed into specific task groups; Undo preserved");
  }
  console.log("separator native acceptance: PASS");
} finally {
  release?.(); client?.close(); if (zen) await stopZen(zen);
  await provider?.close(); await pages?.close(); if (lab) await removeLabProfile(lab.profileDir);
  await writeFile(resolve(output,"receipt.json"), JSON.stringify(receipt,null,2)+"\n");
}
