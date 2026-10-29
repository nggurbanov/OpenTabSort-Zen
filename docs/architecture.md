# Architecture

OpenTabSort runs as a Sine userChrome mod inside Zen. The main action organizes the active workspace with AI; the retained saved-rule pipeline is a separate advanced action.

## Context loading

`auto-organize.uc.mjs` detects the current document before importing its runtime:

- Browser chrome loads `browser-runtime.mjs` for Organize tabs, workspace hooks, styling, and tab menus.
- Preferences loads `prefs-ui.mjs` and the small `simple-settings.mjs` connection form.
- Other documents do not load either runtime.

AI engines, previews, the legacy orchestrator, and the advanced rule/icon editors are imported when needed. Advanced editors initialize on expansion. Lifecycle teardown removes listeners, observers, timers, injected controls, and retained dialog state.

## Everyday action

`click-handler.mjs` owns the primary action flow:

1. Check the chosen engine, connection readiness, and required consent. An unconfigured click opens setup without an AI request.
2. Capture active-workspace native tab references, their initial metadata/membership/order, and relevant settings. Filter excluded domains without moving them; new tabs do not join this operation.
3. Start a cancellable `sort-session.mjs` operation with native divider progress and a grouping/Stop control.
4. Produce a transient plan using the selected engine.
5. Optionally review the plan when `ai-review-before-apply` is enabled; it defaults to false.
6. Validate the returned plan against original requested references, reconcile it against current eligible native tabs, then validate the filtered plan. Protect intervening navigation and manual layout edits without cancelling unaffected assignments.
7. Capture the current native layout immediately before synchronous apply, place the reconciled tabs, record session Undo, update Zen bookkeeping, and report the outcome.

Saved matching rules, saved category lists, and advanced persistence settings do not constrain the main action. Existing group labels remain context for AI and may be reused when a proposed name matches. No rules are saved by this path.

### Chat and Ollama planning

`ai-workspace-plan.mjs` sends one workspace-wide grouping request for normal inventories of up to 300 eligible tabs. The complete prompt is capped at 72 KiB of UTF-8, with byte-bounded titles and hostname/path text and a deduplicated table of existing group names. The model returns groups containing local numeric tab indices, plus explicit unresolved indices. The prompt favors specific projects, tasks, and tools, using existing labels only as weak context. There is no fixed target folder count; primary responses have a safety ceiling of 128 categories (and fast responses cannot contain more groups than input tabs). The separate Advanced saved-category editor retains its 10-category contract.

Index validation never identifies tabs by duplicate titles, URLs, or external IDs. Unknown or invalid indices are ignored; omissions and contradictory claims across groups remain unresolved. Unsupported or malformed grouping responses and request failures preserve the whole layout and return actionable failure details without starting a second full request. Explicit provider output-limit stops are the exception: they enter the bounded recovery protocol below. The planner neither mutates tabs nor writes saved rules/categories.

Inventories above 300 tabs, or whose minimum compact prompt still exceeds the byte budget, retain the prior taxonomy path. `jev-categories.mjs` bounds large inventories through partial suggestions and global reduction. Classification then uses the same category IDs in batches of up to 75 tabs; existing retry helpers repair malformed/incomplete batch responses within bounded attempts. `strategy: "taxonomy"` explicitly selects this protocol for regression coverage.

Inputs are compact titles, hostname/path context, and current group labels. URL credentials, query strings, fragments, control characters, and directional formatting characters are removed before prompt construction. Page metadata is treated as untrusted data. This path fetches no tab pages and loads no local embedding model.

Before applying a successful initial plan, each destination with at least 30 assigned tabs is semantically reassessed once using the same provider/model and compact metadata, without the old parent labels. The review may split distinct tasks or retain a large coherent project; it never slices into numbered size buckets. Small groups require no additional requests. Review requests are sequential, share a 120-second deadline and Stop signal, and use the same bounded taxonomy/output recovery paths when needed. No reviewed subgroup is recursively reviewed. Any review failure discards the whole plan before native mutation; unresolved reviewed tabs retain their original membership.

Planning returns existing-group assignments, new groups, and unresolved tabs. Missing or invalid assignments never fabricate tab references. Unresolved tabs retain their original membership.

Workspace output budgets are selected in `provider-requests.mjs`. Verified Mercury 3 IDs (`inception/mercury-3` and `inception/mercury-3-20261019`) on the HTTPS OpenRouter chat endpoint receive a 65536-token ceiling. Other models/providers/formats, including Ollama and LFM 2.5, retain 8192. OpenRouter's public metadata checked on 2026-10-28 advertised 131072 maximum output tokens for Mercury 3 and 8192 for LFM 2.5. The generic chat request builder permits explicit budgets up to 65536; legacy callers still request their existing smaller budgets. Ollama's transport ceiling remains 8192.

This is an explicit verified-model policy, not automatic catalog discovery. No extra HTTP requests or background tasks are added to sorting. Increasing the ceiling permits more reasoning and answer text but does not require spending the whole budget, guarantee completion/latency, or disable mandatory reasoning. Initial and recovery requests use the same selected budget.

An explicit `PROVIDER_OUTPUT_LIMIT` triggers recovery. The planner infers a compact global taxonomy using every tab, with 48 KiB UTF-8 inventory chunks, splitting a truncated inventory and merging partial taxonomies before classification. Summary reduction retains only bounded names/descriptions, without model-supplied examples. Classification starts at 50 tabs; a truncated batch is immediately halved, and the smaller working width is retained for later batches. Stable global IDs and fresh local indices preserve original native tab references.

Recovery permits at most `min(64, ceil(tabCount / 50) + 10)` additional requests (16 for 300 tabs). A shared deadline aborts the current HTTP request after 120 seconds for remote providers or 180 seconds for Ollama; timers and parent-signal listeners are removed on every exit. These limits start after the original failed attempt. Any failed recovery request, malformed/missing assignment, deadline, or request ceiling discards all recovery assignments. Explicit unresolved labels from otherwise complete successful responses remain unchanged. Cancellation propagates without an apply plan. Authentication, rate, network, refusal, and untyped parse errors do not initiate recovery; the selected provider/model and consent remain unchanged.

Provider parsing distinguishes exhausted output limits, empty answers, malformed JSON, and rejected requests. `sort-failure.mjs` maps failures to short recovery labels and full accessible messages; sanitized technical details remain available for diagnostics. See the [configured-model probe](tidy-verification.md#configured-model-output-budget) for the measured case.

### Built-in local planning

The built-in option lazily loads `ai.mjs` and calls its fresh clustering pipeline with an empty rule list. It uses the browser's embedding model and its own clustering/naming logic rather than chat-generated categories. Its optional page context uses the bounded shared fetch path.

### Decision planning

`ai-decision-plan.mjs` uses the configured suggestion AI to infer fresh categories from all initial compact tab metadata. It does not read or overwrite saved categories. Category requests use the selected provider's verified workspace output budget. The same credentials/query/fragment/control-character sanitization applies before both providers receive metadata.

`sortJevBatches` classifies up to 30 tabs per request, reducing width to fit the Decision context budget. Its primary callback only buffers assignments; it performs no native moves. A later HTTP/network/authentication error or missing/malformed answer discards all buffered assignments. Complete `none` and low-confidence decisions are valid skips. Stop and session cancellation propagate through the current request and prevent the common apply step.

The resulting plan references original tab objects and shares the primary plan preview, snapshot reconciliation, native application and Undo. Optional review happens after classification and before any native placement. `jev-sort.mjs` remains the separate Advanced progressive path with its existing category editor and completed-batch recovery.

## Interruption, application, and recovery

`sort-session.mjs` owns abort propagation, progress, state checks, and cleanup. Primary work stops when the active workspace, selected engine/provider settings, metadata consent, exclusions or review preference changes. Unused providers and preserved legacy rules/categories are outside the primary settings guard. Requests and page-context work receive the operation's abort signal.

`sort-reconciliation.mjs` tracks original native identities and structural/navigation events while the user continues browsing. Titles, favicons and loading attributes do not invalidate the operation. Added tabs stay outside the plan; closed tabs are removed. Navigated, pinned, manually reordered/regrouped tabs and renamed or moved groups are protected. Surviving original references are compared in projected order, so an unrelated insertion or closure is not mistaken for a reorder. Protected destination names cannot absorb other planned tabs.

Every primary engine plans before applying, including Decision. Stop during planning leaves layout unchanged. Advanced rule planning retains strict state validation; Advanced Decision sorting remains incremental and keeps completed moves with Undo.

`apply-placement.mjs` handles native move failures and attempts to restore the affected placement. `apply-plan.mjs` is shared by the primary and advanced orchestrators. Sorting moves original tab nodes; it does not close and recreate their browsing state.

`operation-ui.mjs` delegates ordinary sorting to `separator-progress.mjs`: the native divider is the progress surface, its grouping icon becomes Stop, and completion/recovery actions stay inline. The native section is held reachable while feedback exists, without adding a row on start. When no divider is available, the older compact row/overlay and its embedded essential stylesheet remain a fallback. Successful feedback dismisses after five seconds, paused on hover/focus; recovery persists. Cleanup releases timers/listeners/observers without deleting the Undo receipt.

`tidy-motion.mjs` captures only eligible visible rows before native placement, then plays a bounded FLIP translation after placement: at most 40 rows, 260ms, no awaited delay. It animates independent translation on the tab stack where available, preserving Zen's transforms and inline styles. Reduced motion, scrolling or workspace changes, existing conflicting translation, teardown, and another run cancel or skip the optional effect. Placement correctness is independent of animation support.

`tab-history.mjs` records one native layout receipt per completed operation. The primary baseline is captured immediately before native apply, so new tabs and manual edits made during planning are preserved by Undo. It restores membership, order, group appearance, and collapse state during the browser session. Undo checks the current layout before restoring and rejects a conflicting manual edit; title-only updates are excluded from that comparison. Strict plan validation remains separate. The receipt is not persisted as a cross-restart history.

## Advanced compatibility path

`legacy-sort.mjs` contains the retained deterministic rules + optional AI pipeline. It is loaded only by **Run advanced sorting**. Its rule-saving modes, Full AI, title learning, previews, exclusions, and strict cleanup remain available there.

`widget.mjs`, color/emoji pickers, icon management, and backup/import tools load when Advanced is opened. The primary settings form only needs the engine, its connection, consent where required, and the review toggle.

See [advanced tools](advanced.md) for the retained behavior. Older module-specific documents describe implementation details and may retain terminology from the advanced pipeline.

## Bounded page context

`page-context.mjs` supplies a shared six-worker queue and bounded native response reader. Local/advanced context gathering reads at most a 256 KiB HTML prefix per page and cancels the remaining body stream. The overall context phase has a six-second budget. Individual snippet requests also have a timeout.

Page requests use browser cookies. Extracted context may be sent to the chosen advanced provider after its consent/readiness checks. Native response bodies use streaming limits; non-streaming test adapters can only truncate after their `text()` read.

These are explicit work/transfer limits, not proof of a particular RSS reduction. The primary chat/Ollama/Decision flow avoids this work entirely.

## Persistence

All retained preferences use `extensions.zen-auto-organize.*` for migration compatibility.

| Data | Storage/use |
| --- | --- |
| Rules | `rules-json`; JSON array, empty on fresh install. Advanced edits and approved advanced persistence only. |
| Excluded domains | `skip-domains-json`; shared eligibility exclusion; advanced retains its top-parking behavior. |
| Engine and connection | `ai-engine` and provider-specific endpoint/model/key preferences. |
| Review | `ai-review-before-apply`; false by default. |
| Provider consent | `ai-provider-consent`; explicit for OpenAI-compatible, Gemini, Custom, and Decision requests. |
| Decision categories/options | Existing per-workspace category and provider preferences; primary suggestions do not overwrite them. |
| Rule appearance/icons | Inline rule fields and `custom-icons-json`; preserved by saved-data backup. |
| Session Undo | In-memory layout receipt; excluded from saved-data backup. |

Keys remain local preferences and are excluded from exported backups and diagnostics. A configured remote Ollama address receives context there; the local default is `http://localhost:11434`. Ollama startup warming is disabled by default.

The extracted host-theme tokens and component states are documented in [DESIGN.md](../DESIGN.md), with visual specimens in `.impeccable/design.json`.

## Verification

Use `npm run check` for manifest/preference/privacy validation and regression tests. [Real Zen checks](e2e-zen.md) exercise Sine-loaded native behavior in disposable profiles. [The 2.0.0 overhaul record](overhaul-verification.md) preserves the earlier fixture/import/transfer measurements. [The Tidy follow-up](tidy-verification.md) records native sidebar/motion behavior, one-request grouping, and the bounded configured-model output-budget probe. [The 2.0.3 recovery record](output-recovery-verification.md) covers forced output limits and the configured-model replay. [The 2.0.5 browsing record](live-sort-verification.md) separates primary snapshot/Decision evidence from the retained Advanced behavior. These checks do not establish long-session RSS or general model quality.

## Divider control and label presentation

`separator-progress.mjs` owns the ordinary operation surface; `operation-ui.mjs` retains its compact fallback for missing native separators. The native command invokes Stop while planning and otherwise starts sorting. Divider hover/focus reveals the grouping icon, while busy Stop remains visible. A thin native-line sweep respects reduced motion. The pinned section stays reachable while feedback is present, without moving native tabs or adding a new row. Resize observation updates its sticky offset; native tab-move hooks do not force repeated geometry reads.

`group-emoji.mjs` resolves unambiguous emoji variants to original destination names before reconciliation. Label decoration happens after successful native placement and before recording Undo. Existing/manual groups outside the operation reserve their icons. The default-on preference is read again before apply and is excluded from primary request invalidation. Optional preview supplies preferred display labels; current manual icon reservations still win. No provider request is added.
