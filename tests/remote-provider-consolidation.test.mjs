import test from "node:test";
import assert from "node:assert/strict";

import { runPass2Remote, runPass2RemoteFresh } from "../modules/remote-provider.mjs";

test("Given hybrid remote Pass 2 returns synonymous new labels When merge provider consolidates them Then existing assignments stay intact", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const prompt = JSON.parse(init.body).messages[0].content;
    const isMergePrompt = prompt.includes("Categories to review");
    calls.push(isMergePrompt ? "merge" : "classify");
    const assignments = isMergePrompt
      ? {
          "Work Management": "Work",
          "Project Management": "Work",
          "Planning & Tasks": "Planning",
        }
      : {
          0: "Dev",
          1: "Work Management",
          2: "Project Management",
          3: "Planning & Tasks",
        };
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(assignments) } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const tabs = [
      { hostname: "github.com", title: "Pull request", url: "" },
      { hostname: "linear.app", title: "Roadmap", url: "" },
      { hostname: "jira.example.test", title: "Sprint board", url: "" },
      { hostname: "todoist.com", title: "Packing tasks", url: "" },
    ];
    const plan = await runPass2Remote(tabs, [{ name: "Dev", domains: ["github.com"] }], {
      provider: "openai",
      consentToSendData: true,
      endpoint: "https://api.example.test/v1",
      apiKey: "sk-test",
      model: "gpt-tabs",
    });

    const groupsByName = new Map(plan.newGroups.map((group) => [group.name, group.tabs]));
    assert.deepEqual(calls, ["classify", "merge"]);
    assert.deepEqual(plan.assignedToExisting, [{ tabInfo: tabs[0], groupName: "Dev", similarity: 1 }]);
    assert.deepEqual([...groupsByName.keys()].sort(), ["Planning", "Work"]);
    assert.deepEqual(groupsByName.get("Work"), [tabs[1], tabs[2]]);
    assert.deepEqual(groupsByName.get("Planning"), [tabs[3]]);
    assert.deepEqual(plan.skipped, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Given hybrid remote Pass 2 has a large unmatched batch When provider is called Then it uses the large JSON token budget", async () => {
  const originalFetch = globalThis.fetch;
  const maxTokens = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    maxTokens.push(body.max_tokens);
    const prompt = body.messages[0].content;
    const tabLines = [...prompt.matchAll(/^(\d+)\. ([^\n]+?) — "([^"]*)"/gm)];
    const assignments = Object.fromEntries(tabLines.map((match) => [match[1], "Research"]));
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(assignments) } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const tabs = Array.from({ length: 72 }, (_, index) => ({
      hostname: `research-${index}.example.test`,
      title: `Research tab ${index}`,
      url: "",
    }));
    await runPass2Remote(tabs, [{ name: "Dev", domains: ["github.com"] }], {
      provider: "openai",
      consentToSendData: true,
      endpoint: "https://api.example.test/v1",
      apiKey: "sk-test",
      model: "gpt-tabs",
    });

    assert.deepEqual(maxTokens, [4096]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Given full AI remote chunk omits tabs When retry runs Then missing tabs are sorted by smaller batches", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const prompt = JSON.parse(init.body).messages[0].content;
    const isMergePrompt = prompt.includes("Categories to review");
    if (isMergePrompt) {
      calls.push("merge");
      return providerResponse({ Work: "Work", Planning: "Planning" });
    }
    const tabLines = [...prompt.matchAll(/^(\d+)\. ([^\n]+?) — "([^"]*)"/gm)];
    calls.push(tabLines.length);
    const assignments = tabLines.length === 4
      ? { 0: "Work", 1: "Work" }
      : Object.fromEntries(tabLines.map((match) => [match[1], "Planning"]));
    return providerResponse(assignments);
  };

  try {
    const tabs = [
      { hostname: "linear.app", title: "Roadmap", url: "" },
      { hostname: "jira.example.test", title: "Sprint board", url: "" },
      { hostname: "calendar.google.com", title: "Trip dates", url: "" },
      { hostname: "todoist.com", title: "Packing tasks", url: "" },
    ];
    const plan = await runPass2RemoteFresh(tabs, {
      provider: "openai",
      consentToSendData: true,
      endpoint: "https://api.example.test/v1",
      apiKey: "sk-test",
      model: "gpt-tabs",
    });

    const groupsByName = new Map(plan.newGroups.map((group) => [group.name, group.tabs]));
    assert.deepEqual(calls, [4, 2, "merge"]);
    assert.deepEqual(groupsByName.get("Work"), [tabs[0], tabs[1]]);
    assert.deepEqual(groupsByName.get("Planning"), [tabs[2], tabs[3]]);
    assert.deepEqual(plan.skipped, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Given full AI remote chunks return synonymous labels When merge provider consolidates them Then all tabs move into broader groups", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const prompt = JSON.parse(init.body).messages[0].content;
    const isMergePrompt = prompt.includes("Categories to review");
    calls.push(isMergePrompt ? "merge" : "fresh");
    const assignments = isMergePrompt
      ? {
          Work: "Work",
          "Work Management": "Work",
          Planning: "Planning",
          "Planning & Tasks": "Planning",
        }
      : {
          0: "Work",
          1: "Work Management",
          2: "Planning",
          3: "Planning & Tasks",
        };
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(assignments) } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const tabs = [
      { hostname: "linear.app", title: "Roadmap", url: "" },
      { hostname: "jira.example.test", title: "Sprint board", url: "" },
      { hostname: "calendar.google.com", title: "Trip dates", url: "" },
      { hostname: "todoist.com", title: "Packing tasks", url: "" },
    ];
    const plan = await runPass2RemoteFresh(tabs, {
      provider: "openai",
      consentToSendData: true,
      endpoint: "https://api.example.test/v1",
      apiKey: "sk-test",
      model: "gpt-tabs",
    });

    const groupsByName = new Map(plan.newGroups.map((group) => [group.name, group.tabs]));
    assert.deepEqual(calls, ["fresh", "merge"]);
    assert.deepEqual([...groupsByName.keys()].sort(), ["Planning", "Work"]);
    assert.deepEqual(groupsByName.get("Work"), [tabs[0], tabs[1]]);
    assert.deepEqual(groupsByName.get("Planning"), [tabs[2], tabs[3]]);
    assert.deepEqual(plan.skipped, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const providerResponse = (assignments) => new Response(JSON.stringify({
  choices: [{ message: { content: JSON.stringify(assignments) } }],
}), { status: 200, headers: { "content-type": "application/json" } });
