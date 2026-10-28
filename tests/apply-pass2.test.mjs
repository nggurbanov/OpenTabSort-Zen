import test from "node:test";
import assert from "node:assert/strict";
import { applyPass2 } from "../modules/ai.mjs";
import { CONFIG } from "../modules/config.mjs";

import { workspaceId, withBrowser } from "./helpers/native-tabs.mjs";
const transient = { newGroupBehavior: "transient", existingBehavior: "transient", persistRules: false };
const makePlan = (assignedToExisting = [], newGroups = []) => ({ assignedToExisting, newGroups, skipped: [] });


test("new clusters use original tab nodes and ungroup before native creation", () => withBrowser({}, (browser) => {
  const old = browser.makeGroup("Old");
  const members = [browser.makeTab("a.test", old), browser.makeTab("b.test", old)];
  const result = applyPass2(makePlan([], [{ name: "AI Group", tabs: members }]), workspaceId, [], transient);
  assert.deepEqual(browser.calls.slice(0, 3).map((call) => call.type), ["ungroup", "ungroup", "create"]);
  assert.deepEqual(browser.groups.at(-1).members, members.map((info) => info._tab));
  assert.equal(result.newGroupsCreated, 1);
  assert.deepEqual(result.errors, []);
}));

test("AI can assign to a saved rule with no live group, using its appearance and one destination", () => withBrowser({}, (browser) => {
  const rule = { name: "Reading", domains: ["reading.test"], color: "red", icon: "📚" };
  const members = [browser.makeTab("a.test"), browser.makeTab("b.test")];
  const result = applyPass2(makePlan(members.map((tabInfo) => ({ tabInfo, groupName: rule.name }))), workspaceId, [rule], transient);
  const target = browser.groups[0];
  assert.equal(target.getAttribute("label"), rule.name);
  assert.equal(target.color, "red");
  assert.equal(target.style.getPropertyValue("--zao-tab-group-icon"), JSON.stringify("📚"));
  assert.deepEqual(target.members, members.map((info) => info._tab));
  assert.equal(browser.calls.filter((call) => call.type === "create").length, 1);
  assert.equal(result.movedToExisting, 2);
  assert.deepEqual(browser.writes, []);
}));

for (const failure of ["null", "throw"]) {
  test(`failed ${failure} group creation restores emptied original groups, tab order and appearance`, () => withBrowser({ createFailure: (label) => label === "AI Group" ? failure : null }, (browser) => {
    const old = browser.makeGroup("Old", { collapsed: true, color: "purple", style: "--custom: original" });
    const members = [browser.makeTab("a.test", old), browser.makeTab("b.test", old)];
    const identities = [...browser.tabs];
    const rules = [];
    const result = applyPass2(makePlan([], [{ name: "AI Group", tabs: members }]), workspaceId, rules, { ...transient, persistRules: true, newGroupBehavior: "auto-add" });
    const restored = members[0]._tab.group;
    assert.notEqual(restored, old);
    assert.equal(restored.getAttribute("label"), "Old");
    assert.equal(restored.color, "purple");
    assert.equal(restored.collapsed, true);
    assert.equal(restored.getAttribute("style"), "--custom: original");
    assert.equal(restored.className, "original-group");
    assert.deepEqual(restored.members, identities);
    assert.deepEqual(browser.tabs, identities);
    assert.equal(result.newGroupsCreated, 0);
    assert.deepEqual(result.failedTabs, members);
    assert.equal(result.errors.length, 1);
    assert.deepEqual(result.errors[0].rollbackErrors, []);
    assert.deepEqual(rules, []);
    assert.deepEqual(browser.writes, []);
  }));
}

for (const failure of ["throw-before", "throw-after", "noop"]) {
  test(`failed ${failure} native move retains original membership and cannot teach a domain`, () => withBrowser({ moveFailure: (label) => label === "Reading" ? failure : null }, (browser) => {
    const source = browser.makeGroup("Original");
    const member = browser.makeTab("new.test", source);
    const target = browser.makeGroup("Reading", { collapsed: true });
    browser.makeTab("reading.test", target);
    const rules = [{ name: "Reading", domains: ["reading.test"] }];
    const result = applyPass2(makePlan([{ tabInfo: member, groupName: "Reading" }]), workspaceId, rules, { ...transient, persistRules: true, existingBehavior: "always-add" });
    assert.equal(member._tab.group.getAttribute("label"), "Original");
    assert.equal(target.collapsed, true);
    assert.equal(result.movedToExisting, 0);
    assert.equal(result.rulesGrown, 0);
    assert.deepEqual(result.failedTabs, [member]);
    assert.deepEqual(result.errors[0].rollbackErrors, []);
    assert.deepEqual(rules[0].domains, ["reading.test"]);
    assert.deepEqual(browser.writes, []);
  }));
}

test("successful existing-group moves preserve collapse and persist only the successful domain", () => withBrowser({}, (browser) => {
  const target = browser.makeGroup("Reading", { collapsed: true });
  browser.makeTab("reading.test", target);
  const member = browser.makeTab("new.test");
  const rule = { name: "Reading", domains: ["reading.test"] };
  const result = applyPass2(makePlan([{ tabInfo: member, groupName: "Reading" }]), workspaceId, [rule], { ...transient, persistRules: true, existingBehavior: "always-add" });
  assert.equal(member._tab.group, target);
  assert.equal(target.collapsed, true);
  assert.equal(result.rulesGrown, 1);
  assert.deepEqual(rule.domains, ["reading.test", "new.test"]);
  assert.equal(browser.writes.filter((write) => write.name === CONFIG.RULES_PREF).length, 1);
}));

test("failure to create a missing rule group restores the source and does not grow that rule", () => withBrowser({ createFailure: (label) => label === "Reading" ? "null" : null }, (browser) => {
  const original = browser.makeGroup("Original");
  const member = browser.makeTab("new.test", original);
  const rule = { name: "Reading", domains: ["reading.test"] };
  const result = applyPass2(makePlan([{ tabInfo: member, groupName: "Reading" }]), workspaceId, [rule], { ...transient, persistRules: true, existingBehavior: "always-add" });
  assert.equal(member._tab.group.getAttribute("label"), "Original");
  assert.equal(result.errors.length, 1);
  assert.deepEqual(result.errors[0].rollbackErrors, []);
  assert.deepEqual(rule.domains, ["reading.test"]);
  assert.deepEqual(browser.writes, []);
}));

test("a failed move from an ungrouped source restores its ungrouped placement", () => withBrowser({ moveFailure: () => "throw-after" }, (browser) => {
  const member = browser.makeTab("new.test");
  const target = browser.makeGroup("Reading");
  browser.makeTab("reading.test", target);
  const identities = [...browser.tabs];
  const result = applyPass2(makePlan([{ tabInfo: member, groupName: "Reading" }]), workspaceId, [], transient);
  assert.equal(member._tab.group, null);
  assert.deepEqual(browser.tabs, identities);
  assert.deepEqual(result.errors[0].rollbackErrors, []);
}));

test("a rollback failure is explicitly reported instead of claiming the tabs were restored", () => withBrowser({ createFailure: () => "null" }, (browser) => {
  const old = browser.makeGroup("Old");
  const member = browser.makeTab("new.test", old);
  const result = applyPass2(makePlan([], [{ name: "AI Group", tabs: [member] }]), workspaceId, [], transient);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].rollbackErrors[0], /Source group could not be restored/);
  assert.deepEqual(result.failedTabs, [member]);
  assert.equal(member._tab.isConnected, true);
}));


test("a failed cluster restores several source groups and ungrouped tabs while keeping earlier success", () => withBrowser({ createFailure: (label) => label === "Failure" ? "null" : null }, (browser) => {
  const oldA = browser.makeGroup("Old A");
  const first = browser.makeTab("a.test", oldA);
  const oldB = browser.makeGroup("Old B");
  const second = browser.makeTab("b.test", oldB);
  const ungrouped = browser.makeTab("c.test");
  const success = browser.makeTab("d.test");
  const result = applyPass2(makePlan([], [
    { name: "Success", tabs: [success] },
    { name: "Failure", tabs: [first, second, ungrouped] },
  ]), workspaceId, [], transient);
  assert.equal(success._tab.group.getAttribute("label"), "Success");
  assert.equal(first._tab.group.getAttribute("label"), "Old A");
  assert.equal(second._tab.group.getAttribute("label"), "Old B");
  assert.equal(ungrouped._tab.group, null);
  assert.equal(result.newGroupsCreated, 1);
  assert.deepEqual(result.failedTabs, [first, second, ungrouped]);
  assert.deepEqual(result.errors[0].rollbackErrors, []);
}));

test("only successful assignments grow a rule when another native move fails", () => withBrowser({ moveFailure: (() => {
  let calls = 0;
  return () => ++calls === 2 ? "throw-after" : null;
})() }, (browser) => {
  const target = browser.makeGroup("Reading");
  browser.makeTab("reading.test", target);
  const success = browser.makeTab("success.test");
  const failed = browser.makeTab("failed.test");
  const rule = { name: "Reading", domains: ["reading.test"] };
  const result = applyPass2(makePlan([success, failed].map((tabInfo) => ({ tabInfo, groupName: "Reading" }))), workspaceId, [rule], { ...transient, persistRules: true, existingBehavior: "always-add" });
  assert.equal(result.movedToExisting, 1);
  assert.equal(result.rulesGrown, 1);
  assert.deepEqual(rule.domains, ["reading.test", "success.test"]);
  assert.equal(success._tab.group, target);
  assert.equal(failed._tab.group, null);
  assert.deepEqual(result.failedTabs, [failed]);
  const saved = JSON.parse(browser.prefs.get(CONFIG.RULES_PREF));
  assert.deepEqual(saved[0].domains, ["reading.test", "success.test"]);
}));

const workspaceAI = { workspaceAI: true };

test("workspace AI reuses normalized live category names and preserves their appearance and collapse", () => withBrowser({}, (browser) => {
  const target = browser.makeGroup("Café", { collapsed: true, color: "purple", style: "--custom: keep" });
  browser.makeTab("seed.test", target);
  target.className = "manual-appearance";
  const members = [browser.makeTab("a.test"), browser.makeTab("b.test")];
  const rules = [{ name: "CAFÉ", domains: ["old.test"], color: "red" }];
  const before = structuredClone(rules);
  const result = applyPass2(makePlan([{ tabInfo: members[0], groupName: "CAFE\u0301" }], [{ name: "Ｃａｆé", tabs: [members[1]] }]), workspaceId, rules, workspaceAI);
  assert.deepEqual(target.members.slice(1), members.map((member) => member._tab));
  assert.equal(target.color, "purple");
  assert.equal(target.collapsed, true);
  assert.equal(target.className, "manual-appearance");
  assert.equal(target.getAttribute("style"), "--custom: keep");
  assert.equal(result.newGroupsCreated, 0);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(rules, before);
  assert.deepEqual(browser.writes, []);
}));

test("workspace taxonomy assignments create absent categories without a matching legacy rule", () => withBrowser({}, (browser) => {
  const members = [browser.makeTab("a.test"), browser.makeTab("b.test")];
  const result = applyPass2(makePlan([{ tabInfo: members[0], groupName: "Research" }], [{ name: "RESEARCH", tabs: [members[1]] }]), workspaceId, [], workspaceAI);
  assert.equal(result.newGroupsCreated, 1);
  assert.equal(browser.groups[0].getAttribute("label"), "Research");
  assert.deepEqual(browser.groups[0].members, members.map((member) => member._tab));
  assert.deepEqual(result.errors, []);
}));

test("repeating a workspace taxonomy preserves native groups and never adds numeric suffixes", () => withBrowser({}, (browser) => {
  const member = browser.makeTab("reading.test");
  const rules = [{ name: "Reading", domains: ["old.test"], color: "red" }];
  const plan = makePlan([], [{ name: "Reading", tabs: [member] }]);
  const first = applyPass2(plan, workspaceId, rules, workspaceAI);
  const group = member._tab.group;
  const second = applyPass2(plan, workspaceId, rules, workspaceAI);
  assert.equal(first.newGroupsCreated, 1);
  assert.equal(second.newGroupsCreated, 0);
  assert.equal(member._tab.group, group);
  assert.equal(group.getAttribute("label"), "Reading");
  assert.equal(browser.calls.filter((call) => call.type === "create").length, 1);
  assert.deepEqual(rules[0].domains, ["old.test"]);
  assert.deepEqual(browser.writes, []);
}));

test("workspace category colors are stable across group creation and ignore legacy rule colors", () => {
  const colors = [];
  for (let index = 0; index < 2; index++) withBrowser({}, (browser) => {
    const member = browser.makeTab("a.test");
    applyPass2(makePlan([], [{ name: "Research", tabs: [member] }]), workspaceId, [{ name: "Legacy", domains: ["legacy.test"], color: index ? "blue" : "red" }], workspaceAI);
    colors.push(member._tab.group.color);
  });
  assert.equal(colors[0], colors[1]);
});

test("workspace taxonomy cannot reuse a same-named group from a different workspace", () => withBrowser({}, (browser) => {
  const foreign = browser.makeGroup("Reading"); foreign.setAttribute("zen-workspace-id", "other-workspace");
  const foreignMember = browser.makeTab("foreign.test", foreign); foreignMember._tab.workspaceId = "other-workspace";
  const member = browser.makeTab("reading.test");
  const result = applyPass2(makePlan([], [{ name: "Reading", tabs: [member] }]), workspaceId, [], workspaceAI);
  assert.notEqual(member._tab.group, foreign);
  assert.equal(member._tab.group.getAttribute("label"), "Reading");
  assert.deepEqual(foreign.members, [foreignMember._tab]);
  assert.deepEqual(result.errors, []);
}));

for (const invalid of ["foreign", "duplicate", "pinned", "stale-workspace"]) {
  test(`workspace taxonomy rejects ${invalid} assignments before changing any tabs`, () => withBrowser({}, (browser) => {
    const member = browser.makeTab("a.test");
    const other = browser.makeTab("b.test");
    if (invalid === "foreign") other._tab.workspaceId = "other-workspace";
    if (invalid === "pinned") other._tab.pinned = true;
    if (invalid === "stale-workspace") window.gZenWorkspaces.activeWorkspace = "other-workspace";
    const members = [member, invalid === "duplicate" ? member : other];
    const result = applyPass2(makePlan([], [{ name: "Reading", tabs: members }]), workspaceId, [], workspaceAI);
    assert.ok(result.errors.length > 0);
    assert.deepEqual(browser.calls, []);
    assert.equal(member._tab.group, null);
    assert.equal(other._tab.group, null);
  }));
}

test("legacy new-category application retains its collision disambiguation behavior", () => withBrowser({}, (browser) => {
  const target = browser.makeGroup("Reading"); browser.makeTab("seed.test", target);
  const member = browser.makeTab("a.test");
  applyPass2(makePlan([], [{ name: "Reading", tabs: [member] }]), workspaceId, [], transient);
  assert.equal(member._tab.group.getAttribute("label"), "Reading (A)");
  assert.notEqual(member._tab.group, target);
}));


test("workspace AI ignores rule-learning options and reviewed rule patches", () => withBrowser({}, (browser) => {
  const member = browser.makeTab("new.test");
  const rules = [{ name: "Reading", domains: ["old.test"] }];
  const plan = makePlan([], [{ name: "Reading", tabs: [member] }]);
  plan.rulePatches = [{ groupName: "Reading", titleTerms: [{ term: "Learn me" }] }];
  const result = applyPass2(plan, workspaceId, rules, { workspaceAI: true, existingBehavior: "always-add", newGroupBehavior: "auto-add", persistRules: true });
  assert.equal(result.rulesGrown + result.titleTermsGrown + result.newRulesCreated, 0);
  assert.deepEqual(rules, [{ name: "Reading", domains: ["old.test"] }]);
  assert.deepEqual(browser.writes, []);
}));

test("primary group emoji reuse native targets, reserve untouched icons, and can be disabled", () => withBrowser({}, (browser) => {
  const manual = browser.makeGroup("💼 Manual"); browser.makeTab("manual.test", manual);
  const first = browser.makeTab("first.test"), second = browser.makeTab("second.test");
  const plan = makePlan([], [{ name: "💻 Work", tabs: [first] }, { name: "💻 Reading", tabs: [second] }]);
  const options = { ...transient, workspaceAI: true, emojiGroupNames: true };
  const result = applyPass2(plan, workspaceId, [], options);
  assert.deepEqual(result.errors, []);
  const work = first._tab.closest("tab-group"), reading = second._tab.closest("tab-group");
  assert.notEqual(work.getAttribute("label").split(" ")[0], reading.getAttribute("label").split(" ")[0]);
  assert.equal(manual.getAttribute("label"), "💼 Manual");
  const again = makePlan([first, second].map((tabInfo) => ({ tabInfo, groupName: tabInfo._tab.closest("tab-group").getAttribute("label") })));
  applyPass2(again, workspaceId, [], { ...options, emojiGroupNames: false });
  assert.equal(work.getAttribute("label"), "Work"); assert.equal(reading.getAttribute("label"), "Reading");
  assert.equal(first._tab.closest("tab-group"), work); assert.equal(second._tab.closest("tab-group"), reading);
}));
