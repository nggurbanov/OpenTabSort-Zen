import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertConnectedProfile, delay, driveZenScenario, launchZen, stopZen } from "./zen-e2e-driver.mjs";
import { createSemanticFixture } from "./zen-e2e-fixtures.mjs";
import { MarionetteClient, reserveTcpPort } from "./zen-e2e-marionette.mjs";
import {
  createLabProfile,
  findDefaultSineProfile,
  removeLabProfile,
  scenarioPrefs,
  writeUserPrefs,
} from "./zen-e2e-profile.mjs";
import { scoreZenQuality } from "./zen-e2e-quality.mjs";
import { startFixturePageServer, startProviderServer } from "./zen-e2e-servers.mjs";
export { helpText, parseArgs } from "./zen-e2e-options.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const runZenE2E = async (options) => {
  const sineProfile = options.sineProfile || await findDefaultSineProfile();
  const scenarios = options.scenario === "all" ? ["full-ai", "hybrid"] : [options.scenario];
  const results = [];

  for (const scenario of scenarios) {
    results.push(await runScenario({ options, scenario, sineProfile }));
  }

  if (options.qualityArtifact) await writeQualityArtifact(options, results);
  const failedQuality = results.find((result) => !result.quality.pass);
  if (failedQuality) {
    throw new Error(`Zen E2E quality failed for ${failedQuality.scenario}; artifact: ${options.qualityArtifact || "not written"}`);
  }
  return results;
};

const runScenario = async ({ options, scenario, sineProfile }) => {
  const lab = await createLabProfile(REPO_ROOT, sineProfile);
  let pages = null;
  let provider = null;

  try {
    pages = await startFixturePageServer();
    const fixture = createSemanticFixture(options.tabs, pages.port);
    provider = await startProviderServer(options.provider);
    const marionettePort = await reserveTcpPort();
    const prefs = scenarioPrefs({ scenario, providerPort: provider.port, marionettePort });
    await writeUserPrefs(lab.profileDir, prefs);
    return await runLaunchedScenario({ options, scenario, lab, provider, fixture, marionettePort });
  } finally {
    if (provider) await provider.close();
    if (pages) await pages.close();
    if (!options.keepProfile) await removeLabProfile(lab.profileDir);
  }
};

const runLaunchedScenario = async ({ options, scenario, lab, provider, fixture, marionettePort }) => {
  const zen = launchZen({ options, profileDir: lab.profileDir, marionettePort });
  const marionette = await MarionetteClient.connect(marionettePort);
  try {
    await marionette.newSession();
    await marionette.setScriptTimeout();
    await marionette.setChromeContext();
    await assertConnectedProfile(marionette, lab.profileDir);
    const state = await driveZenScenario(marionette, {
      name: scenario,
      tabs: fixture.tabs,
    });
    const quality = scoreZenQuality({
      tabCount: options.tabs,
      goldTabs: fixture.goldTabs,
      predictedGroups: state.predictedGroups.map((group) => ({
        label: group.label,
        tabs: group.tabs.map((tab) => tab.id).filter(Boolean),
      })),
    });
    const result = {
      scenario,
      profileDir: lab.profileDir,
      providerCalls: provider.calls.length,
      providerBatchSizes: provider.calls.map((call) => call.tabCount),
      providerCallMetadata: provider.calls,
      quality,
      state,
    };
    if (options.holdOpenMs > 0) await delay(options.holdOpenMs);
    return result;
  } catch (error) {
    throw scenarioError(error, scenario, lab.profileDir, provider, zen);
  } finally {
    marionette.close();
    await stopZen(zen);
  }
};

const scenarioError = (error, scenario, profileDir, provider, zen) => {
  const detail = {
    scenario,
    profileDir,
    providerBatchSizes: provider.calls.map((call) => call.tabCount),
    zenLogTail: zen.e2eLogTail(),
  };
  return new Error(`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(detail, null, 2)}`);
};

const writeQualityArtifact = async (options, results) => {
  const artifact = {
    generatedAt: new Date().toISOString(),
    provider: options.provider,
    tabCount: options.tabs,
    scenarios: results.map((result) => ({
      scenario: result.scenario,
      quality: result.quality,
      providerCalls: result.providerCallMetadata,
      groups: result.state.predictedGroups.map((group) => ({
        label: group.label,
        tabs: group.tabs.map((tab) => tab.id).filter(Boolean),
      })),
    })),
  };
  const text = JSON.stringify(artifact, null, 2);
  assertNoSecretLeak(text);
  await mkdir(dirname(options.qualityArtifact), { recursive: true });
  await writeFile(options.qualityArtifact, `${text}\n`, "utf8");
};

const assertNoSecretLeak = (text) => {
  const apiKey = process.env.OPENROUTER_API_KEY || "";
  if (apiKey && text.includes(apiKey)) throw new Error("Refusing to write quality artifact containing OPENROUTER_API_KEY");
};
