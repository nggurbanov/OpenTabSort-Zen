# Real Zen verification

Run `npm run check` first. The browser runner needs an installed Zen binary and an existing Sine installation. It copies only the Sine chrome engine into a fresh disposable profile; it does not clone browsing history, cookies, or user credentials. Headed lab profiles mark the welcome screen as seen so fixture pages can load. The normal browser content sandbox stays enabled.

```sh
node scripts/e2e-zen.mjs --headed --scenario full-ai --tabs 120 \
  --sine-profile '/path/to/Zen/Sine/profile' --quality-artifact /tmp/zen-120.json
node scripts/e2e-zen.mjs --headed --scenario all --tabs 300 \
  --sine-profile '/path/to/Zen/Sine/profile' --quality-artifact /tmp/zen-300.json
```

The default deterministic provider runs on localhost and exercises the actual Sine-loaded handler, tab moves, and group creation. Its quality scores verify fixture memberships and identities; they do not measure the accuracy of a commercial model. `--provider real` uses the configured proxy environment and requires a quality artifact. See `node scripts/e2e-zen.mjs --help` and the runner’s provider configuration for supported environment variables.

On 2026-09-30, headed QA verified 120-tab Full AI and 300-tab Full AI/Hybrid runs: F1/recall 1.0, all original tab IDs retained, no duplicates. Additional real chrome scenarios verified consent (zero requests), authorization failure (one request), bounded invalid/missing assignment retries, repaired omissions, preview cancellation, rich rule/empty-list behavior, and stale-plan rejection. Actual Firefox `Mozilla/smart-tab-embedding` inference produced normalized 384-dimensional vectors and sorted same-host pages without provider requests or rule changes. Screenshots and JSON receipts were captured outside the repository; every task profile, browser, and localhost server was cleaned up.
