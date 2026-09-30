# `modules/click-handler.mjs` — sorting orchestration

`handleOrganizeClick()` runs one sort at a time. It loads runnable rules, captures the eligible tab list and current workspace, excludes skip-domain matches, and plans deterministic rule moves without modifying the DOM.

Rules + AI classifies unmatched tabs. Full AI and Fresh/Preview Only classify all eligible non-skipped tabs. Local, Ollama, and remote providers share the same apply boundary. Ollama can also propose reviewed title-rule changes.

Rule-saving remote/Ollama plans and all new-rule plans open the preview. Local planned/existing reassignment controls stay disabled because those controls require a constrained classifier; they never silently switch to Ollama. Remote providers use the selected service for reassignment.

Cancel returns before group consolidation, tab moves, strict-rule ejection, rule persistence, ordering, or styling. After asynchronous work, the workspace, tab references/order/URLs/titles/membership, and rule preference must still match the captured snapshot. `sort-plan.mjs` validates every assigned live tab exactly once before any application.

An accepted plan consolidates duplicate labels, parks explicitly skipped domains, applies rule moves where applicable, then applies AI moves. Failed/skipped AI tabs retain their membership. Strict mode protects unresolved classifications. Cleanup removes empty groups only in the original workspace and resynchronizes Zen’s tab containers.

Full AI, Fresh Rebuild, and Preview Only supply transient apply options with rule persistence disabled. Existing manual groups are not dissolved as a pre-pass: matched tabs can move to the renamed rule without destroying unmatched tabs.
