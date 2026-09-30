# Real Zen verification

Run `npm run check` first. The browser runner needs an installed Zen binary and an existing Sine installation. It copies only the Sine chrome engine into a fresh disposable profile; it does not clone browsing history, cookies, or user credentials. Headed lab profiles mark the welcome screen as seen so fixture pages can load. The normal browser content sandbox stays enabled.

`npm run e2e:jev` exercises the actual Sine-loaded Jev flow in a disposable headed Zen profile. It uses local deterministic category and decision servers, redirects only Jev requests inside the lab window, and never calls a paid model. It verifies 300 tabs in ten batches, automatic mode, category reuse, native group/order/collapse restoration, cancellation, partial request failure, stale-batch protection, and optional preview editing/cancellation. `SINE_PROFILE` and `ZEN_BINARY` override discovery; `JEV_QA_SCREENSHOT=/tmp/jev.png` captures the result panel. Set `JEV_QA_SETTINGS=1` to additionally open the native settings page and verify its controls; this optional check could not complete in the current sandbox because Zen exited while opening content. These checks verify integration behavior, not live model accuracy.

```sh
node scripts/e2e-zen.mjs --headed --scenario full-ai --tabs 120 \
  --sine-profile '/path/to/Zen/Sine/profile' --quality-artifact /tmp/zen-120.json
node scripts/e2e-zen.mjs --headed --scenario all --tabs 300 \
  --sine-profile '/path/to/Zen/Sine/profile' --quality-artifact /tmp/zen-300.json
```

The default deterministic provider runs on localhost and exercises the actual Sine-loaded handler, tab moves, and group creation. Its quality scores verify fixture memberships and identities; they do not measure the accuracy of a commercial model. `--provider real` uses the configured proxy environment and requires a quality artifact. See `node scripts/e2e-zen.mjs --help` and the runner’s provider configuration for supported environment variables.

On 2026-09-30, headed QA verified 120-tab Full AI and 300-tab Full AI/Hybrid runs: F1/recall 1.0, all original tab IDs retained, no duplicates. Additional real chrome scenarios verified consent (zero requests), authorization failure (one request), bounded invalid/missing assignment retries, repaired omissions, preview cancellation, rich rule/empty-list behavior, and stale-plan rejection. Actual Firefox `Mozilla/smart-tab-embedding` inference produced normalized 384-dimensional vectors and sorted same-host pages without provider requests or rule changes. Screenshots and JSON receipts were captured outside the repository; every task profile, browser, and localhost server was cleaned up.
