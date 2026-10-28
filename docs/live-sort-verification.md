# Browsing during sorting verification — 2026-10-28

Source target: **2.0.5**, repository **OpenTabSort-Zen**. This follow-up addresses the user report that ordinary browsing produced `Tabs or settings changed` and discarded the entire pending sort. Earlier verification records describe their dated versions; they do not establish this follow-up's acceptance.

## Resulting contract

The primary wand plans from the initial metadata snapshot while the browser remains usable. Background title/favicon/loading updates and additions or closures do not cancel unaffected work. Added tabs remain outside the operation. Reconciliation uses original native references and current eligibility to protect closed, navigated, pinned, manually moved or regrouped tabs and renamed/moved groups before applying the remaining assignments.

A workspace switch or change to the selected AI setup still stops pending work. Feedback identifies that reason concisely and offers Retry; revoked metadata consent offers Setup. Unused-provider preferences and preserved Advanced rules/categories do not invalidate primary work.

The Undo baseline is captured immediately before native application. Browsing and manual edits made during planning therefore remain part of the state Undo restores. Title-only changes after a sort do not invalidate a receipt; conflicting later layout changes still do. Stop during any primary planner, including Decision, applies nothing.

## Completed native Decision acceptance

Executed on **dev-01**, with portable **Zen 1.23.4b**, Sine, Xvfb and a disposable profile. The runner created 300 synthetic fixture tabs and used deterministic local HTTP providers. No paid model or production credentials were used, and the daily browser profile was not changed.

```sh
ZEN_BINARY=/home/ubuntu/.cache/opentabsort-qa/zen-1.23.4b/zen/zen \
SINE_PROFILE=/home/ubuntu/.cache/opentabsort-qa/sine \
xvfb-run -a -s '-screen 0 1200x1000x24' node scripts/e2e-jev.mjs
```

Receipt: `/tmp/opentabsort-decision-native-buffered.log` on dev-01. Exit status: **0**, `Jev native Zen QA: PASS (deterministic providers)`.

- Primary normal sorting completed ten buffered Decision requests of 30 tabs. All 300 fixture URLs were in their expected groups, with no nested groups. Common Undo restored prior membership and order; saved Advanced categories were unchanged.
- A background title update during the second primary Decision request did not cancel the operation. The same complete grouping and exact Undo assertions passed.
- Stop during the second request and HTTP 401 on that request discarded the buffered first batch. Both cases made zero native moves and preserved the original layout.
- Optional primary review used the common plan modal after all ten classification requests. At modal opening the native layout still matched the pre-sort state. Cancel changed nothing; Apply supported exact Undo. The Advanced category list stayed unchanged.
- Retained Advanced tests also passed: ten progressive batches, original group/order/collapse restoration, category reuse, partial Stop/authentication recovery, manual-edit refusal, category-preview cancellation and edited-category application.

This native run checked grouping, ordering and Undo for the Decision integration. Its primary section does not independently assert native reference identity; the separate live-sort runner provides the stricter identity and concurrent-edit checks.

## Planner regression evidence

`node --test tests/ai-decision-plan.test.mjs`: **18/18 passed**, zero failures. It covers original reference preservation over 300 tabs, sanitization before both providers, fresh category behavior, explicit none/low-confidence skips, later protocol/auth/network failures discarding every buffered assignment, preflight readiness/consent, cancellation during either provider, session checkpoints, and a 550-tab multilingual inventory with taxonomy reduction and reduced Decision request widths.

## Complete regression gate

Final `npm run check` passed **414/414 tests**, zero failures, after the 2.0.5 version update and Undo layout-comparator change. Manifest, preference, security and retained-capability validation passed. Receipt: `/tmp/opentabsort-live-sort-final-check.log` on dev-01.

The Undo regression verifies that a later background title/favicon update leaves Undo available and does not restore old page metadata. URL, native identity, membership, order and group appearance remain guarded.

## Completed native browsing acceptance

The strict live-sort runner passed all six scenarios with **300 synthetic tabs** in real Zen + Sine. A preceding complete 120-tab run also passed. Receipts on dev-01: `/tmp/opentabsort-live-sort-300.json` and `/tmp/opentabsort-live-sort-300.log`; the log ends `live browsing native acceptance: PASS`.

```sh
LIVE_SORT_TABS=300 \
LIVE_SORT_ARTIFACT=/tmp/opentabsort-live-sort-300.json \
LIVE_SORT_SCREENSHOT=/tmp/opentabsort-live-sort-retry.png \
ZEN_BINARY=/home/ubuntu/.cache/opentabsort-qa/zen-1.23.4b/zen/zen \
SINE_PROFILE=/home/ubuntu/.cache/opentabsort-qa/sine \
xvfb-run -a -s '-screen 0 1366x768x24' npm run e2e:live-sort
```

- A real content document changed its title and favicon while the provider response was held. Sorting completed for all 300 original native identities. A further content title update after sorting left Undo usable; Undo restored the earlier layout without reverting that page title.
- During another held request the fixture opened one tab, closed one, navigated one, pinned one, and manually grouped two. The new and edited tabs retained their user state, the other 295 tabs were grouped, and all 300 surviving native identities were preserved. Undo restored the immediate pre-apply state, including the intervening browsing activity, selected tab and group appearance.
- Selected connection changes, consent revocation, Stop and an actual native workspace switch each aborted the held HTTP connection before the server released a response. None changed the native layout. The appropriate Retry or Setup action appeared.
- Clicking Retry after a setup change completed a new sort and its Undo restored the earlier layout. Switching back after the workspace cancellation confirmed that the original workspace had remained unchanged.
- Both recovery rows measured **158px wide × 32px high**, visible at y=78..110 in a 768px viewport. `New setup` and `New space`, Retry and dismiss had no label or horizontal overflow. Native PNGs `/tmp/opentabsort-live-sort-retry.png` and `/tmp/opentabsort-live-sort-retry-workspace.png` were downloaded to the Mac and visually inspected.

The old 2.0.4 baseline was reproduced separately in a disposable Zen profile: a content title/favicon update cancelled the pending HTTP request and produced the broad stale-state error before any native move. This establishes the overly strict cancellation mechanism, not the exact event behind the user's screenshot.

## Limits

Deterministic fixtures establish protocol/application behavior for known groups; they do not establish semantic grouping quality for private real tabs, model availability, provider latency, or long-session RSS. The supplied screenshot alone does not identify which exact title/tab/settings event triggered the user's cancellation. This work changes the over-broad cancellation policy, rather than asserting an unobserved cause for that particular attempt.
