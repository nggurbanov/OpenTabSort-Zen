import test from "node:test";
import assert from "node:assert/strict";

import { buildFreshPrompt, buildMergePrompt, buildUnifiedPrompt } from "../modules/ollama-prompts.mjs";

const tabs = [
  { hostname: "docs.google.com", title: "Project spec", url: "" },
  { hostname: "arxiv.org", title: "Attention paper", url: "" },
  { hostname: "linear.app", title: "Sprint board", url: "" },
  { hostname: "amazon.com", title: "USB-C hub", url: "" },
  { hostname: "chase.com", title: "Credit card", url: "" },
  { hostname: "calendar.google.com", title: "Vacation plan", url: "" },
  { hostname: "mail.google.com", title: "Inbox", url: "" },
  { hostname: "youtube.com", title: "Architecture talk", url: "" },
  { hostname: "about:preferences", title: "Settings", url: "" },
];

const snippets = [
  "[type: document] [site: Google Docs] [topic: Project spec]",
  "[type: article] [site: arXiv] [topic: Attention paper]",
  "[type: website] [site: Linear] [topic: Sprint board]",
  "[type: product] [site: Amazon] [topic: USB-C hub]",
  "[type: account] [site: Chase] [topic: Credit card]",
  "[type: calendar] [site: Google Calendar] [topic: Vacation plan]",
  "[type: inbox] [site: Gmail] [topic: Inbox]",
  "[type: video] [site: YouTube] [topic: Architecture talk]",
  "[type: browser] [site: Zen] [topic: Settings]",
];

const existingRules = [
  { name: "Docs", domains: ["docs.google.com"] },
  { name: "Research", domains: ["arxiv.org"] },
  { name: "Work", domains: ["linear.app"] },
];

const promptBuilders = [
  ["unified", () => buildUnifiedPrompt(existingRules, tabs, snippets)],
  ["fresh", () => buildFreshPrompt(tabs, snippets)],
];

const assertMentionsAll = (prompt, words, context) => {
  const lowerPrompt = prompt.toLowerCase();
  for (const word of words) {
    assert.match(lowerPrompt, new RegExp(`\\b${word}\\b`, "u"), `${context} should mention ${word}`);
  }
};

for (const [mode, buildPrompt] of promptBuilders) {
  test(`Given ${mode} real-provider prompt When built Then it separates adjacent intent families`, () => {
    const prompt = buildPrompt();

    assertMentionsAll(prompt, ["docs", "research", "work"], "docs vs research vs work guardrail");
    assertMentionsAll(prompt, ["shopping", "finance", "planning"], "shopping vs finance vs planning guardrail");
    assertMentionsAll(prompt, ["communication", "media"], "communication and media guardrail");
    assertMentionsAll(prompt, ["internal", "tools"], "internal tools guardrail");
  });

  test(`Given ${mode} real-provider prompt When built Then it pins stable bucket count and raw JSON map contract`, () => {
    const prompt = buildPrompt();

    assert.match(prompt, /\b4-10\b/u);
    assert.match(prompt, /raw JSON only/iu);
    assert.match(prompt, /mapping EVERY tab number/iu);
    assert.match(prompt, /string key/iu);
    assert.match(prompt, /Do not omit any tab/iu);
    assert.doesNotMatch(prompt, /```/u);
  });
}

test("Given merge prompt When built Then it keeps broad stable buckets without collapsing adjacent families", () => {
  const prompt = buildMergePrompt([
    { name: "Docs", tabs: [tabs[0]] },
    { name: "Research & Reference", tabs: [tabs[1]] },
    { name: "Work Management", tabs: [tabs[2]] },
    { name: "Shopping", tabs: [tabs[3]] },
    { name: "Finance & Billing", tabs: [tabs[4]] },
    { name: "Planning & Tasks", tabs: [tabs[5]] },
    { name: "Communication", tabs: [tabs[6]] },
    { name: "Media", tabs: [tabs[7]] },
    { name: "Developer Tools", tabs: [tabs[8]] },
  ]);

  assert.match(prompt, /\b4-10\b/u);
  assert.doesNotMatch(prompt, /\b3-5\b/u);
  assertMentionsAll(prompt, ["docs", "research", "work"], "docs vs research vs work guardrail");
  assertMentionsAll(prompt, ["shopping", "finance", "planning"], "shopping vs finance vs planning guardrail");
  assertMentionsAll(prompt, ["communication", "media"], "communication and media guardrail");
  assertMentionsAll(prompt, ["internal", "tools"], "internal tools guardrail");
});

test("Given merge prompt When built Then it names observed chunk alias families", () => {
  const prompt = buildMergePrompt([
    { name: "Alpha", tabs: [{ hostname: "alpha.example.test", title: "Alpha" }] },
    { name: "Beta", tabs: [{ hostname: "beta.example.test", title: "Beta" }] },
  ]);

  assert.match(prompt, /Work Management.*Project Management/isu);
  assert.match(prompt, /Planning & Tasks.*Planning & Scheduling/isu);
  assert.match(prompt, /Developer Tools.*Admin & Tools.*Admin & Settings/isu);
});
