const DEFAULT_ZEN_BINARY = "/Applications/Zen.app/Contents/MacOS/zen";

export const parseArgs = (argv) => {
  const options = {
    scenario: "all",
    provider: "fake",
    tabs: 120,
    headed: false,
    keepProfile: false,
    holdOpenMs: 0,
    qualityArtifact: process.env.ZEN_E2E_QUALITY_ARTIFACT || "",
    zenBinary: process.env.ZEN_BINARY || DEFAULT_ZEN_BINARY,
    sineProfile: process.env.SINE_PROFILE || "",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--headed") options.headed = true;
    else if (arg === "--keep-profile") options.keepProfile = true;
    else if (arg === "--hold-open-ms") options.holdOpenMs = Number.parseInt(argv[++i] || "", 10);
    else if (arg === "--scenario") options.scenario = argv[++i] || options.scenario;
    else if (arg === "--provider") options.provider = argv[++i] || options.provider;
    else if (arg === "--tabs") options.tabs = Number.parseInt(argv[++i] || "", 10);
    else if (arg === "--quality-artifact") options.qualityArtifact = argv[++i] || options.qualityArtifact;
    else if (arg === "--zen-binary") options.zenBinary = argv[++i] || options.zenBinary;
    else if (arg === "--sine-profile") options.sineProfile = argv[++i] || options.sineProfile;
    else if (arg === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.tabs) || options.tabs < 4) {
    throw new Error("--tabs must be an integer >= 4");
  }
  if (!Number.isInteger(options.holdOpenMs) || options.holdOpenMs < 0) {
    throw new Error("--hold-open-ms must be an integer >= 0");
  }
  if (!["fake", "real"].includes(options.provider)) {
    throw new Error("--provider must be fake or real");
  }
  if (!["all", "full-ai", "hybrid"].includes(options.scenario)) {
    throw new Error("--scenario must be all, full-ai, or hybrid");
  }
  if (options.provider === "real" && !options.qualityArtifact) {
    throw new Error("--quality-artifact is required when --provider real");
  }
  return options;
};

export const helpText = () => `Usage: node scripts/e2e-zen.mjs [options]

Options:
  --scenario <all|full-ai|hybrid>  Scenario to run (default: all)
  --provider <fake|real>            Provider harness mode (default: fake)
  --tabs <count>                   Tabs per scenario (default: 120)
  --quality-artifact <path>         Write redacted quality/provider metadata JSON
  --headed                         Launch a visible lab Zen window
  --hold-open-ms <ms>              Keep each lab Zen window open after success
  --keep-profile                   Keep the temporary profile after the run
  --zen-binary <path>              Zen binary path
  --sine-profile <path>            Existing Zen profile containing Sine chrome/
`;
