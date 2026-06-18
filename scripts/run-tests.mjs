import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const testArgs = args.length === 0 ? ["--test", "tests/*.test.mjs"] : ["--test", ...args];
const result = spawnSync(process.execPath, testArgs, { stdio: "inherit" });

process.exitCode = result.status ?? 1;
