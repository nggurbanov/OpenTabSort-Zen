# Output-limit recovery verification — 2026-10-28

Source version: **2.0.3**, repository **OpenTabSort-Zen**. Follow-up to the user's `AI reply cut short` screenshot on installed 2.0.2. The earlier 8192-token successful observation was insufficient to establish reliability. The configured model at this read-back was `inception/mercury-3`; the prior LFM experiment is historical.

> Later 2.0.4 policy: verified Mercury 3 on OpenRouter receives a 65536-token ceiling; the recovery protocol and the dated 2.0.3 measurements below remain unchanged. See [architecture](architecture.md) for exact model/endpoint scope.

## Behavior

Fast successful grouping stays one request. Only an explicit provider output-limit stop initiates recovery through a compact shared taxonomy and initially 50-tab batches. A truncated batch shrinks immediately. No native changes occur during planning. Failed recovery discards every intermediate assignment; Stop aborts the active request. Request/time ceilings prevent an unbounded retry cascade. Details are in [architecture](architecture.md).

## Native acceptance

`npm run e2e:recovery` passed on dev-01 with portable Zen 1.23.4b, Sine, a disposable profile, 300 synthetic fixture tabs, and a deterministic local provider:

- Forced HTTP 200 `finish_reason: length`, `content: null`: 8 total requests, comprising the failed initial request, one taxonomy, and six batches of 50.
- All 300 original native tab references and URLs preserved in the expected 10 semantic groups.
- Undo restored original tab order, group membership/label/color/collapse, and selected tab.
- HTTP 401 after a successful 50-tab classification: 4 requests, the entire original layout unchanged.
- Stop during the first held recovery classification: 3 requests, server-observed HTTP cancellation, no subsequent requests or native changes.

Final receipts on dev-01: `/tmp/opentabsort-output-recovery-native-final.json` and `/tmp/opentabsort-output-recovery-native-final.log`. This checks actual native tab references, not reconstructed URLs standing in for identity.

## Configured-provider probe

Read-only configuration inspection found installed 2.0.2 using OpenRouter and `inception/mercury-3`. A bounded 300-tab synthetic fast request with the same 8192 cap completed normally in 9.08 seconds with 300 unique assignments and zero unresolved tabs. The exact private-workspace failure was not reproduced.

The actual recovery prompts were then generated on dev-01. Seven requests through the existing configured connection returned one taxonomy and six classification answers: every response stopped normally, 4080 completion tokens in total, 12.99 seconds summed request time. Replaying the raw envelopes through the real provider parser, planner, and validator after an injected initial length stop yielded 300 unique original references, 10 groups of 30, and zero unresolved tabs.

The initial recovery trigger was forced; these measurements are one synthetic model observation, not a guarantee for the user's workspace or future provider behavior. The requests contained synthetic titles/paths only. Credentials stayed in memory on the Mac control plane and were not copied to dev-01, source, or receipts. The daily browser profile was not changed or restarted.

Safe receipts: `/tmp/opentabsort-mercury-8192-probe.json`, `/tmp/opentabsort-recovery-live-usage.json`, and `/tmp/opentabsort-recovery-live-verified.json` (last on dev-01). Development edits and tests ran on dev-01.

## Regression coverage

Final `npm run check`: **363/363 tests passed**, zero failures; manifest, preferences, security, and retained-capability checks passed. Receipt: `/tmp/opentabsort-recovery-final-check.log`.

The automated suite covers real OpenAI/Gemini/custom/Ollama length envelopes, immediate batch shrinking with original identities, global taxonomy reduction, multilingual byte bounds including unsolicited examples, taxonomy/classification truncation above 300 tabs, atomic later failures, explicit unresolved tabs, request exhaustion, actual fetch abortion at the deadline, the longer Ollama allowance, cancellation in both recovery phases, and terminal failures that never initiate recovery. The native runner uses no production credentials.


## 2.0.4 Mercury output ceiling follow-up

The user approved a 65536-token Mercury ceiling. OpenRouter's public filtered model catalog checked on 2026-10-28 confirmed Mercury 3's 131072-token output maximum and LFM 2.5's 8192-token maximum. The request builder and workspace planner now preserve 65536 for verified Mercury IDs on the OpenRouter chat endpoint; unknown models/providers retain 8192. This policy has no runtime catalog fetch, provider switch, preference write, or extra setup UI.

`npm run check` passed **368/368 tests** with zero failures, including the Mercury wire budget, compatible lower limits, one-request accounting, and typed-limit recovery. Receipt: `/tmp/opentabsort-mercury-budget-full-check.log`. Independent source review found no blocking regressions.

A bounded live request generated by the actual request builder sent 300 synthetic fixture tabs to Mercury 3 with `max_tokens: 65536`. It completed with `finish_reason: stop` in **16.45 seconds**, using **7659 completion tokens**, including **6910 reasoning tokens**. The answer contained seven groups, 300 unique assigned indices, and zero unresolved indices. Replaying the raw provider envelope through the real transport, planner, and validator retained all 300 original references in one request. This establishes request acceptance and assignment integrity for one synthetic observation; it is not a grouping-quality or latency improvement benchmark.

The existing OpenRouter connection/key was used in memory on the Mac control plane, with no private tab data or preference changes. The configured model had changed back to LFM during this work; the approved Mercury probe explicitly selected Mercury without changing that preference. Development and replay tests ran on dev-01. Safe receipts: `/tmp/opentabsort-output-limits-2026-10-28.json`, `/tmp/opentabsort-mercury-64k-probe.json`, `/tmp/opentabsort-mercury-64k-plan-replay.json`.
