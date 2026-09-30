# Architecture

## Two execution contexts

The same `auto-organize.uc.mjs` is loaded into two different documents by Sine:

```
                 chrome://browser/content/browser.xhtml
                            (main window)
                                 │
                                 ▼
              ┌────────────────────────────────────┐
              │ entry: auto-organize.uc.mjs        │
              │   isBrowserContext = true          │
              ▼                                    │
   tryInitializeBrowser()                          │
      ├── setupCommand()              ──▶ browser-ui.mjs
      ├── addButtonToAllSeparators()  ──▶ browser-ui.mjs
      ├── setupWorkspaceHooks()       ──▶ browser-ui.mjs
      ├── setupTabContextMenu()       ──▶ browser-hooks.mjs  ("Add to Rule…" submenu)
      ├── setupTabGroupCreateHook()   ──▶ browser-hooks.mjs
      ├── setupMinimalStylePrefObserver() ──▶ browser-hooks.mjs
      ├── syncAllGroupColors()        ──▶ groups.mjs
      └── (if Ollama selected + warmup enabled)
          warmupOllama()              ──▶ ollama-transport.mjs


                  about:preferences#sine-mods
                       (settings page)
                             │
                             ▼
              ┌────────────────────────────────────┐
              │ entry: auto-organize.uc.mjs        │
              │   isPrefsContext = true            │
              ▼                                    │
   setupSettingsObserver()            ──▶ prefs-ui.mjs
      ├── fetchZenColorsFromBrowser() ──▶ color-picker.mjs
      ├── MutationObserver(document.body)
      └── onOurDialogFound(dialog)
            ├── injectStylesheet()         ──▶ prefs-ui.mjs (internal)
            └── performInject()            ──▶ prefs-ui.mjs (internal)
                  ├── buildRulesEditor()        ──▶ widget.mjs
                  │     ├── openColorPopover()       ──▶ color-picker.mjs
                  │     └── openEmojiPopover()       ──▶ emoji-picker.mjs
                  ├── buildBackupRestoreSection() ──▶ widget.mjs
                  ├── tagSeparatorContainers()
                  ├── injectSectionDescriptions()
                  ├── setupEnginePrefObserver()
                  └── updateConditionalFields()
```

## Module dependency graph

```
config.mjs            (no deps; pure constants + helpers)
   ▲
   │
rules.mjs   tabs.mjs   ui-toast.mjs
   ▲           ▲              ▲
   │           │              │
   └─── groups.mjs             │
            ▲                  │
            │                  │
        pass1.mjs              │
            ▲                  │
            │                  │
            │  ┌── ai.mjs ─────┤    (Pass 2: local embedding engine)
            │  │               │
            │  │  ollama-transport.mjs ── ollama-prompts.mjs
            │  │       ▲                       ▲
            │  │       └────── ollama.mjs ─────┘
            │  │                  ▲
            │  │                  │
            │  │           preview-modal.mjs   (preview UI)
            │  │                  ▲
            │  └──────────────────┤
            │                     │
            └─── click-handler.mjs
                       ▲
                       │
   ┌───────────────────┴─────────────────┐
   │                                     │
browser-ui.mjs    browser-hooks.mjs   (browser context)
   │                                     │
   └─────────────┬───────────────────────┘
                 │
        auto-organize.uc.mjs
                 │
   ┌─────────────┴──────────┐
   │                        │
prefs-ui.mjs ─── widget.mjs ─── color-picker.mjs / emoji-picker.mjs   (prefs context)
```

**Not pictured above**: `modules/dedupe.mjs` (see [module-dedupe.md](module-dedupe.md)) is a pure, zero-dependency leaf module at the same "foundational" level as `config.mjs`. Both `ai.mjs` and `ollama.mjs` import from it; `ollama.mjs` also imports `embedBatch` directly from `ai.mjs` — a cross-import between the two engine modules, but not a cycle, since `ai.mjs` never imports from `ollama.mjs`.

## The tidy-button click flow

The handler captures rules, eligible live tab references, membership, and the active workspace before planning. Deterministic rule assignments and AI classification run without tab moves. Local existing-group embeddings and Ollama title audits use projected rule membership, including groups that will be created on Apply.

Remote classification is consent-gated. Rule-saving proposals open a preview. Cancellation exits before any workspace mutations. After asynchronous work, the captured workspace/tab/rule snapshot must remain current and every AI assignment must identify an eligible original tab only once.

Accepted plans consolidate duplicates, park explicit skip-domain matches, apply deterministic and AI moves, and clean known empty groups in the original workspace. Failed/skipped classifications retain membership; strict-rule cleanup protects unresolved tabs. Full AI/Fresh/Preview Only disable persistence. Finally styling and Zen’s tab-container bookkeeping are resynchronized. See [the orchestrator](module-click-handler.md) for the current sequence.

## State persistence

All prefs use the `extensions.zen-auto-organize.*` prefix (legacy; preserved across the rename to `opentabsort-zen` so existing users keep their data).

- **Rules** live in `extensions.zen-auto-organize.rules-json` (a JSON-encoded array). Read/written by `rules.mjs`. Observed by the widget so external changes (right-click "Add to Rule" submenu, Backup & Restore import, AI Pass 2) refresh the table live.
- **Skip domains** live in `extensions.zen-auto-organize.skip-domains-json` (a JSON-encoded array of hostname patterns). Read during planning to park matching tabs at the top of the workspace.
- **Strict rule enforcement** lives in `extensions.zen-auto-organize.strict-rules` (boolean, default false). When true, approved apply cleanup ejects any tab that does not match its current group under the active URL/title match mode.
- **Rule matching priority** lives in `extensions.zen-auto-organize.match-mode` (`"url-only" | "title-only" | "url-then-title" | "title-then-url"`, default `"url-then-title"`).
- **Gradient style** lives in `extensions.zen-auto-organize.gradient-style` (`"left-right"` by default) and controls how two-color rule gradients are drawn.
- **Minimal style** lives in `extensions.zen-auto-organize.minimal-style`. Observed by `setupMinimalStylePrefObserver` (browser-hooks.mjs) so the style flips live across all workspaces.
- **AI engine + behaviors** live in `extensions.zen-auto-organize.ai-engine` (`"off" | "local" | "ollama" | "openai" | "gemini" | "custom"`), `.ai-existing-behavior`, `.ai-new-group-behavior`, `.ai-ollama-host`, `.ai-ollama-model`, `.ai-ollama-warmup`.
- **Rule appearance** is stored inline on each rule (`{ name, domains, titleTerms, color, color2, icon }`). `color`/`color2` are Zen palette names or hex strings; `icon` is plain text.
- **Custom icons** live in `extensions.zen-auto-organize.custom-icons-json` as local image data URLs. Rules reference them by `custom:<id>`.
