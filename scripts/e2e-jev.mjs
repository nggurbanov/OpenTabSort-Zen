#!/usr/bin/env node
// Real Zen tab operations with deterministic HTTP fixtures, never a paid model.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { createLabProfile, findDefaultSineProfile, removeLabProfile, scenarioPrefs, writeUserPrefs } from "./zen-e2e-profile.mjs";
import { launchZen, stopZen, waitForZenReady, prepareTabs, waitForWorkspaceUrls, assertConnectedProfile } from "./zen-e2e-driver.mjs";
import { MarionetteClient, reserveTcpPort } from "./zen-e2e-marionette.mjs";
import { createSemanticFixture, GOLD_FAMILIES } from "./zen-e2e-fixtures.mjs";
import { startFixturePageServer } from "./zen-e2e-servers.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const categories = GOLD_FAMILIES.map((name) => ({ name, description: `Pages about ${name.toLowerCase()}; excludes the other named topics.` }));
const calls = [];
let suggestions = 0;
const server = createServer(async (request, response) => {
  try {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    let output;
    if (request.url.includes("systemone")) {
      calls.push(body.state.tabs.length);
      output = { answers: Object.fromEntries(body.state.tabs.map((tab) => {
        const index = GOLD_FAMILIES.findIndex((family) => tab.path.includes(`${family.toLowerCase()}.localhost`));
        const choice = index < 0 ? "none" : `c${index}`;
        return [tab.id, { type: "choice", choice, confidence: 1,
          probabilities: Object.fromEntries(Object.keys(body.questions[tab.id].criteria).map((key) => [key, key === choice ? 1 : 0])) }];
      })) };
    } else {
      suggestions++;
      output = { choices: [{ message: { content: JSON.stringify({ categories }) } }] };
    }
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(output));
  } catch { response.writeHead(500); response.end(); }
});
await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
const port = server.address().port;
const pages = await startFixturePageServer();
let lab, zen, client;
try {
  lab = await createLabProfile(repo, process.env.SINE_PROFILE || await findDefaultSineProfile());
  const marionettePort = await reserveTcpPort();
  await writeUserPrefs(lab.profileDir, [
    ...scenarioPrefs({ scenario: "full-ai", providerPort: port, marionettePort }),
    ["extensions.zen-auto-organize.ai-engine", "jev"],
    ["extensions.zen-auto-organize.ai-jev-api-key", "local-fixture-key"],
    ["extensions.zen-auto-organize.ai-jev-category-provider", "custom"],
    ["extensions.zen-auto-organize.ai-jev-preview", false],
  ]);
  zen = launchZen({ options: { headed: true, zenBinary: process.env.ZEN_BINARY || "/Applications/Zen.app/Contents/MacOS/zen" }, profileDir: lab.profileDir, marionettePort });
  client = await MarionetteClient.connect(marionettePort);
  await client.newSession(); await client.setScriptTimeout(); await client.setChromeContext();
  await assertConnectedProfile(client, lab.profileDir); await waitForZenReady(client);
  const fixture = createSemanticFixture(300, pages.port);
  await prepareTabs(client, fixture); await waitForWorkspaceUrls(client, 300);
  await client.execute(`
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    win.__jevNativeFetch = win.fetch.bind(win); win.__jevRequests = 0;
    win.fetch = async (url, init) => {
      if (String(url) !== "https://api.typesafe.ai/v1/systemone") return win.__jevNativeFetch(url, init);
      win.__jevRequests++;
      if (win.__jevMode === "stop" && win.__jevRequests === 2) {
        [...win.document.querySelectorAll(".zao-jev-progress button")].find((button) => button.textContent === "Stop").click();
      }
      if (win.__jevMode === "edit" && win.__jevRequests === 2) {
        const tab = [...win.gBrowser.tabs].find((tab) => !tab.pinned && tab.closest("tab-group"));
        win.gBrowser.ungroupTab(tab);
      }
      if (win.__jevMode === "auth" && win.__jevRequests === 2) return new win.Response("Unauthorized", { status: 401 });
      return win.__jevNativeFetch("http://127.0.0.1:${port}/v1/systemone", init);
    };
    win.__jevState = () => [...win.gBrowser.tabs].filter((tab) => !tab.pinned).map((tab, position) => ({
      url: win.gBrowser.getBrowserForTab(tab)?.currentURI?.spec,
      group: tab.closest("tab-group")?.getAttribute("label") || null,
      position,
    }));
    const initial = [...win.gBrowser.tabs].filter((tab) => win.gBrowser.getBrowserForTab(tab)?.currentURI?.spec.includes(".localhost"));
    const oldGroup = win.gBrowser.addTabGroup(initial.slice(0, 25), { label: "Original manual group", color: "pink",
      insertBefore: win.gZenWorkspaces.activeWorkspaceElement.tabsContainer.firstChild });
    oldGroup.collapsed = true;
    win.__jevOriginal = win.__jevState();
    return true;
  `);
  const run = async (mode = "normal") => client.executeAsync(`
    const done = arguments[arguments.length - 1];
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    win.__jevMode = ${JSON.stringify(mode)}; win.__jevRequests = 0;
    win.OpenTabSortZen.handleOrganizeClick().then(() => done({
      state: win.__jevState(), requests: win.__jevRequests,
      status: win.document.querySelector(".zao-jev-progress span")?.textContent,
      preview: !!win.document.querySelector(".zao-jev-preview"),
      saved: JSON.parse(Services.prefs.getStringPref("extensions.zen-auto-organize.ai-jev-categories-json", "{}")),
      selectedUrl: win.gBrowser.selectedBrowser.currentURI.spec,
      nested: !!win.document.querySelector("tab-group tab-group"),
    })).catch((error) => done({ error: String(error) }));
  `);
  const undo = async () => client.execute(`
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    [...win.document.querySelectorAll(".zao-jev-progress button")].find((button) => button.textContent === "Undo sort")?.click();
    return { state: win.__jevState(), original: win.__jevOriginal, hasProgress: !!win.document.querySelector(".zao-jev-progress"),
      collapsed: win.document.querySelector('tab-group[label="Original manual group"]')?.collapsed };
  `);
  const result = await run();
  assert.equal(result.error, undefined); assert.equal(result.preview, false); assert.equal(result.nested, false);
  assert.equal(suggestions, 1);
  const sorted = result.state.filter((tab) => tab.url.includes(".localhost"));
  assert.equal(sorted.length, 300); assert.equal(new Set(sorted.map((tab) => tab.url)).size, 300);
  assert.ok(sorted.every((tab) => tab.group === GOLD_FAMILIES.find((family) => tab.url.includes(`${family.toLowerCase()}.localhost`))));
  assert.equal(result.selectedUrl, "about:blank");
  console.log(JSON.stringify({ scenario: "automatic-300", requests: result.requests, batches: calls, status: result.status }));
  if (process.env.JEV_QA_SCREENSHOT) {
    const data = await client.command("WebDriver:TakeScreenshot", {});
    await writeFile(process.env.JEV_QA_SCREENSHOT, Buffer.from(data, "base64"));
  }
  const restored = await undo();
  assert.deepEqual(restored.state, restored.original); assert.equal(restored.hasProgress, false); assert.equal(restored.collapsed, true);
  console.log("undo: original membership, order and collapse restored");
  const reuse = await run(); assert.equal(reuse.error, undefined); assert.equal(suggestions, 1);
  await undo(); console.log("saved categories: no second suggestion request");
  const stopped = await run("stop"); assert.equal(stopped.requests, 2); assert.match(stopped.status, /stopped/);
  const stopUndo = await undo(); assert.deepEqual(stopUndo.state, stopUndo.original);
  console.log("stop: completed first batch retained and undoable");
  const auth = await run("auth"); assert.equal(auth.requests, 2); assert.match(auth.status, /401/);
  const authUndo = await undo();
  assert.deepEqual(authUndo.state, authUndo.original);
  console.log("authentication failure: completed first batch retained and undoable");
  const edited = await run("edit"); assert.equal(edited.requests, 2); assert.match(edited.status, /changed/);
  const staleUndo = await undo(); assert.equal(staleUndo.hasProgress, true);
  assert.deepEqual(staleUndo.state, edited.state);
  console.log("manual edit: stops stale batch and undo does not overwrite edit");
  // Preview is optional, and cancelling it sends no classification requests.
  await client.execute(`Services.prefs.setBoolPref("extensions.zen-auto-organize.ai-jev-preview", true);`);
  const preview = async (accept) => client.executeAsync(`
    const done = arguments[arguments.length - 1];
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    win.__jevMode = "normal"; win.__jevRequests = 0;
    const before = win.__jevState();
    const observer = new win.MutationObserver(() => {
      const modal = win.document.querySelector(".zao-jev-preview[open]");
      if (!modal) return;
      observer.disconnect();
      if (${accept}) {
        const input = modal.querySelector("input"); input.value = "WORK revised";
        input.dispatchEvent(new win.Event("input", { bubbles: true }));
      } else {
        const merge = modal.querySelector("select"); merge.value = "1";
        merge.dispatchEvent(new win.Event("change", { bubbles: true }));
      }
      [...modal.querySelectorAll("button")].find((button) => button.textContent === ${JSON.stringify(accept ? "Sort now" : "Cancel")}).click();
    });
    observer.observe(win.document.documentElement, { subtree: true, childList: true, attributes: true });
    win.OpenTabSortZen.handleOrganizeClick().then(() => {
      observer.disconnect(); done({ before, after: win.__jevState(), requests: win.__jevRequests,
        categories: JSON.parse(Services.prefs.getStringPref("extensions.zen-auto-organize.ai-jev-categories-json", "{}"))[win.gZenWorkspaces.activeWorkspace],
        hasPreview: !!win.document.querySelector(".zao-jev-preview"),
      });
    }).catch((error) => { observer.disconnect(); done({ error: String(error) }); });
  `);
  const cancelled = await preview(false);
  assert.equal(cancelled.error, undefined); assert.equal(cancelled.requests, 0); assert.equal(cancelled.hasPreview, false);
  assert.deepEqual(cancelled.after, cancelled.before); assert.equal(cancelled.categories.length, 10);
  console.log("preview cancellation: merged draft discarded, no requests or moves");
  const accepted = await preview(true);
  assert.equal(accepted.error, undefined); assert.ok(accepted.requests > 0); assert.equal(accepted.categories[0].name, "WORK revised");
  assert.equal(accepted.hasPreview, false);
  console.log("preview acceptance: edited category saved and applied");
  if (process.env.JEV_QA_SETTINGS === "1") {
    await client.command("Marionette:SetContext", { value: "content" });
    const handles = await client.command("WebDriver:GetWindowHandles", {});
    await client.command("WebDriver:SwitchToWindow", { handle: handles[0] });
    await client.command("WebDriver:Navigate", { url: "about:preferences#sineMods" });
    const settingsResult = await client.executeAsync(`
      const done = arguments[arguments.length - 1];
      const deadline = Date.now() + 20000;
      const check = () => {
        const item = [...document.querySelectorAll(".sineItem")].find((item) => item.querySelector(".sineItemTitle")?.textContent.includes("OpenTabSort"));
        const configure = item?.querySelector(".sineItemConfigureButton");
        if (configure && !item.querySelector("dialog[open]")) configure.click();
        const dialog = item?.querySelector("dialog");
        const categoryEditor = dialog?.querySelector(".zao-jev-category-settings");
        if (categoryEditor && dialog.querySelector(".zao-custom-dropdown")) {
          const row = (key) => dialog.querySelector("#extensions-zen-auto-organize-" + key);
          const visible = (key) => !row(key)?.classList.contains("zao-pref-hidden");
          done({ categories: categoryEditor.querySelectorAll(".zao-category-row").length,
            keyVisible: visible("ai-jev-api-key"), sourceVisible: visible("ai-jev-category-source"),
            providerVisible: visible("ai-custom-endpoint"), oldModeHidden: !visible("ai-sort-mode"),
            sourceValue: row("ai-jev-category-source")?.querySelector(".zao-custom-dropdown-button")?.dataset.value,
          });
        } else if (Date.now() >= deadline) done({ error: "Jev settings editor did not appear", items: document.querySelectorAll(".sineItem").length });
        else setTimeout(check, 100);
      };
      check();
    `);
    assert.equal(settingsResult.error, undefined);
    assert.equal(settingsResult.categories, 10); assert.equal(settingsResult.keyVisible, true);
    assert.equal(settingsResult.sourceVisible, true); assert.equal(settingsResult.providerVisible, true);
    assert.equal(settingsResult.oldModeHidden, true); assert.equal(settingsResult.sourceValue, "reuse");
    console.log("settings: category editor and Jev/provider controls present with legacy mode hidden");
  }
  console.log("Jev native Zen QA: PASS (deterministic providers)");
} catch (error) {
  if (zen) console.error(zen.e2eLogTail().join("\n"));
  throw error;
} finally {
  client?.close(); if (zen) await stopZen(zen);
  if (lab) await removeLabProfile(lab.profileDir);
  await pages.close(); await new Promise((resolveClose) => { server.closeAllConnections(); server.close(resolveClose); });
}
