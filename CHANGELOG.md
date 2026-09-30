# Changelog

## 1.4.1 — 2026-09-30

- Added an editable full decision API endpoint alongside the unrestricted model ID and provider key; existing TypeSafe settings remain valid.
- Renamed the UI engine to Decision models and documented Jev through OpenRouter and other System One-compatible providers.
- Reject invalid endpoint URLs before requests and disable redirects; endpoint changes invalidate in-flight sorting results.

## 1.4.0 — 2026-09-30

- Added the Jev engine: an optional LLM suggests up to 10 described categories, then Jev classifies up to 30 tabs per request within a conservative context budget and applies each completed batch live.
- Automatic sorting is the default; category preview is optional and off. Preview supports editing, merging, removal, and cancellation before classification.
- Save category meanings per workspace; reuse them, refresh them every run, or define them manually. Oversized suggestion inputs are summarized and merged in bounded rounds.
- Added live progress, brief tab highlights respecting reduced motion, Stop, and session Undo. Undo restores native group membership, order, appearance, and collapse state without overwriting later layout edits.
- Keep uncertain, unknown, failed, and invalid decisions in their original groups; stop stale batches after workspace, tab, rule, or provider-setting changes. Preserve completed batches after cancellation or failure.
- Jev uses title, hostname/path, and current-group metadata without fetching pages; strip URL credentials, query strings, and fragments. Reuse existing provider configuration for category generation and keep credentials out of diagnostics and backups.
- Verified a 300-tab native Zen run, category reuse, Stop/Undo, request failure, manual-edit protection, and optional preview with deterministic HTTP providers. Live Jev classification quality has not been benchmarked.

## 1.3.0 — 2026-09-30

### Upstream refresh
- Merged Zen Tab Wand through upstream commit `8c098c7` (2026-09-20). Upstream and fork version numbers are independent.
- Added title-match chips and matching priority, reviewed Ollama title learning, gradients, emoji/custom icons, expanded backup data, and improved rule editing.
- Retained upstream Firefox ML invocation/tensor handling, topic naming, leftover clustering, and cluster/name consolidation.
- Preserved the fork’s OpenAI-compatible, Gemini, custom endpoint, consent, Full AI, provider batching, and explicit ungroup-before-create behavior.

### Correctness and usability
- Plan all changes before preview; Cancel leaves tabs and rules intact. Reject stale plans after workspace, tab, or rule changes; prevent overlapping sorts.
- Preserve failed/skipped tabs and manual groups. Full AI, Preview Only, and Fresh Rebuild do not change saved rules.
- Validate provider indices, labels, and cluster memberships; stop terminal authorization/configuration errors, retain earlier successful batches, and retry only missing/invalid decisions.
- Keep request timeouts active through response-body reads; exclude raw provider responses and credentials from error messages.
- Preserve distinct pages on the same hostname in Local AI and provider inputs, while batching expensive work.
- Preserve Unicode names/title matches, distinguish colliding new-group names, and retain title proposals during preview reassignment.
- Preserve intentionally empty rule lists, incomplete drafts, gradients, icons, and title fields in imports and AI saves.
- Restore every remote provider in the settings UI; allow custom servers without keys; combine duplicate Rules First/Hybrid choices while accepting old preferences.
- Synchronize manifest/package/build version, update install links, and make checks portable. Headed browser QA skips onboarding only in disposable profiles.

## Fork 1.2.0–1.2.3 — 2026-06-18 to 2026-06-23

- Added Rules First/Hybrid/Full AI sorting and bounded provider batches.
- Fixed remote Full AI application and explicit ungroup-before-create behavior.
- Added real Zen provider E2E fixtures, quality scoring, and an isolated-profile runner.

## Fork 1.1.0 — 2026-06-18

- Introduced the OpenTabSort Zen identity, configurable OpenAI-compatible/Gemini/custom providers, explicit data consent, provider request helpers, and validation.

The entries below are inherited upstream history. Upstream’s changelog stops at 1.0.2; the 1.3.0 refresh above records later merged behavior from source and commits.


## 1.0.2 — 2026-06-01

### Added
- **Local AI engine now honours the "When AI creates a new group" dropdown** with all three behaviours: Auto-add, Transient, Fresh categories (previously Ollama-only).
- **Local Fresh mode.** Clusters every tab into new hostname/intent-named groups using the bundled embedding model.
- **Plan Mode (identify-only) modal now works for the Local engine**, not just Ollama.
- **Page-context snippets** (`og:type`, `og:site_name`, first `h1`, description) are now fetched and fed to both engines for better classification.
- **3rd-phase fuzzy name dedupe for Ollama Fresh.** Catches near-duplicate cluster names like "Content Unavailable" + "Content Unavailability" or "Communication Apps" + "Communication Tools".
- **Stickiness in Ollama unified mode.** Tabs already in an existing group can't be pulled into brand-new AI-invented groups — only into other existing groups.
- **Skip Domains** setting (carry-over polish on top of 1.0.1's section).
- **Strict rule enforcement** option that ejects tabs from a group when their hostname isn't listed in that group's rule.
- **Drag-handle reorder** of rules in the settings rules editor.
- **Right-click "Dissolve group"** on tab-groups; **"Add to Rule…" submenu** on tabs.
- **Collapsed-group state persists across browser restarts.**
- **Chunking + hostname-dedupe for Local AI** on workspaces with >75 unmatched tabs. Configurable batch size; soft-cap confirmation modal at >500 tabs.
- **First-time warning modal** when selecting the Ollama or Local AI engine (fires once per engine).
- **README "Choosing an AI model" table** with qwen2.5 size variants.

### Changed
- **Ollama generate timeout raised from 60s → 180s.** Accommodates qwen2.5:7b classifying 100+ unique tabs in one pass.
- **Unified-classifier prompt** now carries an explicit anti-catch-all instruction so the model stops dumping unrelated tabs into a generic existing rule like "Utils".

### Fixed
- **Auto-sort into a collapsed group.** Target group now re-collapses correctly and the newly-added tabs are properly `aria-hidden`.
- **Collapse state survives session restore.** Zen's session save drops the `collapsed` attribute; we re-apply it from a persisted pref on workspace load.
- **In-progress rules with no domains yet** now survive a browser restart and show up in the right-click "Add to Rule…" submenu.

## 1.0.1 — 2026-05-19

### Added
- **Tab right-click "Add to Rule…" submenu.** Hover the new entry on any tab → submenu lists every rule (✓ + disabled for rules that already contain the hostname) plus a **Skip** entry that adds the hostname to the Skip Domains list. Replaces the previous passive auto-add-on-drag behaviour with explicit user intent.
- **Skip Domains** section in settings. Hostnames in this list never get touched by the wand — matching tabs are ejected from any group and parked at the top of the workspace on every click.
- **Strict rule enforcement** toggle under Look & Feel. When on, any tab inside a group whose rule doesn't list its hostname is ejected to the top when you click the wand. Off by default.
- **Backup & Restore Export** now downloads a real JSON file to your default Downloads folder (`wand-backup-<N>groups-<YYYYMMDD-HHmmss>.json`) and registers it in Firefox's downloads panel.
- **Backup file format upgraded** from a bare rules array to `{ rules: [...], skipDomains: [...] }` so the skip-domains list rides along. Import still accepts the legacy bare-array shape.
- Section descriptions under Group Rules / Skip Domains / Backup & Restore / Look & Feel / AI Sorting separators.

### Changed
- **Removed the global TabGrouped auto-add hook.** It listened for any tab joining a group and silently appended the tab's hostname to the matching rule. The hook couldn't reliably distinguish user actions from Zen's async session-restore re-attaches (which fire after we explicitly ungroup a tab), leading to surprise rule bloat. Rule growth now goes through three explicit paths only: the settings rule editor, the right-click submenu, and AI Pass 2.
- **Pass 1 + dedupe no longer grow rules as a side effect.** The wand click is now idempotent on the rules list when AI is off — clicking it never changes your rules.
- Section headers (Group Rules / Skip Domains / Backup & Restore / Look & Feel / AI Sorting) all share Sine's native separator styling for a uniform look.

### Fixed
- **Sticky-drag on Windows.** After the wand sorted tabs, the first drag attempt on any moved tab would silently fail; second attempt worked. Root cause: raw `tabsContainer.insertBefore` left Firefox's `_tPos` cache stale. Now triggers `gZenWorkspaces.updateTabsContainers()` + a cache touch at click end.
- **Plan Mode modal transparency on Windows.** The modal inherited Zen's translucent toolbar background. Switched to opaque `Canvas` system colour.
- **Strict-mode ejection now uses `gBrowser.ungroupTab`** before reparenting, so Zen's group bookkeeping stays in sync and the tab actually stays out of the group.

## 1.0.0 — Initial public release

- Two-pass tab organization: deterministic domain rules first, optional AI fallback (Firefox's bundled smart-tab-embedding model or a local Ollama daemon).
- Pill-table rules editor in settings with per-rule colour picker.
- Plan Mode interactive modal for AI Pass 2 (preview the proposed plan, keep/skip groups, re-assign).
- Backup & Restore export/import (rules only).
- Per-workspace toolbar wand button with wiggle / AI-thinking pulse animations.
- Live re-styling on Minimal Style toggle.
- Optional Ollama warmup preference for low-latency first clicks.
