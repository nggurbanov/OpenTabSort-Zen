# Architecture

OpenTabSort runs as a Sine userChrome mod inside Zen. The main action organizes the active workspace with AI; the retained saved-rule pipeline is a separate advanced action.

## Context loading

`auto-organize.uc.mjs` detects the current document before importing its runtime:

- Browser chrome loads `browser-runtime.mjs` for the wand, workspace hooks, styling, and tab menus.
- Preferences loads `prefs-ui.mjs` and the small `simple-settings.mjs` connection form.
- Other documents do not load either runtime.

AI engines, previews, the legacy orchestrator, and the advanced rule/icon editors are imported when needed. Advanced editors initialize on expansion. Lifecycle teardown removes listeners, observers, timers, injected controls, and retained dialog state.

## Everyday action

`click-handler.mjs` owns the primary wand flow:

1. Check the chosen engine, connection readiness, and required consent. An unconfigured click opens setup without an AI request.
2. Capture active-workspace tab references, relevant settings, native layout, and eligible-tab membership. Filter excluded domains without moving them.
3. Start a cancellable `sort-session.mjs` operation with compact sidebar feedback.
4. Produce a transient plan using the selected engine.
5. Optionally review the plan when `ai-review-before-apply` is enabled; it defaults to false.
6. Recheck the captured state and validate that assignments reference eligible original tabs only once.
7. Apply native placements, record session Undo, update Zen bookkeeping, and report the outcome.

Saved matching rules, saved category lists, and advanced persistence settings do not constrain the main action. Existing group labels remain context for AI and may be reused when a proposed name matches. No rules are saved by this path.

### Chat and Ollama planning

`ai-workspace-plan.mjs` sends one workspace-wide grouping request for normal inventories of up to 300 eligible tabs. The complete prompt is capped at 72 KiB of UTF-8, with byte-bounded titles and hostname/path text and a deduplicated table of existing group names. The model returns groups containing local numeric tab indices, plus explicit unresolved indices. The prompt favors a few meaningful groups, short names, and reuse of existing names.

Index validation never identifies tabs by duplicate titles, URLs, or external IDs. Unknown or invalid indices are ignored; omissions and contradictory claims across groups remain unresolved. Unsupported or malformed grouping responses and request failures preserve the whole layout and return actionable failure details without starting a second full request. The planner neither mutates tabs nor writes saved rules/categories.

Inventories above 300 tabs, or whose minimum compact prompt still exceeds the byte budget, retain the prior taxonomy path. `jev-categories.mjs` bounds large inventories through partial suggestions and global reduction. Classification then uses the same category IDs in batches of up to 75 tabs; existing retry helpers repair malformed/incomplete batch responses within bounded attempts. `strategy: "taxonomy"` explicitly selects this protocol for regression coverage.

Inputs are compact titles, hostname/path context, and current group labels. URL credentials, query strings, fragments, control characters, and directional formatting characters are removed before prompt construction. Page metadata is treated as untrusted data. This path fetches no tab pages and loads no local embedding model.

Planning returns existing-group assignments, new groups, and unresolved tabs. Missing or invalid assignments never fabricate tab references. Unresolved tabs retain their original membership.

Primary planner requests allow up to 8192 output tokens. This accommodates reasoning models whose thinking and answer share an output budget; it does not guarantee model latency or disable mandatory reasoning. Provider parsing distinguishes exhausted output limits, empty answers, malformed JSON, and rejected requests. `sort-failure.mjs` maps failures to short recovery labels and full accessible messages; sanitized technical details remain available for diagnostics. See the [configured-model probe](tidy-verification.md#configured-model-output-budget) for the measured case.

### Built-in local planning

The built-in option lazily loads `ai.mjs` and calls its fresh clustering pipeline with an empty rule list. It uses the browser's embedding model and its own clustering/naming logic rather than chat-generated categories. Its optional page context uses the bounded shared fetch path.

### Decision planning

`jev-sort.mjs` uses the configured suggestion AI to generate fresh categories for each primary run. `sourceOverride: "suggest"` bypasses saved/manual category selection; `persistCategories: false` leaves the saved category list intact.

The decision provider classifies bounded batches against that category vocabulary and applies completed batches live. Stop or failure retains completed batches; unprocessed and uncertain tabs keep their current membership. The shared review preference controls category preview.

## Interruption, application, and recovery

`sort-session.mjs` owns abort propagation, progress, state checks, and cleanup. Workspace, tab, or relevant preference changes invalidate pending work. Requests and page-context work receive the operation's abort signal.

Chat, Ollama, built-in local, and advanced rule sorting plan before applying. Stop during planning leaves layout unchanged. Decision sorting is incremental, so it keeps completed moves and offers Undo.

`apply-placement.mjs` handles native move failures and attempts to restore the affected placement. `apply-plan.mjs` is shared by the primary and advanced orchestrators. Sorting moves original tab nodes; it does not close and recreate their browsing state.

`operation-ui.mjs` injects its essential styles directly, so first feedback does not depend on Sine resolving an external sheet. The default surface is a transparent 32px row in the stable sidebar toolbar, outside the scrolling tabs; a bounded overlay is used only when no suitable sidebar anchor exists. It shows Stop while busy and contextual Undo or Setup afterward. Successful rows dismiss after five seconds, pausing while hovered or focused. Error rows offering setup remain until dismissed. Removing feedback cleans up timers/listeners without deleting the Undo receipt.

`tidy-motion.mjs` captures only eligible visible rows before native placement, then plays a bounded FLIP translation after placement: at most 40 rows, 260ms, no awaited delay. It animates independent translation on the tab stack where available, preserving Zen's transforms and inline styles. Reduced motion, scrolling or workspace changes, existing conflicting translation, teardown, and another run cancel or skip the optional effect. Placement correctness is independent of animation support.

`tab-history.mjs` records one native layout receipt per completed operation. It restores membership, order, group appearance, and collapse state during the browser session. Undo checks the current layout before restoring and rejects a conflicting manual edit. It is not persisted as a cross-restart history.

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

Use `npm run check` for manifest/preference/privacy validation and regression tests. [Real Zen checks](e2e-zen.md) exercise Sine-loaded native behavior in disposable profiles. [The 2.0.0 overhaul record](overhaul-verification.md) preserves the earlier fixture/import/transfer measurements. [The 2.0.1 follow-up](tidy-verification.md) records native sidebar/motion behavior, one-request grouping, and the bounded configured-model output-budget probe. Neither record establishes long-session RSS or general model quality.
