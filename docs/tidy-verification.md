# Tidy interaction verification — 2026-10-28

Verified source update: **2.0.2**, including the 2.0.1 Tidy changes, in the `OpenTabSort-Zen` repository on `fix/tidy-interaction`. This is a dated follow-up; [the 2.0.0 verification record](overhaul-verification.md) remains historical.

> Historical 2.0.2 record. A later user report reproduced the short-answer failure label despite the raised cap. The cap alone is not a reliability fix; [2.0.3 adds bounded automatic recovery](output-recovery-verification.md).

## Resulting behavior

- A transparent native sidebar toolbar row, 32px high and outside the scrolling tab list, provides short status and contextual Stop, Undo, or Setup. The full message remains in the tooltip and accessible label. Essential styles are injected before the row appears.
- Successful feedback dismisses after five seconds, pausing while hovered or keyboard-focused. Dismissing the row retains a valid session Undo receipt. Errors requiring setup remain actionable.
- Normal chat/Ollama inventories of up to 300 tabs use one grouping request with a 72 KiB UTF-8 prompt limit. Larger or exceptionally large-name inventories keep the global-taxonomy and bounded-classification path.
- Optional placement motion lasts 260ms and covers at most 40 visible rows. It starts after native placement, adds no artificial wait, and respects reduced motion. Original tab objects and browsing state are retained.

## Native Zen evidence

The following read-backs were captured on `dev-01` with portable **Zen 1.23.4b / Gecko 158.0.1**, Sine, and disposable profiles. The everyday browser profile was not modified.

| Check | Observed result | Remote receipt |
| --- | --- | --- |
| 300-tab primary grouping, deterministic provider | One request, 41,199 request bytes; 10 groups, 300 grouped tabs; zero missing, duplicate, or unknown identities; fixture F1/recall/purity 1.0. | `/tmp/opentabsort-tidy-300.json`, generated 04:44:19 UTC |
| Stop and settings invalidation | First in-flight request stops; layout remains unchanged. | `/tmp/opentabsort-tidy-final-operations.log` |
| Repeated sort and Undo | Identical second sort preserves stable groups and prior Undo; stopped follow-up preserves Undo; Undo restores identities, membership, order, and original collapse state. | `/tmp/opentabsort-tidy-final-operations.log` |
| Optional preview | Focus and exact unchanged-tab count survive interaction; Cancel moves nothing. | `/tmp/opentabsort-tidy-final-operations.log` |
| Native row, light/dark/narrow | Sidebar placement is 32px high, transparent, and without horizontal overflow; narrow busy/error rows fit within 158px. Enter activates Stop; Setup and Escape work. | `/tmp/opentabsort-tidy-ui/metadata.json`, captured 04:51:32 UTC |
| Feedback lifetime and reduced motion | Focus pauses dismissal; native Undo still works after visual dismissal; reduced motion disables the busy animation. | `/tmp/opentabsort-tidy-ui/metadata.json` |
| Actual placement animation | Seven live `tab-stack` translation effects observed at 260ms; original identities and selected tab preserved. The implementation and regressions bound the maximum to 40. | `/tmp/opentabsort-tidy-motion-native.json` |

These are runner read-backs, not screenshots standing in for functional checks. The UI screenshots establish geometry and theme behavior, not the cause of an earlier provider failure. The UI capture precedes the final short-label wording (`300 tabs tidy`, `AI offline`); full messages remain accessible.

## Configured-model output budget

A bounded synthetic 300-tab prompt was sent through the existing configured OpenRouter connection using **`liquid/lfm-2.5-24b-a2b`**. The model's metadata reported mandatory reasoning. Both probes used the same synthetic prompt; they did not replay the user's private workspace. No credentials were copied into the repository or receipts.

| Output cap | HTTP | Finish reason | Answer text | Groups / unique assigned / unresolved | Elapsed |
| --- | --- | --- | --- | --- | --- |
| 4096 tokens | 200 | `length` | Empty (`content: null`) | No usable plan | 8.72s |
| 8192 tokens | 200 | `stop` | Valid JSON | 10 / 300 / 0 | 14.19s |

Sanitized receipts: `/tmp/opentabsort-live-provider-budget-check.json` records both requests, finish reasons, timing, and usage; `/tmp/opentabsort-fast-provider-8192-response.json` contains only synthetic response text. `/tmp/opentabsort-live-provider-plan-replay.json` verifies that the actual planner and plan validator accept all 300 unique tab assignments with zero unresolved entries.

OpenRouter documents that reasoning and visible answers usually share the output budget, so an exhausted limit can return no answer text even with HTTP 200. Its model metadata identifies mandatory reasoning; disabling it is unsupported for those models. [OpenRouter reasoning documentation](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

The primary planner now permits 8192 output tokens and distinguishes truncated/empty output from successful grouping. It does not automatically disable mandatory reasoning. The experiment reproduces an output-budget failure with the configured model on synthetic data; it does not establish the exact cause of the user's original failed run. The successful 14.19s result is one model/request observation, not an instant-response or latency guarantee.

## Automated coverage and limits

Final `npm run check` passed **324/324 tests**, zero failures, with manifest, preferences, security, and retained-capability validation passing. Receipt: `/tmp/opentabsort-tidy-final-check.log`.

Final Decision-engine native acceptance also passed: 300-tab batches, partial Stop/authentication recovery, manual-edit refusal, category review, primary category preservation, and Undo. Receipt: `/tmp/opentabsort-tidy-final-jev.log`. An Undo-refusal regression now updates the existing feedback without discarding its controls or focus.

Final primary screenshot: `/tmp/opentabsort-tidy-primary.png`, with geometry in the adjacent `.json`: actual 32px native row, short `120 tabs tidy` label, and no row/status overflow after a real sort. The final gate also checks viewport visibility after native automatic scrolling. Set `OPERATIONS_QA_SCREENSHOT` when running `e2e:operations` to reproduce this capture.

`npm run check` covers the planner's one-request identity accounting, UTF-8 prompt bounds, existing-name reuse, consent/privacy, malformed output, conflicting and omitted indices, provider failure without full-request retries, cancellation, and the larger-inventory path. Follow-up regressions also cover operation-row cleanup and lifetime, retained Undo, bounded/reduced-motion placement effects, provider JSON response forms, and actionable failure labels.

Deterministic fixture quality verifies application and identity behavior against known families. The live synthetic probe establishes usable output and complete identity coverage for that prompt, not general semantic quality across real browsing sessions. Long-session RAM/RSS, provider availability, cost under repeated use, and the user's private-workspace grouping quality remain unmeasured. Verification does not install, publish, or release 2.0.1.
