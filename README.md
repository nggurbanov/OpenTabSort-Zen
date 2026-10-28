# OpenTabSort Zen

Hundreds of tabs, one button. OpenTabSort uses AI to organize the active [Zen Browser](https://zen-browser.app) workspace into groups.

Set up an AI connection once, then click the wand. AI works out the groups from your tabs. Progress, **Stop**, and session **Undo** are available while you organize.

Development version: **2.0.0, unreleased**. Based on the MIT-licensed [Zen Tab Wand](https://github.com/flantig/Zen-Tab-Wand).

## Install

In Zen → Sine, use **Install from GitHub** with `nggurbanov/OpenTabSort-Zen`. Restart Zen after installation or an update so cached modules reload. The published repository version may differ from this unreleased checkout.

## Start organizing

1. Click the **wand** in the workspace sidebar. If AI is not configured, it opens **AI setup**.
2. Choose an engine and fill in its connection settings. For a remote provider, enable the explicit tab-metadata consent checkbox.
3. Click the wand again. AI creates groups for the active workspace and places your tabs in them.

**Review groups before applying** is optional and off by default. Enable it in AI setup if you want to inspect the proposed groups first.

Pinned and essential tabs, tabs in other workspaces, and excluded domains stay in place. Saved rules and manually maintained categories are available in **Advanced & saved data**; the everyday wand does not require them or save new rules.

## Choose an engine

| Engine | Setup |
| --- | --- |
| **OpenAI-compatible** | Endpoint, model, API key, and consent. |
| **Gemini** | Model, API key, and consent. |
| **Ollama** | A running Ollama server and an installed model. The defaults are `http://localhost:11434` and `qwen2.5:1.5b`. |
| **Built-in local AI** | No endpoint or key. Uses the browser's embedding model on your device. |
| **Custom endpoint** | Endpoint, model, optional API key, and consent. Existing protocol options remain in Advanced. |
| **Decision models** | Decision endpoint, model, key, consent, and an AI connection for automatically creating groups. |

Chat providers and Ollama infer a shared set of groups from the workspace, then classify tabs in bounded batches. Decision models create fresh categories before live classification. Built-in local AI uses embedding-based clustering; its grouping and naming differ from a chat model.

For Ollama, install it from [ollama.com](https://ollama.com), run `ollama pull qwen2.5:1.5b`, then select Ollama in AI setup. Model loading happens on demand; startup warming is off by default.

## Stop, review, and undo

**Stop** interrupts AI work. Chat, Ollama, and built-in local sorting plan before moving tabs, so stopping during planning leaves the layout unchanged. Decision sorting applies batches live; Stop keeps completed batches.

**Undo sort** restores the preceding layout during the current browser session, including native group membership, order, appearance, and collapsed state. It refuses to overwrite later layout edits. Failed or unresolved classifications keep their previous membership.

Changes to the workspace, eligible tabs, or relevant settings invalidate work in progress. The progress panel reports what happened and offers AI setup when a connection needs attention.

## Privacy

Opening setup does not contact an AI provider. OpenAI-compatible, Gemini, Custom, and Decision requests require explicit consent. Provider keys stay in local browser preferences and are excluded from backups and diagnostics.

The everyday chat, Ollama, and Decision paths use compact tab titles, hostname/path context, and current group names. URL credentials, query strings, and fragments are omitted. These paths do not download the pages behind your tabs.

Built-in local AI and advanced sorting may fetch small page snippets using browser cookies. Fetches are bounded to six concurrent requests, a 256 KiB HTML prefix per page, and a six-second context phase. Built-in inference stays on-device; Ollama receives context at the address you configure.

## More

- [Advanced tools and saved data](docs/advanced.md)
- [Architecture](docs/architecture.md)
- [Development and real Zen checks](docs/e2e-zen.md)
- [Overhaul verification and measurement limits](docs/overhaul-verification.md)
- [Changelog](CHANGELOG.md)

For development, use Node 20+ and run `npm run check`. When reporting a bug, include relevant Browser Console messages with the `[OpenTabSort]` prefix and omit credentials.

MIT.
