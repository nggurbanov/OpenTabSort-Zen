# `modules/click-handler.mjs` — primary sorting orchestration

`handleOrganizeClick()` runs one AI sort per browser window. An unconfigured provider opens setup without making a request. The primary action uses no saved matching rules or manually maintained category list and saves neither.

It captures the initial active-workspace native references and metadata, filters excluded domains, and starts a cancellable session. Chat/Ollama use `ai-workspace-plan.mjs`; built-in local AI uses its fresh embedding pipeline; Decision uses the buffered `ai-decision-plan.mjs`. Every primary engine finishes planning before native placement. Optional review uses the common plan modal.

`sort-reconciliation.mjs` validates current native identities and eligibility before apply. Background title updates and additions or closures do not cancel unaffected assignments. New tabs stay outside the operation; navigated, pinned, manually moved or regrouped tabs and renamed/moved groups are protected. Selected AI settings, metadata consent and workspace changes still abort pending requests with specific Retry or Setup feedback.

The handler captures the Undo baseline immediately before synchronous `applyPass2()`, removes planning observers before its own native moves, and records one session receipt. Undo therefore preserves browsing activity during planning. Later title changes alone do not invalidate the receipt; later conflicting layout changes do.

`handleLegacyOrganizeClick()` shares the per-window exclusivity guard and lazily imports `legacy-sort.mjs` for **Run advanced sorting**. Its saved-rule, Full AI, Fresh/Preview Only, title-learning, persistence and progressive Decision behavior remain separate.

See [architecture](architecture.md), [Advanced behavior](advanced.md), and [native concurrent-browsing verification](live-sort-verification.md).
