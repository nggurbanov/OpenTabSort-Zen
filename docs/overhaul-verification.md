# 2.0.0 overhaul verification

Status: unreleased working tree on `overhaul/efficiency-and-ux`, based on `4a511d4`. Checks ran on `dev-01` in disposable Zen/Sine profiles on 2026-10-28. No published release or changes to the user's normal Zen profile are implied.

This record separates native integration, deterministic fixture correctness, and synthetic work budgets. Reproduce with [the verification commands](e2e-zen.md).

## Repository checks

Final receipt: `/tmp/opentabsort-overhaul-final-check.log`. **`npm run check` passed: 254/254 tests, zero failures/cancellations/skips**, with manifest, preference, and security validation passing. Retained-capability comparison reported an empty `missingOldAdvantages` list.

## 300-tab native integration

Receipt: `/tmp/opentabsort-overhaul-aifirst-300.json`, generated **2026-10-28 03:46:44 UTC**.

| Scenario | Tabs grouped | Groups | Fixture F1/recall | Lost or duplicate identities |
| --- | ---: | ---: | ---: | ---: |
| Primary AI workspace action (`full-ai` runner label) | 300/300 | 10 | 1.0 / 1.0 | 0 |
| Retained advanced hybrid | 300/300 | 10 | 1.0 / 1.0 | 0 |

The primary fixture used one workspace-wide category suggestion request, followed by four classification requests of 75 tabs. All original tab identities were retained; duplicate membership and unknown identities were zero.

The provider was a deterministic localhost fixture. These scores prove integration with the fixture's prescribed grouping; they do not establish how well a real model groups arbitrary personal tabs.

## Stop, stale state, review, and Undo

Final receipt: `/tmp/opentabsort-overhaul-final-operations.log`.

The native operations runner passed Stop during an active provider request, relevant preference-change invalidation, native group/membership/order/collapse restoration through Undo, and preview cancellation. Repeating an identical sort retained stable native groups and the preceding Undo receipt. Stopping a follow-up sort also preserved the preceding Undo receipt. These cases exercised the Sine-loaded implementation in a disposable profile.

Unit/regression coverage additionally targets cancellation, assignment validation, placement failure/rollback, tab identity, settings lifecycle, and the distinction between the primary and advanced actions. The dated receipts are not a substitute for rerunning checks after later edits.

Decision receipt: `/tmp/opentabsort-overhaul-final-jev.log`. The 300-tab live fixture passed ten 30-tab batches and native Undo. Saved-category reuse, stopped/failed partial batches, manual-edit invalidation, preview cancellation, and edited preview acceptance passed. The primary Decision action generated fresh categories while leaving saved advanced categories byte-identical; Undo restored the prior layout. Providers were deterministic localhost fixtures.

## AI setup and settings

Receipt: `/tmp/opentabsort-simple-ui-final/metadata.json`, generated **2026-10-28 04:09:34 UTC**. Browser: **Zen 1.23.4b**, platform **158.0.1**.

Eight native checks passed:

- Unconfigured wand opened visible AI setup with Advanced closed and no rule/category editors.
- Provider-specific inputs masked API keys; consent and optional review started false.
- Native keyboard engine selection worked without a forced acknowledgement.
- The narrow connection form fit a 446 × 984 viewport without horizontal overflow.
- Decision setup exposed both connections without manual category maintenance.
- Advanced editors initialized only on expansion and retained saved rules.
- Saved-rule search retained focus and filtered the expected row.
- Reopening setup made zero provider requests and preserved saved rules.

Five screenshots cover unconfigured/light, configured/light, configured/dark, narrow/dark, and expanded Advanced states. They were inspected alongside the native DOM receipts. Screenshot paths are recorded in the metadata file; old README screenshots are not presented as the new interface.

## Static startup imports

Receipt: `/tmp/opentabsort-runtime-benchmark-final.json`, measured **2026-10-28 04:14:04 UTC** against `4a511d4`.

| Static source closure | Modules | Source bytes |
| --- | ---: | ---: |
| Baseline entry with eager imports | 35 | 409,898 |
| Current entry only | 2 | 10,436 |
| Current entry + browser runtime | 12 | 101,270 |
| Current entry + preferences runtime | 6 | 64,997 |

These counts describe reachable source files through static imports. Lazy AI engines, advanced editors, and user-opened dialogs are excluded until loaded. This is neither measured startup latency nor heap/RSS usage.

## Controlled page-context fixture

The same benchmark served **48 distinct 1 MiB bodies**, with controlled 64 KiB chunks and backpressure.

| Measurement | Baseline | Bounded reader |
| --- | ---: | ---: |
| Peak simultaneous requests | 48 | 6 |
| Transferred body bytes | 50,331,648 (48 MiB) | 12,582,912 (12 MiB) |
| Useful extracted snippets | 48 | 48 |
| Response bodies cancelled after prefix | 0 | 48 |

The configured limits are six workers, a 256 KiB HTML prefix per page, and a six-second context phase. This fixture demonstrates transfer/concurrency limits under controlled backpressure. Actual network buffering can vary. It does not establish a browser RSS reduction, and its elapsed times are not a real-site performance claim.

Page-context fetching remains relevant to built-in local and advanced sorting. The primary chat, Ollama, and Decision paths use tab metadata without page downloads.

## Remaining evidence boundary

Real-provider semantic quality, arbitrary personal workspaces, and long-running browser memory behavior are not established by these fixtures. A model comparison requires a labeled real-tab dataset and actual selected models; an RSS claim requires native process measurements under a repeatable workload.

The artifacts above are temporary files on the development host. The source includes reproducible runners; the receipts are not published release assets.
