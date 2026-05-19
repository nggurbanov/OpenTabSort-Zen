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
      ├── setupTabGroupedHook()       ──▶ browser-hooks.mjs
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
                  │     └── openColorPopover()       ──▶ color-picker.mjs
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
            │  │           preview-modal.mjs   (Plan Mode UI)
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
prefs-ui.mjs ─── widget.mjs ─── color-picker.mjs   (prefs context)
```

## The tidy-button click flow

When the user clicks the wand button, `handleOrganizeClick` runs:

1. **wiggle** — CSS animation on the wand for feedback
2. **consolidate duplicates** (groups.mjs) — merge multiple tab-groups with the same label into the first
3. **load rules** (rules.mjs) — pref > rules.json > defaults
4. **dissolve stale groups** (groups.mjs) — any tab-group whose name isn't in the current rule set gets its tabs ejected to the top of the workspace; the empty group is removed
5. **enumerate eligible tabs** (tabs.mjs) — non-pinned, non-empty, in the current workspace
6. **runPass1** (pass1.mjs) — assign each tab a target group via first-match-wins
7. **applyPass1** (pass1.mjs) — move tabs into their target groups; create new groups when needed

Then, if the AI engine is set to anything other than `"off"`:

8. **setButtonThinking(true)** — start the wand's pulse animation while AI runs
9. **runPass2** (ai.mjs **or** ollama.mjs) — depends on `ai-engine` pref:
   - `"local"` → existing-group classification only, max-cosine over per-tab embeddings
   - `"ollama"` → unified classify-and-cluster; can also invent new groups
10. **Plan Mode gate** — if `ai-new-group-behavior` is `"identify-only"` OR (`"auto-add"` / `"always-add"` with new groups to confirm), `showPreviewModal` (preview-modal.mjs) opens with the plan; the user toggles which groups to keep and can re-assign-to-existing / re-assign-to-new in place. Apply is gated on the user's confirmation
11. **applyPass2** — execute the (possibly user-edited) plan: move tabs into existing groups, create new ones, optionally grow the rules array
12. **fresh-categories cleanup** — if mode is `"fresh-categories"`, dissolve any group that has zero tabs after the rebuild
13. **moveUngroupedToTop** (groups.mjs) — anything still ungrouped is shoved to the top
14. **syncAllGroupColors** (groups.mjs) — push per-rule colors onto every rule-matched group (catches groups Pass 1 didn't touch)
15. **nesting diagnostic** — log a warning if any tab-group is nested inside another (a Zen bug we've hit before)
16. **setButtonThinking(false)** — restore the wand

## State persistence

- **Rules** live in the `extensions.zen-auto-organize.rules-json` pref (a JSON-encoded array). The pref-key prefix is `zen-auto-organize.*` (legacy; preserved across the rename to `zen-tab-wand` so existing users keep their data). Read/written by `rules.mjs`. Observed by the widget so external changes (e.g. context-menu auto-add) refresh the table live.
- **Minimal-style toggle** lives in `extensions.zen-auto-organize.minimal-style`. Observed by `setupMinimalStylePrefObserver` (browser-hooks.mjs) so the style flips live across all workspaces.
- **AI engine + behaviors** live in `extensions.zen-auto-organize.ai-engine` (`"" | "local" | "ollama"`), `.ai-existing-behavior`, `.ai-new-group-behavior`, `.ai-ollama-host`, `.ai-ollama-model`, `.ai-ollama-warmup`.
- **Rule colors** are stored inline on each rule (`{ name, domains, color }`). The color is either a Zen palette name (`"blue"`) or a hex string (`"#abc"`).
