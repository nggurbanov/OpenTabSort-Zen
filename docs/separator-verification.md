# Native divider and unique emoji — 2026-10-28

Source target: OpenTabSort-Zen **2.0.6**. This follow-up implements the user's native divider/hover/grouping-icon/Stop request and default-on unique emoji setting. Earlier dated records cover earlier surfaces.

## Native behavior

Real portable **Zen 1.23.4b + Sine** on dev-01, disposable profiles and deterministic local HTTP providers. The daily Zen profile, real tabs, provider credentials and model selection were untouched.

- `scripts/e2e-separator.mjs` passed with 120 synthetic tabs (three pinned, 117 eligible). WebDriver pointer movement and real pointer down/up operate the native grouping/Stop button. Idle opacity is zero away from the divider, hover reaches one, and busy Stop stays visible away from hover. The SVG changes from grouping rows to a Stop square.
- Busy progress uses the native toolbarseparator animation. The divider remains 22px high before and during work, with no sidebar/overlay progress row. Reduced motion gives a static line. Stop interrupts a held request and restores the grouping icon.
- Complete grouping decorates all target labels with distinct emoji. A repeat sort preserves native groups/names. Turning the setting off gives plain names on the next sort; Undo restores the decorated labels and identities.
- Native scrolling after apply keeps inline Undo reachable. The pinned section uses a measured sticky offset; ResizeObserver updates dimensions instead of measuring on each native move hook. Empty workspaces retain a usable divider for recovery.
- `scripts/e2e-live-sort.mjs` passed all six 120-tab scenarios with the new surface: ambient metadata updates, concurrent open/close/navigation/pin/manual grouping and pre-apply Undo, selected settings changes, consent revocation, Stop, and a real workspace switch. Held requests close before release; Retry completes a new sort and Undo. Recovery controls fit a 158px divider, including the empty destination workspace.
- `scripts/e2e-overhaul.mjs` passed Stop/settings guards, stable repeated grouping, retained prior Undo after a stopped follow-up, exact native Undo and cancelled review.
- `scripts/e2e-jev.mjs` passed its 300-tab Advanced and buffered primary Decision checks, including Stop, authentication failure, manual-edit protection, preview Cancel/Apply and Undo. Its fixed category-name fixture explicitly disables emoji formatting; the separator suite covers the enabled default.
- `scripts/e2e-settings.mjs` passed the real default-on checkbox, user toggling, light/dark themes, a narrow 340px primary form without horizontal overflow, provider keyboard navigation and retained Advanced data.

Functional receipts on dev-01: `/tmp/opentabsort-separator-functional-final.log`, `/tmp/opentabsort-separator-live.{log,json}`, `/tmp/opentabsort-separator-operations.log`, `/tmp/opentabsort-separator-decision.log`, `/tmp/opentabsort-separator-settings.log`. Each completed runner reports PASS and removes its disposable profile in finally.

Native images were inspected in bounded desktop light/dark and narrow-settings batches. Files are under `/tmp/opentabsort-separator-qa/` and `/tmp/opentabsort-separator-settings/` on dev-01. Later functional runs use `SEPARATOR_NO_SCREENSHOTS=1`; they do not establish a new visual benchmark.

## Local policy and regression gate

The checkbox is present in normal AI setup and the manifest with a true default. Emoji formatting adds no provider calls and does not invalidate planning: the preference is read again before application. Existing native destinations are resolved by exact names or an unambiguous plain-name alias before reconciliation; labels change only after successful placement, and Undo retains original labels. Untouched groups reserve their emoji. Unicode grapheme handling removes whole flags, keycaps and joined/skin-tone sequences without damaging ordinary numbers or multilingual text. Duplicate variation/skin-tone spellings share an allocation key.

Final `npm run check` passed **428/428 tests**, zero failures, with manifest, preference, security and retained-capability checks. Receipt: `/tmp/opentabsort-2.0.6-check.log` on dev-01. No long-session RSS, arbitrary-model grouping quality, or production-client update acceptance is claimed by these deterministic fixtures.
