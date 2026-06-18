import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scripts = [
  "validate-manifest.mjs",
  "validate-preferences.mjs",
  "validate-security.mjs",
];

export const runValidators = (rootDir = process.cwd()) => {
  const failures = [];

  for (const script of scripts) {
    const result = spawnSync(process.execPath, [`scripts/${script}`], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: "inherit",
    });

    if (result.status !== 0) {
      failures.push(script);
    }
  }

  return failures;
};

const isCli = process.argv[1] === fileURLToPath(import.meta.url);

if (isCli) {
  const failures = runValidators();
  if (failures.length > 0) {
    console.error(`validate: FAIL ${failures.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("validate: PASS manifest, preferences, security");
  }
}
