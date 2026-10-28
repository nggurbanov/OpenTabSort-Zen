#!/usr/bin/env node
// Native output-limit recovery acceptance in a disposable 300-tab Sine profile.
// Uses synthetic pages and a local fake provider; never sends real browsing data.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { createLabProfile, findDefaultSineProfile, removeLabProfile, scenarioPrefs, writeUserPrefs } from "./zen-e2e-profile.mjs";
import { startFixturePageServer, startProviderServer } from "./zen-e2e-servers.mjs";
import { GOLD_FAMILIES, createSemanticFixture } from "./zen-e2e-fixtures.mjs";
import { MarionetteClient, reserveTcpPort } from "./zen-e2e-marionette.mjs";
import { assertConnectedProfile, launchZen, stopZen, waitForZenReady, prepareTabs, waitForWorkspaceUrls } from "./zen-e2e-driver.mjs";

const deferred = () => {
  let resolvePromise;
  return { promise: new Promise((resolve) => { resolvePromise = resolve; }), resolve: (value) => resolvePromise(value) };
};
const within = async (promise, label, timeoutMs = 15000) => {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(label)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
};
const phaseOf = (content) => content.startsWith("AI WORKSPACE GROUPING") ? "grouping"
  : content.startsWith("AI WORKSPACE CLASSIFICATION") ? "classification" : "taxonomy";
const jsonResponse = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};
const requests = [];
const heldResponses = new Set();
let lab, zen, client, pages, provider;
let mode = "recover", classificationCount = 0, waiting, aborted;
const results = {};
try {
  pages = await startFixturePageServer();
  provider = await startProviderServer("fake", { beforeFakeResponse: async ({ body, content, lines, response }) => {
    const phase = phaseOf(content);
    const rows = phase === "classification" ? JSON.parse(content.split("Tabs JSON:\n")[1]) : [];
    requests.push({ mode, phase, tabs: lines.length, ids: rows.map((row) => row.id),
      localIndices: rows.map((row) => row.index), maxTokens: body.max_tokens });
    if (phase === "grouping") {
      jsonResponse(response, 200, { choices: [{ finish_reason: "length", message: { content: null } }] });
      return true;
    }
    if (phase !== "classification") return false;
    classificationCount++;
    if (mode === "terminal" && classificationCount === 2) {
      jsonResponse(response, 401, { error: { code: 401, message: "Synthetic authorization failure" } });
      return true;
    }
    if (mode === "stop") {
      heldResponses.add(response);
      const closed = deferred();
      response.once("close", () => { heldResponses.delete(response); aborted.resolve(); closed.resolve(true); });
      waiting.resolve();
      return closed.promise;
    }
    return false;
  } });
  lab = await createLabProfile(resolve(import.meta.dirname, ".."), process.env.SINE_PROFILE || await findDefaultSineProfile());
  const marionettePort = await reserveTcpPort();
  await writeUserPrefs(lab.profileDir, scenarioPrefs({ scenario: "full-ai", providerPort: provider.port, marionettePort }));
  zen = launchZen({ options: { headed: false, zenBinary: process.env.ZEN_BINARY || "/Applications/Zen.app/Contents/MacOS/zen" },
    profileDir: lab.profileDir, marionettePort });
  client = await MarionetteClient.connect(marionettePort);
  await client.newSession(); await client.setScriptTimeout(); await client.setChromeContext();
  await assertConnectedProfile(client, lab.profileDir); await waitForZenReady(client);
  const fixture = createSemanticFixture(300, pages.port);
  await prepareTabs(client, fixture); await waitForWorkspaceUrls(client, fixture.tabs.length);
  await client.execute(`
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    win.__qaTabs = [...win.gBrowser.tabs];
    const fixtureTabs = win.__qaTabs.filter((tab) => win.gBrowser.getBrowserForTab(tab)?.currentURI.spec.includes(".localhost"));
    const group = win.gBrowser.addTabGroup(fixtureTabs.slice(0, 12), { label: "My manual group", color: "pink",
      insertBefore: win.gZenWorkspaces.activeWorkspaceElement.tabsContainer.firstChild });
    group.collapsed = true;
    win.__qaGroup = group;
    win.__qaSelected = win.gBrowser.selectedTab;
    win.__qaState = () => [...win.gBrowser.tabs].map((tab, position) => ({
      id: win.__qaTabs.indexOf(tab), url: win.gBrowser.getBrowserForTab(tab)?.currentURI.spec,
      group: tab.closest("tab-group")?.getAttribute("label") || null, position,
    }));
    win.__qaResult = () => ({
      state: win.__qaState(),
      selectedPreserved: win.gBrowser.selectedTab === win.__qaSelected,
      status: win.document.querySelector(".zao-sort-progress [role=status]")?.title,
      canUndo: [...win.document.querySelectorAll(".zao-sort-progress button")].some((node) => node.dataset.action === "undo" && !node.hidden),
      manualGroupPreserved: win.document.querySelector('tab-group[label="My manual group"]') === win.__qaGroup,
      manualCollapsed: win.document.querySelector('tab-group[label="My manual group"]')?.collapsed,
      manualColor: win.document.querySelector('tab-group[label="My manual group"]')?.color,
    });
    win.__qaOriginal = win.__qaState();
  `);
  const original = await client.execute('return Services.wm.getMostRecentWindow("navigator:browser").__qaOriginal;');
  const run = () => client.executeAsync(`
    const done = arguments[arguments.length - 1], win = Services.wm.getMostRecentWindow("navigator:browser");
    win.OpenTabSortZen.handleOrganizeClick().then(() => done(win.__qaResult())).catch((error) => done({ error: String(error) }));
  `);

  const sorted = await run();
  assert.equal(sorted.error, undefined); assert.equal(sorted.canUndo, true); assert.equal(sorted.selectedPreserved, true);
  assert.equal(new Set(sorted.state.map((tab) => tab.id)).size, original.length);
  assert.deepEqual([...sorted.state.map((tab) => tab.id)].sort((a, b) => a - b), original.map((tab) => tab.id).sort((a, b) => a - b));
  assert.deepEqual([...sorted.state.map((tab) => tab.url)].sort(), original.map((tab) => tab.url).sort());
  const fixtureByUrl = new Map(fixture.tabs.map((tab) => [tab.url, tab]));
  const grouped = sorted.state.filter((tab) => fixtureByUrl.has(tab.url));
  assert.equal(grouped.length, 300);
  for (const tab of grouped) assert.equal(tab.group, fixtureByUrl.get(tab.url).family + " AI", tab.url);
  assert.deepEqual([...new Set(grouped.map((tab) => tab.group))].sort(), GOLD_FAMILIES.map((family) => family + " AI").sort());
  const successRequests = requests.filter((request) => request.mode === "recover");
  assert.equal(successRequests.length, 8);
  assert.deepEqual(successRequests.map((request) => request.phase), ["grouping", "taxonomy", ...Array(6).fill("classification")]);
  assert.deepEqual(successRequests.slice(2).map((request) => request.tabs), Array(6).fill(50));
  assert.deepEqual(successRequests.slice(2).flatMap((request) => request.ids), fixture.tabs.map((_tab, index) => "t" + index));
  for (const request of successRequests.slice(2)) assert.deepEqual(request.localIndices, Array.from({ length: 50 }, (_value, index) => index));
  console.log("recovery: truncated first response -> global taxonomy + six 50-tab batches; all 300 native identities in 10 expected groups");

  const undone = await client.execute(`
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    win.document.querySelector('.zao-sort-progress button[data-action="undo"]').click();
    return win.__qaResult();
  `);
  assert.deepEqual(undone.state, original); assert.equal(undone.selectedPreserved, true);
  assert.equal(undone.manualCollapsed, true); assert.equal(undone.manualColor, "pink");
  console.log("Undo: exact original native tab identities, URLs, order, manual group appearance and collapse restored");
  results.recovery = { requests: successRequests, groups: GOLD_FAMILIES.length, tabs: grouped.length, undoExact: true };

  // Undo restores native tab references and group appearance, recreating the group node.
  await client.execute('const win = Services.wm.getMostRecentWindow("navigator:browser"); win.__qaGroup = win.document.querySelector(\'tab-group[label="My manual group"]\');');
  mode = "terminal"; classificationCount = 0;
  const terminal = await run();
  assert.equal(terminal.error, undefined); assert.deepEqual(terminal.state, original); assert.equal(terminal.canUndo, false);
  assert.equal(terminal.selectedPreserved, true); assert.equal(terminal.manualGroupPreserved, true);
  assert.equal(terminal.manualCollapsed, true); assert.match(terminal.status, /key|access|401/i);
  const terminalRequests = requests.filter((request) => request.mode === mode);
  assert.deepEqual(terminalRequests.map((request) => request.phase), ["grouping", "taxonomy", "classification", "classification"]);
  console.log("terminal fallback failure: HTTP401 after one successful assignment batch leaves every tab unchanged");
  results.terminal = { requests: terminalRequests, unchanged: true };

  mode = "stop"; classificationCount = 0; waiting = deferred(); aborted = deferred();
  await client.execute(`
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    win.__qaPending = win.OpenTabSortZen.handleOrganizeClick().then(() => win.__qaResult()).catch((error) => ({ error: String(error) }));
  `);
  await within(waiting.promise, "Fallback classification request was not received");
  await client.execute(`
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    const stop = win.document.querySelector('.zao-sort-progress button[data-action="stop"]');
    if (!stop || stop.hidden) throw new Error("Stop control unavailable during recovery");
    stop.click();
  `);
  const stopped = await client.executeAsync(`
    const done = arguments[arguments.length - 1], win = Services.wm.getMostRecentWindow("navigator:browser");
    win.__qaPending.then(done);
  `);
  await within(aborted.promise, "Stop did not close the in-flight provider request");
  assert.equal(stopped.error, undefined); assert.deepEqual(stopped.state, original); assert.equal(stopped.canUndo, false);
  assert.equal(stopped.selectedPreserved, true); assert.match(stopped.status, /stopped/i);
  assert.equal(stopped.manualGroupPreserved, true); assert.equal(stopped.manualCollapsed, true);
  const stoppedRequests = requests.filter((request) => request.mode === mode);
  assert.deepEqual(stoppedRequests.map((request) => request.phase), ["grouping", "taxonomy", "classification"]);
  console.log("Stop during recovery: in-flight HTTP request aborted; no later requests or tab changes");
  results.stop = { requests: stoppedRequests, unchanged: true, requestAborted: true };
  if (process.env.OUTPUT_RECOVERY_QA_ARTIFACT) await writeFile(process.env.OUTPUT_RECOVERY_QA_ARTIFACT, JSON.stringify(results, null, 2));
  console.log("output-limit native acceptance: PASS");
} catch (error) {
  if (zen?.e2eLogTail) console.error("Disposable Zen log tail:\n" + zen.e2eLogTail().join("\n"));
  throw error;
} finally {
  client?.close(); if (zen) await stopZen(zen);
  for (const response of heldResponses) response.destroy();
  await provider?.close(); await pages?.close(); if (lab) await removeLabProfile(lab.profileDir);
}
