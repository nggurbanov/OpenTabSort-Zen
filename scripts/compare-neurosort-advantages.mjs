// Portable compatibility gate for the capabilities retained from the fork.
// No other repository checkout or personal filesystem path is required.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPass2Remote, runPass2RemoteFresh, classifyExistingGroupsRemoteBatch } from "../modules/remote-provider.mjs";
import { resolveSortingPlan, resolvePass2ApplyOptions } from "../modules/sorting-mode.mjs";

export const compareNeuroSortAdvantages = async (rootDir = process.cwd()) => {
  const preferences = JSON.parse(readFileSync(resolve(rootDir, "preferences.json"), "utf8"));
  const engines = preferences.find((entry) => entry.property === "extensions.zen-auto-organize.ai-engine")?.options.map((option) => option.value) || [];
  const tabs = [{ hostname: "example.test", title: "Tab", url: "" }];
  const rules = [{ name: "Reading", domains: ["example.test"] }];
  let fetches = 0;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetches++; throw new Error("No request is permitted without consent"); };
  try {
    const settings = { provider: "custom", consentToSendData: false, endpoint: "https://example.test/v1", model: "tabs", format: "openai" };
    await runPass2Remote(tabs, rules, settings);
    await runPass2RemoteFresh(tabs, settings);
    await classifyExistingGroupsRemoteBatch(tabs, rules, settings);
  } finally { globalThis.fetch = savedFetch; }
  const plan = resolveSortingPlan({ mode: "full-ai", tabs, pass1: { byGroup: new Map([["Reading", tabs]]), unmatched: [] } });
  const checks = [
    { name: "all provider choices retained", ok: ["off", "local", "ollama", "openai", "gemini", "custom"].every((engine) => engines.includes(engine)) },
    { name: "remote consent gates every entry point", ok: fetches === 0 },
    { name: "Full AI bypasses deterministic rules", ok: !plan.shouldApplyPass1 && plan.tabsForAI === tabs },
    { name: "Full AI disables persistence", ok: resolvePass2ApplyOptions("full-ai").persistRules === false },
  ];
  return { checks, missingOldAdvantages: checks.filter((check) => !check.ok).map((check) => check.name) };
};
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await compareNeuroSortAdvantages();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.missingOldAdvantages.length ? 1 : 0;
}
