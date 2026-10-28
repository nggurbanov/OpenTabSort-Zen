# `modules/browser-ui.mjs` — native sorting control

Inject a grouping button immediately before native Clear in each workspace divider. Retain the existing DOM/command IDs for compatibility. `sort-icons.mjs` supplies compact grouping and Stop SVGs; CSS reveals the idle control on hover/focus and keeps busy Stop visible.

The command dispatches to the active separator operation's Stop handler while it runs. Otherwise it lazily loads the primary sorting handler. `separator-progress.mjs` owns inline progress/actions, the thin-line animation state, accessibility and cleanup. A workspace refresh reattaches the operation to the current native divider. Teardown removes the operation and restores workspace hooks without overwriting a later mod's wrapper.

See [architecture](architecture.md) and [native verification](separator-verification.md).
