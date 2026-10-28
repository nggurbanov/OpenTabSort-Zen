import test from "node:test";
import assert from "node:assert/strict";
import { getEligibleTabs, isOrganizableUrl } from "../modules/tabs.mjs";

test("AI eligibility excludes setup, browser utilities and extension pages", () => {
  for (const url of ["about:preferences#sineMods", "about:addons", "about:blank", "about:newtab", "chrome://browser/content/browser.xhtml", "resource://gre/modules/", "moz-extension://id/options.html"]) assert.equal(isOrganizableUrl(url), false, url);
  for (const url of ["https://example.test/", "http://example.test/", "file:///notes.txt", "about:reader?url=https://example.test/"]) assert.equal(isOrganizableUrl(url), true, url);
});
test("the live setup tab stays outside the enumerated AI workspace", () => {
  const previous = { window: globalThis.window, gBrowser: globalThis.gBrowser };
  const tab = (url) => ({ isConnected: true, pinned: false, linkedBrowser: { currentURI: { spec: url } },
    getAttribute: (name) => name === "zen-workspace-id" ? "w" : "Tab", hasAttribute: () => false, closest: () => null });
  const content = tab("https://example.test/article"), setup = tab("about:preferences#sineMods");
  try {
    globalThis.window = { gZenWorkspaces: { activeWorkspace: "w" } }; globalThis.gBrowser = { tabs: [content, setup] };
    assert.deepEqual(getEligibleTabs().tabs.map((item) => item._tab), [content]);
  } finally {
    if (previous.window === undefined) delete globalThis.window; else globalThis.window = previous.window;
    if (previous.gBrowser === undefined) delete globalThis.gBrowser; else globalThis.gBrowser = previous.gBrowser;
  }
});
