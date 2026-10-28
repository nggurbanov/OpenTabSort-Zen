# Advanced tools and saved data

The everyday wand lets AI create groups for the current workspace. Open **AI setup → Advanced & saved data** for existing rules, detailed provider options, appearance, category tools, and backups. Editors load when this section is first expanded.

Existing preference keys and saved data are preserved. Fresh installations start with an empty rule list. Expanding Advanced does not run sorting.

## Run the saved-rule workflow

Use **Run advanced sorting** inside Advanced to invoke the retained rules-and-AI pipeline.

1. Plan deterministic domain/title matches from the saved rule list.
2. If enabled, ask the selected AI engine to classify the remaining eligible tabs, or use the saved Full AI mode.
3. Review when required by the selected persistence mode, validate that the workspace is still current, then apply.

The everyday wand ignores these rule-matching and persistence modes. It does not grow rules or overwrite saved Decision categories.

## Rules and exclusions

Each rule has a name, domain chips (`@`), optional title-keyword chips (`T`), and optional color, gradient, or icon. Rule order determines priority when several rules match. Drag handles reorder rows; search filters the editor without changing the saved list.

**Rule matching priority** selects URL only, Title only, URL then Title, or Title then URL. Matching remains first-match-wins within each source. **Strict rule enforcement**, off by default, removes nonmatching membership during advanced apply.

Right-click a tab → **Add "host" to Rule…** to add its hostname to an existing rule. This changes the saved rule; it does not immediately move the tab. The submenu's **Skip** entry adds the hostname to exclusions.

**Skip Domains** applies to both actions. The everyday wand leaves excluded tabs where they are. Advanced sorting retains its earlier behavior: matching tabs are removed from groups and parked at the top of the workspace.

## Retained AI modes

These controls belong to advanced sorting for Local, Ollama, and chat providers.

| Setting | Advanced behavior |
| --- | --- |
| **Rules + AI** | Match rules first; classify leftovers. The legacy `hybrid` value is equivalent. |
| **Full AI** | Analyze all eligible tabs and do not persist rules. |
| **Preview + Save Rule** | Review proposed new groups and save rules for accepted groups. |
| **Group Once** | Create groups without saving rules. |
| **Zen Edit Prompt** | Open Zen's group editor for each new group. |
| **Fresh Rebuild** | Infer fresh groups across eligible tabs, ignoring saved rules. |
| **Preview Only** | Review and apply a plan without saving domain rules. |
| **Move + Save Domain** | Move to an existing rule group and grow its domain list after approval. |
| **Move Once** | Move without changing the saved rule. |

Plans are computed before workspace mutation. Cancelling preview leaves rules and layout unchanged. Changing the workspace, relevant tabs, rules, or provider settings invalidates a pending plan. Unresolved or failed classifications retain their previous membership.

Ollama's optional **AI title learning** proposes reviewed title chips. Simple uses titles; Complex may also fetch page context. Only accepted proposals are saved. Local Fresh uses titles as transient clustering context and does not save title terms.

Local batch-size controls remain available for large embedding runs. Ollama's **Keep model warm** remains opt-in; it may load the model at browser startup and retain local RAM/VRAM usage.

## Decision models

The main wand always asks the configured suggestion AI to create fresh categories for the current workspace. These categories are transient: it does not replace the saved category list.

Advanced keeps manual categories, saved per-workspace meanings, reuse/refresh controls, preview editing, confidence thresholds, and detailed request options. This is where an existing category workflow can still be run.

The decision endpoint is a **full HTTP(S) request URL**; the mod appends no path. Existing TypeSafe endpoint/model settings remain valid. Use a key issued for the endpoint you choose. Requests are not redirected or silently retried against another provider.

The endpoint must accept the integration's `model`, `state`, and `questions` schema and return typed choice answers. An unrelated API schema needs an adapter. An unrestricted model ID alone does not make another API compatible.

Classification uses up to 30 tab questions per request and shrinks batches to fit its request budget. Unknown, low-confidence, invalid, and missing decisions retain current membership. The confidence floor defaults to 0.5.

Completed batches apply live. **Stop** cancels further work and keeps completed moves. Provider failures leave unprocessed tabs untouched. **Undo sort** restores the previous native layout during the current session and rejects conflicting later edits.

## Appearance and group tools

Rules retain colors, two-color gradients, text icons, and locally uploaded custom image icons. **Gradient style** changes gradient direction; **Minimal style** removes colored group backgrounds while keeping icons. Existing group style and collapse-state integration remain available.

Right-click a group header → **Dissolve group** to remove its group container while retaining the tabs.

## Backup and restore

**Export** writes rules, excluded domains, and uploaded custom icons to a JSON file in Downloads. API keys are excluded. This is a saved-data export, not a browser-session or provider-configuration backup.

**Import…** replaces the included lists. It accepts the current object containing `rules`, `skipDomains`, and `customIcons`, or a legacy bare rules array. A rule referencing an unavailable custom icon has that icon reference cleared.

The preserved preference namespace is `extensions.zen-auto-organize.*`.

## Page context and consent

Advanced Local, Ollama, and chat classification can use structured page snippets: page type, site name, heading, and description. Page requests use the browser's cookies; a resulting snippet may be included in the selected provider's classification context. Remote provider readiness and consent are checked before classification.

Page fetches use a shared six-worker queue. Native response streams are cancelled after a 256 KiB HTML prefix; a six-second phase budget stops further context collection. Classification continues with the metadata already available when a snippet cannot be obtained. The everyday chat/Ollama/Decision path avoids page fetching entirely.

See [architecture](architecture.md) for implementation boundaries and [verification](overhaul-verification.md) for measured results.
