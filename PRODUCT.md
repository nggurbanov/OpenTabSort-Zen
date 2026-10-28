# OpenTabSort Zen

<!-- impeccable:product-schema 1 -->

## Platform

web

The UI runs inside Zen Browser chrome through the Sine mod loader, using native browser controls and HTML/XUL. This is a browser tool, not a standalone website.

## Users

People with hundreds of open tabs who feel overwhelmed by clutter. The primary user explicitly describes having a serious habit of accumulating hundreds of tabs.

## Product Purpose

Press one button and let AI organize the active workspace into useful, coherent groups. Category maintenance, rule authoring and understanding model pipelines must not be prerequisites.

## Operating Context

Set up an AI connection once. Afterwards, use the wand in the workspace sidebar. Show meaningful progress, allow Stop during long work, and provide session Undo after changes. The browser remains usable while AI plans: routine title updates and opening or closing tabs must not force the user to restart sorting.

## Capabilities and Constraints

- AI infers categories from the current workspace, then assigns tabs consistently across bounded batches.
- The user explicitly authorized aggressive simplification of secondary features, including pre-existing categories.
- Keep the existing AI provider integrations usable; existing saved configuration/data is retained outside the main path.
- Remote tab metadata is sent only after provider consent. Setup must not silently select a remote service or send data.
- Native tab nodes, pinned/essential tabs and other workspaces must remain safe.
- Primary sorting uses the metadata snapshot captured at the click. New tabs stay outside the operation; tabs navigated, pinned, manually moved or regrouped during planning are protected rather than cancelling unaffected work. Renamed or manually moved groups are protected too.
- Every primary engine finishes planning before native placement. Decision batches are buffered; the Advanced Decision workflow retains progressive placement.
- Capture Undo immediately before apply so intervening browsing and manual edits survive a reversal. Background title changes alone must not invalidate a layout receipt.
- A changed workspace or selected AI setup produces a short recovery state with Retry. Revoked sharing consent offers Setup.
- Model accuracy is an evaluation target; deterministic fixture correctness is not evidence that a model groups arbitrary real tabs perfectly.

## Product Principles

1. One obvious action: organize this workspace with AI.
2. Decide categories for the user; do not turn decluttering into administrative work.
3. Stay responsive on hundreds of tabs and bound network, memory and main-thread work.
4. Make interruption and recovery predictable.
5. Expose secondary configuration only when it is needed.
