#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import { helpText, parseArgs, runZenE2E } from "./zen-e2e-harness.mjs";

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }

  const results = await runZenE2E(options);
  for (const result of results) {
    console.log(JSON.stringify({
      scenario: result.scenario,
      profileDir: result.profileDir,
      providerCalls: result.providerCalls,
      providerBatchSizes: result.providerBatchSizes,
      quality: result.quality,
      groups: result.state.groups,
      groupedTabs: result.state.groupedTabs,
    }));
  }
};

const isCli = process.argv[1] === fileURLToPath(import.meta.url);

if (isCli) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
