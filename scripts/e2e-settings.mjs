#!/usr/bin/env node
// Real Sine settings acceptance in a disposable profile; never a paid model.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLabProfile, findDefaultSineProfile, removeLabProfile, scenarioPrefs, writeUserPrefs } from "./zen-e2e-profile.mjs";
import { launchZen, stopZen, waitForZenReady, assertConnectedProfile } from "./zen-e2e-driver.mjs";
import { MarionetteClient, reserveTcpPort } from "./zen-e2e-marionette.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = process.env.SETTINGS_QA_OUTPUT || "/tmp/opentabsort-overhaul-ui";
await mkdir(output, { recursive: true });
const checks = [], screenshots = [];
const rules = [
  { name: "Development", domains: ["github.com", "developer.mozilla.org"], titleTerms: ["API reference"], color: "blue" },
  { name: "Reading", domains: ["en.wikipedia.org"], titleTerms: ["research"], color: "green" },
  { name: "Design", domains: ["figma.com"], titleTerms: ["typography"], color: "purple" },
];
const prefix = "extensions.zen-auto-organize.";
let lab, zen, client;
try {
  lab = await createLabProfile(repo, process.env.SINE_PROFILE || await findDefaultSineProfile());
  const marionettePort = await reserveTcpPort();
  await writeUserPrefs(lab.profileDir, [
    ...scenarioPrefs({ scenario: "hybrid", providerPort: 9, marionettePort }),
    [prefix + "rules-json", JSON.stringify(rules)], [prefix + "ai-engine", "off"],
    [prefix + "ai-provider-consent", false], [prefix + "ai-review-before-apply", false],
    [prefix + "ai-ollama-warmup", false], ["ui.systemUsesDarkTheme", 0],
    ["layout.css.prefers-color-scheme.content-override", 1],
  ]);
  zen = launchZen({ options: { headed: true, zenBinary: process.env.ZEN_BINARY }, profileDir: lab.profileDir, marionettePort });
  client = await MarionetteClient.connect(marionettePort);
  await client.newSession(); await client.setScriptTimeout(); await client.setChromeContext();
  await assertConnectedProfile(client, lab.profileDir); await waitForZenReady(client);
  await client.command("WebDriver:SetWindowRect", { width: 1200, height: 1000 });
  const browser = await client.executeAsync(`
    const done = arguments[arguments.length - 1], win = Services.wm.getMostRecentWindow("navigator:browser");
    win.__settingsProviderRequests = 0;
    const nativeFetch = win.fetch.bind(win);
    win.fetch = (url, init) => { if (String(url).includes("127.0.0.1:9")) win.__settingsProviderRequests++; return nativeFetch(url, init); };
    const id = win.gZenWorkspaces.activeWorkspace;
    Services.prefs.setStringPref("extensions.zen-auto-organize.ai-jev-categories-json", JSON.stringify({
      [id]: [{ name: "Projects", description: "Active software projects.", examples: [] }],
    }));
    win.OpenTabSortZen.handleOrganizeClick().then(() => done({ version: Services.appinfo.version, platformVersion: Services.appinfo.platformVersion }));
  `);
  await client.command("Marionette:SetContext", { value: "content" });
  const handles = await client.command("WebDriver:GetWindowHandles", {});
  await client.command("WebDriver:SwitchToWindow", { handle: handles.at(-1) });
  const opened = await client.executeAsync(`
    const done = arguments[arguments.length - 1], deadline = Date.now() + 20000;
    const check = () => {
      const item = [...document.querySelectorAll(".sineItem")].find((item) => item.querySelector(".sineItemTitle")?.textContent.includes("OpenTabSort"));
      const dialog = item?.querySelector(".sineItemPreferenceDialog[open]");
      const simple = dialog?.querySelector(".zao-simple-settings");
      if (simple && dialog.getBoundingClientRect().height) {
        window.__settingsDialog = dialog;
        done({ visible: true, advancedClosed: !dialog.querySelector(".zao-advanced-settings").open,
          ruleEditors: dialog.querySelectorAll(".zao-rules-editor").length, categoryEditors: dialog.querySelectorAll(".zao-category-editor").length,
          primarySelects: simple.querySelectorAll("select").length, primaryText: simple.textContent });
      } else if (Date.now() > deadline) done({ error: "Wand setup navigation did not open visible AI setup", url: location.href,
        items: document.querySelectorAll(".sineItem").length, dialogs: [...document.querySelectorAll("dialog")].map((dialog) => ({ open: dialog.open, bounds: dialog.getBoundingClientRect().toJSON() })) });
      else setTimeout(check, 100);
    }; check();
  `);
  assert.equal(opened.error, undefined); assert.equal(opened.advancedClosed, true); assert.equal(opened.ruleEditors, 0);
  assert.equal(opened.categoryEditors, 0); assert.equal(opened.primarySelects, 1);
  assert.doesNotMatch(opened.primaryText, /Group Rules|Categories for this workspace|Rule matching priority/);
  checks.push({ name: "unconfigured wand opens visible simple setup without legacy editors", ...opened });

  const evaluate = (body) => client.execute(`
    const dialog = window.__settingsDialog, primary = dialog.querySelector(".zao-simple-settings");
    const field = (suffix) => primary.querySelector('[data-pref="extensions.zen-auto-organize.' + suffix + '"]');
    const change = (suffix, value) => { const element = field(suffix); element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); };
    ${body}
  `);
  const screenshot = async (name, target = ".zao-simple-settings") => {
    await client.executeAsync(`
      const done = arguments[arguments.length - 1];
      Promise.all(window.__settingsDialog.getAnimations({ subtree: true }).filter((animation) =>
        animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {})))
        .then(() => requestAnimationFrame(() => done(true)));
    `);
    const geometry = await evaluate(`
      dialog.querySelector(${JSON.stringify(target)})?.scrollIntoView({ behavior: "instant", block: "nearest" });
      const rect = dialog.getBoundingClientRect(), simple = primary.getBoundingClientRect();
      return { viewport: { width: innerWidth, height: innerHeight }, dark: matchMedia("(prefers-color-scheme: dark)").matches,
        dialog: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, primary: { width: simple.width, height: simple.height },
        primaryOverflow: primary.scrollWidth > primary.clientWidth + 1,
        advancedOpen: dialog.querySelector(".zao-advanced-settings").open,
        visibleOverflow: [...primary.querySelectorAll("input, select")].filter((element) => {
          const bounds = element.getBoundingClientRect(); return bounds.width && bounds.right > rect.right + 1;
        }).length };
    `);
    const data = await client.command("WebDriver:TakeScreenshot", {});
    const path = join(output, name + ".png"); await writeFile(path, Buffer.from(data, "base64"));
    screenshots.push({ path, ...geometry }); return geometry;
  };
  await screenshot("simple-light-unconfigured");
  const setup = await evaluate(`
    change("ai-engine", "custom");
    return { selected: field("ai-engine").value, keyMasked: field("ai-custom-api-key").type === "password",
      emojiDefault: field("ai-group-emoji").checked, reviewDefault: field("ai-review-before-apply").checked, consentDefault: field("ai-provider-consent").checked,
      noRules: !dialog.querySelector(".zao-rules-editor"), primaryFields: [...primary.querySelectorAll("input, select")].map((input) => input.dataset.pref) };
  `);
  assert.equal(setup.emojiDefault, true);
  const emojiToggle = await evaluate('const checkbox = field("ai-group-emoji"); checkbox.checked = false; checkbox.dispatchEvent(new Event("change", {bubbles:true})); return checkbox.checked;');
  assert.equal(emojiToggle, false);
  await evaluate('const checkbox = field("ai-group-emoji"); checkbox.checked = true; checkbox.dispatchEvent(new Event("change", {bubbles:true})); return true;');
  assert.equal(setup.keyMasked, true); assert.equal(setup.reviewDefault, false); assert.equal(setup.consentDefault, false); assert.equal(setup.noRules, true);
  checks.push({ name: "provider-specific setup masks keys and requires explicit consent", ...setup });
  await screenshot("simple-light-ai");

  // Native keyboard navigation in the real select must update provider fields.
  await evaluate('field("ai-engine").focus(); return true;');
  await client.command("WebDriver:PerformActions", { actions: [{ type: "key", id: "engine-keyboard", actions: [
    { type: "keyDown", value: "\uE013" }, { type: "keyUp", value: "\uE013" },
  ] }] });
  const keyboard = await evaluate('return { selected: field("ai-engine").value, localCopy: primary.textContent.includes("Runs in the browser"), noWarnings: !document.querySelector(".zao-warning-dialog") };');
  assert.equal(keyboard.selected, "local"); assert.equal(keyboard.localCopy, true); assert.equal(keyboard.noWarnings, true);
  checks.push({ name: "native engine keyboard navigation without forced acknowledgement", ...keyboard });
  await evaluate('change("ai-engine", "custom"); return true;');
  await client.setChromeContext();
  await client.execute('Services.prefs.setIntPref("ui.systemUsesDarkTheme", 1); Services.prefs.setIntPref("layout.css.prefers-color-scheme.content-override", 0);');
  await client.command("Marionette:SetContext", { value: "content" });
  const dark = await client.executeAsync(`
    const done = arguments[arguments.length - 1], deadline = Date.now() + 5000;
    const check = () => matchMedia("(prefers-color-scheme: dark)").matches ? done(true) : Date.now() > deadline ? done(false) : setTimeout(check, 50); check();
  `);
  assert.equal(dark, true);
  await screenshot("simple-dark-ai");
  await client.setChromeContext(); await client.command("WebDriver:SetWindowRect", { width: 640, height: 1000 });
  await client.command("Marionette:SetContext", { value: "content" });
  const narrow = await screenshot("simple-narrow-ai"); assert.equal(narrow.primaryOverflow, false); assert.equal(narrow.visibleOverflow, 0);
  checks.push({ name: "narrow primary connection form stays within dialog", ...narrow });

  await evaluate('change("ai-engine", "jev"); return true;');
  const decision = await evaluate('return { decisionKey: !!field("ai-jev-api-key"), suggestionProvider: !!field("ai-jev-category-provider"), hasManualCategories: !!primary.querySelector(".zao-category-editor") };');
  assert.equal(decision.decisionKey, true); assert.equal(decision.suggestionProvider, true); assert.equal(decision.hasManualCategories, false);
  checks.push({ name: "decision engine configures both connections without category maintenance", ...decision });

  // Opening Advanced is the first time rule/category editor modules construct DOM.
  const advanced = await client.executeAsync(`
    const done = arguments[arguments.length - 1], dialog = window.__settingsDialog, details = dialog.querySelector(".zao-advanced-settings");
    details.open = true; const deadline = Date.now() + 10000;
    const check = () => {
      if (dialog.querySelector(".zao-rules-editor") && dialog.querySelector(".zao-category-editor")) done({ rules: dialog.querySelectorAll(".zao-row").length,
        hasSavedRuleAction: [...details.querySelectorAll("button")].some((button) => button.textContent === "Run advanced sorting") });
      else if (Date.now() > deadline) done({ error: "Advanced editors did not load" }); else setTimeout(check, 50);
    }; check();
  `);
  assert.equal(advanced.error, undefined); assert.equal(advanced.rules, rules.length); assert.equal(advanced.hasSavedRuleAction, true);
  checks.push({ name: "advanced editors load on first expansion with saved data preserved", ...advanced });
  const search = await evaluate(`
    const search = dialog.querySelector(".zao-rules-search"); search.focus(); search.value = "RESEARCH"; search.dispatchEvent(new Event("input", { bubbles: true }));
    const found = { rows: dialog.querySelectorAll(".zao-row").length, focusRetained: document.activeElement === search };
    dialog.querySelector(".zao-rules-clear").click(); return found;
  `);
  assert.equal(search.rows, 1); assert.equal(search.focusRetained, true);
  checks.push({ name: "saved rules search remains available in Advanced", ...search });
  await screenshot("simple-dark-advanced", ".zao-rules-editor");

  // A second unconfigured wand click must reopen an existing preference tab.
  await evaluate('dialog.close(); return true;'); await client.setChromeContext();
  const zeroRequests = await client.executeAsync(`
    const done = arguments[arguments.length - 1], win = Services.wm.getMostRecentWindow("navigator:browser");
    Services.prefs.setStringPref("extensions.zen-auto-organize.ai-engine", "off");
    win.OpenTabSortZen.handleOrganizeClick().then(() => done({ requests: win.__settingsProviderRequests,
      savedRules: Services.prefs.getStringPref("extensions.zen-auto-organize.rules-json") }));
  `);
  assert.equal(zeroRequests.requests, 0); assert.deepEqual(JSON.parse(zeroRequests.savedRules), rules);
  await client.command("Marionette:SetContext", { value: "content" });
  const reopened = await client.executeAsync(`
    const done = arguments[arguments.length - 1], deadline = Date.now() + 10000;
    const check = () => {
      const dialog = window.__settingsDialog;
      if (dialog.open && !dialog.querySelector(".zao-advanced-settings").open) done(true);
      else if (Date.now() > deadline) done(false); else setTimeout(check, 50);
    }; check();
  `);
  assert.equal(reopened, true); checks.push({ name: "existing settings tab reopens primary without provider requests", ...zeroRequests, savedRules: "preserved" });
  const result = { timestamp: new Date().toISOString(), browser, profileKind: "isolated disposable Sine fixture",
    result: "PASS", checks, screenshots };
  await writeFile(join(output, "metadata.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(join(output, "failure.json"), JSON.stringify({ timestamp: new Date().toISOString(), error: error.stack, checks, screenshots, logs: zen?.e2eLogTail() }, null, 2));
  throw error;
} finally {
  client?.close(); if (zen) await stopZen(zen);
  if (lab) await removeLabProfile(lab.profileDir);
}
