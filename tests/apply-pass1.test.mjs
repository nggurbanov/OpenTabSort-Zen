import test from "node:test";
import assert from "node:assert/strict";
import { applyPass1 } from "../modules/pass1.mjs";
import { workspaceId, withBrowser } from "./helpers/native-tabs.mjs";

const rules = [{ name: "Reading", domains: ["reading.test"], color: "red", icon: "📚" }];

test("deterministic placement reuses the native destination, original tab identities and collapsed state", () => withBrowser({}, (browser) => {
  const target = browser.makeGroup("Reading", { collapsed: true }); browser.makeTab("reading.test", target);
  const members = [browser.makeTab("a.test"), browser.makeTab("b.test")];
  const result = applyPass1(new Map([["Reading", members]]), workspaceId, rules);
  assert.deepEqual(target.members.slice(1), members.map((member) => member._tab));
  assert.equal(target.collapsed, true);
  assert.equal(target.color, "red");
  assert.equal(result.movedToExisting, 2);
  assert.deepEqual(result.errors, []);
}));

test("deterministic new groups detach natively and receive the complete rule appearance", () => withBrowser({}, (browser) => {
  const source = browser.makeGroup("Old");
  const members = [browser.makeTab("a.test", source), browser.makeTab("b.test", source)];
  const result = applyPass1(new Map([["Reading", members]]), workspaceId, rules);
  assert.deepEqual(browser.calls.slice(0, 3).map((call) => call.type), ["ungroup", "ungroup", "create"]);
  const target = browser.groups.at(-1);
  assert.deepEqual(target.members, members.map((member) => member._tab));
  assert.equal(target.style.getPropertyValue("--zao-tab-group-icon"), JSON.stringify("📚"));
  assert.equal(result.createdGroups, 1);
  assert.equal(result.movedToNew, 2);
}));

for (const failure of ["null", "throw"]) {
  test(`failed deterministic ${failure} creation restores source membership and returns failed tab references`, () => withBrowser({ createFailure: (label) => label === "Reading" ? failure : null }, (browser) => {
    const source = browser.makeGroup("Old", { collapsed: true });
    const members = [browser.makeTab("a.test", source), browser.makeTab("b.test", source)];
    const identities = [...browser.tabs];
    const result = applyPass1(new Map([["Reading", members]]), workspaceId, rules);
    assert.equal(members[0]._tab.group.getAttribute("label"), "Old");
    assert.equal(members[0]._tab.group.collapsed, true);
    assert.deepEqual(members[0]._tab.group.members, identities);
    assert.deepEqual(browser.tabs, identities);
    assert.equal(result.createdGroups, 0);
    assert.equal(result.movedToNew, 0);
    assert.deepEqual(result.failedTabs, members);
    assert.equal(result.errors.length, 1);
    assert.deepEqual(result.errors[0].rollbackErrors, []);
    assert.deepEqual(browser.writes, []);
  }));
}

for (const failure of ["throw-before", "throw-after", "noop"]) {
  test(`a deterministic ${failure} failure rolls back the whole destination batch`, () => withBrowser({ moveFailure: (() => {
    let calls = 0;
    return (label) => label === "Reading" && ++calls === 2 ? failure : null;
  })() }, (browser) => {
    const source = browser.makeGroup("Old");
    const members = [browser.makeTab("a.test", source), browser.makeTab("b.test", source)];
    const target = browser.makeGroup("Reading", { collapsed: true });
    const seed = browser.makeTab("reading.test", target);
    const result = applyPass1(new Map([["Reading", members]]), workspaceId, rules);
    assert.equal(members[0]._tab.group.getAttribute("label"), "Old");
    assert.equal(members[1]._tab.group, members[0]._tab.group);
    assert.deepEqual(target.members, [seed._tab]);
    assert.equal(target.collapsed, true);
    assert.equal(result.movedToExisting, 0);
    assert.deepEqual(result.failedTabs, members);
    assert.deepEqual(result.errors[0].rollbackErrors, []);
  }));
}

test("a later deterministic group failure preserves completed earlier groups", () => withBrowser({ createFailure: (label) => label === "Reading" ? "null" : null }, (browser) => {
  const successful = browser.makeTab("success.test");
  const source = browser.makeGroup("Old"); const failed = browser.makeTab("failure.test", source);
  const result = applyPass1(new Map([["Success", [successful]], ["Reading", [failed]]]), workspaceId, rules);
  assert.equal(successful._tab.group.getAttribute("label"), "Success");
  assert.equal(failed._tab.group.getAttribute("label"), "Old");
  assert.equal(result.createdGroups, 1);
  assert.equal(result.movedToNew, 1);
  assert.deepEqual(result.failedTabs, [failed]);
}));
