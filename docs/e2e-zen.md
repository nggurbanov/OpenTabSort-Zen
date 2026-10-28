# Development and real Zen verification

Use Node 20+ and run `npm run check` first. It runs repository validation, unit/regression tests, and retained-capability comparison.

Browser checks need an installed Zen binary and an existing Sine installation. The runners copy the Sine chrome engine into a fresh disposable profile; they do not clone history, cookies, or credentials. They leave the user's regular profile untouched and keep the browser content sandbox enabled.

Set `SINE_PROFILE` and `ZEN_BINARY` to the test host's real paths. Run software-development checks on the configured development host; headed settings checks also need a working display.

## Run the suites

```sh
npm run check
npm run benchmark -- 4a511d4
ZEN_BINARY=/path/to/zen SINE_PROFILE=/path/to/sine/profile npm run e2e:operations
ZEN_BINARY=/path/to/zen SINE_PROFILE=/path/to/sine/profile npm run e2e:settings
ZEN_BINARY=/path/to/zen SINE_PROFILE=/path/to/sine/profile npm run e2e:jev
```

| Command | Evidence |
| --- | --- |
| `e2e:operations` | Sine-loaded Stop, setting-change invalidation, native group/order/collapse Undo, and preview cancellation. |
| `e2e:settings` | Visible AI setup, provider-specific fields, consent/key masking, keyboard interaction, lazy Advanced, preserved saved data, and narrow/light/dark UI receipts. |
| `e2e:jev` | Decision sorting, bounded batches, completed-batch recovery, stale requests, category behavior, and optional preview integration. |
| `benchmark` | Static import closure and a synthetic controlled page-transfer fixture; no real browser heap/RSS measurement. |

`SETTINGS_QA_OUTPUT=/tmp/opentabsort-ui` selects the settings receipt/screenshot directory. The specialized Jev runner accepts `JEV_QA_SCREENSHOT` and optional `JEV_QA_SETTINGS=1`; the standalone settings suite provides the main setup coverage.

## Tab-count and identity checks

```sh
node scripts/e2e-zen.mjs --headed --scenario full-ai --tabs 300 \
  --zen-binary /path/to/zen --sine-profile /path/to/sine/profile \
  --quality-artifact /tmp/opentabsort-primary-300.json
node scripts/e2e-zen.mjs --headed --scenario all --tabs 300 \
  --zen-binary /path/to/zen --sine-profile /path/to/sine/profile \
  --quality-artifact /tmp/opentabsort-all-300.json
```

The runner's historical `full-ai` scenario now exercises the primary AI workspace action; `hybrid` explicitly exercises advanced sorting. The default localhost provider is deterministic and does not call a paid model. It checks fixture memberships, original tab identity, missing/duplicate assignments, native group creation, and actual Sine handler integration.

Use `node scripts/e2e-zen.mjs --help` for supported options. `--provider real` uses the runner's configured provider/proxy environment and requires a quality artifact. Do not describe a deterministic-provider score as real-model semantic accuracy.

The runners remove their lab profiles and terminate their own browser/server processes in cleanup. Receipts and screenshots outside the repository are local evidence artifacts and should be copied deliberately if they need long-term retention.

See [the overhaul verification record](overhaul-verification.md) for the dated results and their limits.
