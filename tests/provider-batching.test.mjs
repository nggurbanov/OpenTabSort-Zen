import test from "node:test";
import assert from "node:assert/strict";

import { classifyExistingGroupsRemoteBatch, runPass2Remote } from "../modules/remote-provider.mjs";

const LARGE_TAB_COUNT = 300;
const MAX_PROVIDER_TABS_PER_REQUEST = 75;

const readyOpenAiSettings = {
  provider: "openai",
  consentToSendData: true,
  endpoint: "https://api.example.test/v1",
  apiKey: "sk-test",
  model: "gpt-tabs",
};

const rules = [
  { name: "Dev", domains: ["github.com"] },
  { name: "Research", domains: ["arxiv.org"] },
];

const makeTabs = (count = LARGE_TAB_COUNT) => Array.from({ length: count }, (_, idx) => ({
  hostname: idx % 2 === 0 ? `dev-${idx}.example.test` : `research-${idx}.example.test`,
  title: `Batch tab ${String(idx).padStart(3, "0")}`,
  url: "",
}));

const tabLinesFromPrompt = (prompt) => [...prompt.matchAll(/^(\d+)\. ([^\n]+?) — "([^"]*)"/gm)]
  .map((match) => ({
    promptIndex: Number.parseInt(match[1], 10),
    host: match[2],
    title: match[3],
  }));

const promptFromOpenAiRequest = (init) => {
  const body = JSON.parse(init.body);
  return body.messages[0].content;
};

const groupForTitle = (title) => {
  const originalIndex = Number.parseInt(title.match(/Batch tab (\d+)/)?.[1] ?? "", 10);
  assert.ok(Number.isInteger(originalIndex), `test fixture title should include original tab index: ${title}`);
  return originalIndex % 2 === 0 ? "Dev" : "Research";
};

const installChunkAwareProviderFetch = () => {
  const calls = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    const prompt = promptFromOpenAiRequest(init);
    const tabLines = tabLinesFromPrompt(prompt);
    calls.push({ url, prompt, tabLines });

    const assignments = Object.fromEntries(
      tabLines.map((line) => [String(line.promptIndex), groupForTitle(line.title)])
    );

    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(assignments) } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
};

const installChunkAwareClusterFetch = () => {
  const calls = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    const prompt = promptFromOpenAiRequest(init);
    const tabLines = tabLinesFromPrompt(prompt);
    calls.push({ url, prompt, tabLines });

    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        groups: [{ name: "Batch Cluster", tabs: tabLines.map((line) => line.promptIndex) }],
        skipped: [],
      }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
};

const assertProviderRequestsWereChunked = (calls) => {
  const sizes = calls.map((call) => call.tabLines.length);
  assert.ok(
    calls.length >= Math.ceil(LARGE_TAB_COUNT / MAX_PROVIDER_TABS_PER_REQUEST),
    `expected provider batching for ${LARGE_TAB_COUNT} tabs; got ${calls.length} request(s) with chunk sizes ${sizes.join(", ")}`
  );
  assert.ok(
    sizes.every((size) => size > 0 && size <= MAX_PROVIDER_TABS_PER_REQUEST),
    `expected every provider prompt to contain 1-${MAX_PROVIDER_TABS_PER_REQUEST} tabs; got chunk sizes ${sizes.join(", ")}`
  );
  assert.ok(
    sizes.every((size) => size < LARGE_TAB_COUNT),
    `expected no provider prompt/request to contain all ${LARGE_TAB_COUNT} tabs; got chunk sizes ${sizes.join(", ")}`
  );
};

test("Given 300 ready-provider tabs When Plan Mode remote classification runs Then requests are chunked and merged by original tab", async () => {
  const tabs = makeTabs();
  const fetchHarness = installChunkAwareProviderFetch();

  try {
    const assignments = await classifyExistingGroupsRemoteBatch(tabs, rules, readyOpenAiSettings);

    assertProviderRequestsWereChunked(fetchHarness.calls);
    assert.equal(assignments.size, tabs.length);
    for (let idx = 0; idx < tabs.length; idx++) {
      assert.equal(assignments.get(idx), groupForTitle(tabs[idx].title), `tab ${idx} should keep its provider assignment after chunk merge`);
    }
  } finally {
    fetchHarness.restore();
  }
});

test("Given 300 ready-provider tabs When remote Pass 2 runs Then requests are chunked and merged without dropping originals", async () => {
  const tabs = makeTabs();
  const fetchHarness = installChunkAwareProviderFetch();

  try {
    const plan = await runPass2Remote(tabs, rules, readyOpenAiSettings);

    assertProviderRequestsWereChunked(fetchHarness.calls);
    assert.deepEqual(plan.skipped, []);
    assert.deepEqual(plan.newGroups, []);
    assert.equal(plan.assignedToExisting.length, tabs.length);

    const assignedByTab = new Map(plan.assignedToExisting.map((assignment) => [
      assignment.tabInfo,
      assignment.groupName,
    ]));
    for (const tab of tabs) {
      assert.equal(assignedByTab.get(tab), groupForTitle(tab.title), `${tab.title} should keep its provider assignment after chunk merge`);
    }
  } finally {
    fetchHarness.restore();
  }
});

test("Given 300 ready-provider tabs and no rules When remote Pass 2 clusters new groups Then requests are still chunked", async () => {
  const tabs = makeTabs();
  const fetchHarness = installChunkAwareClusterFetch();

  try {
    const plan = await runPass2Remote(tabs, [], readyOpenAiSettings);

    assertProviderRequestsWereChunked(fetchHarness.calls);
    assert.deepEqual(plan.assignedToExisting, []);
    assert.deepEqual(plan.skipped, []);
    assert.equal(plan.newGroups.length, 1);
    assert.equal(plan.newGroups[0].name, "Batch Cluster");
    assert.equal(plan.newGroups[0].tabs.length, tabs.length);
  } finally {
    fetchHarness.restore();
  }
});
