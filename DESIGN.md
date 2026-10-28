---
name: OpenTabSort Zen
description: Native Zen utility controls for organizing crowded workspaces.
colors:
  accent: "AccentColor"
  operation-accent: "var(--zen-primary-color, AccentColor)"
  canvas: "Canvas"
  canvas-text: "CanvasText"
  field: "Field"
  field-text: "FieldText"
  operation-surface: "var(--zen-colors-tertiary, Canvas)"
  operation-text: "var(--toolbar-color, CanvasText)"
  control-border: "color-mix(in srgb, currentColor 25%, transparent)"
  section-divider: "color-mix(in srgb, currentColor 18%, transparent)"
  domain-chip-surface: "color-mix(in srgb, AccentColor 12%, transparent)"
  domain-chip-border: "color-mix(in srgb, AccentColor 30%, transparent)"
  title-chip-accent: "#b56cff"
  category-error: "light-dark(#a82020, #ffaaaa)"
typography:
  body:
    fontFamily: "inherit"
  setup-title:
    fontSize: "20px"
  field-label:
    fontWeight: 600
  helper:
    fontSize: "12px"
    lineHeight: 1.45
  rule-chip:
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
    fontSize: "12px"
rounded:
  control: "6px"
  review: "12px"
  decision-review: "16px"
  chip: "999px"
spacing:
  field-label-gap: "6px"
  action-gap: "10px"
  nested-gap: "12px"
  connection-gap: "16px"
  intro-after: "24px"
  advanced-before: "28px"
components:
  setup-field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.field-text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "7px 10px"
  operation-row:
    backgroundColor: "transparent"
    textColor: "{colors.operation-text}"
    rounded: "{rounded.control}"
    padding: "2px 4px"
    minHeight: "32px"
  domain-chip:
    backgroundColor: "{colors.domain-chip-surface}"
    typography: "{typography.rule-chip}"
    rounded: "{rounded.chip}"
    padding: "2px 2px 2px 5px"
  review-dialog:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.canvas-text}"
    rounded: "{rounded.review}"
    width: "min(640px, 92vw)"
---

# Design System: OpenTabSort Zen

## Overview

**Creative North Star: "Native Zen utility"**

OpenTabSort is a utility inside Zen browser chrome. Its established visual system inherits the host theme, system controls, and platform typography. It uses compact fields, restrained borders, and readable status messages rather than a separate brand palette.

The small AI setup and compact sidebar row share this native character with the retained editors. Provider-specific fields appear when relevant; advanced tools sit behind a native disclosure. Theme adaptation comes from CSS system colors and Zen variables, not fixed light/dark screen palettes.

**Key Characteristics:**

- Host-controlled colors and typography.
- Compact controls with explicit keyboard focus.
- A quiet settings surface and contextual sidebar feedback.
- Native dialogs and disclosure, with bounded widths and wrapping content.

This is an extraction of the current implementation, not a new identity. Sources are [userChrome.css](userChrome.css), [operation styles](styles/operations.css), [simple settings](modules/simple-settings.mjs), [operation UI](modules/operation-ui.mjs), and [review dialogs](modules/preview-modal.mjs). The 2.0.0 settings receipt remains `/tmp/opentabsort-simple-ui-final/metadata.json` (2026-10-28 04:09:34 UTC). The 2.0.1 sidebar receipt is `/tmp/opentabsort-tidy-ui/metadata.json` (04:51:32 UTC), covering native light, dark, narrow, keyboard, dismissal, and reduced-motion behavior. [Follow-up verification](docs/tidy-verification.md) records the limits and later wording changes.

## Colors

The palette belongs to Zen and the operating system. The frontmatter preserves CSS color keywords, mixed colors, and host-variable bindings as the normative values.

### Primary

- **Host accent** marks keyboard focus and domain chips. Feedback focus prefers Zen's primary variable and falls back to the system accent.
- **Title-chip accent** is the existing violet marker for title rules in Advanced. It is a chip distinction, not an application brand color.

### Neutral

- **Canvas / Canvas text** keep modal review opaque and readable, including platforms with translucent browser chrome.
- **Field / Field text** style native-looking connection inputs and selects.
- **Operation text** inherits Zen's toolbar text. The sidebar row is transparent; only the fallback overlay uses Zen's tertiary surface, with a system-color fallback.
- **Control border / section divider** use low-opacity mixes of the current foreground to adapt to the host theme.
- **Category error** uses the existing light/dark error pair in the advanced category editor.

**The Host Theme Rule.** System colors and Zen variables remain the color authority; a screenshot's resolved hex values are not new palette tokens.

No independent secondary palette or synthesized tonal ramp is established.

## Typography

Settings inherit the host interface font. Operation feedback uses the platform `font: menu` shorthand; this is intentionally not represented as a fixed font family. Rule chips use the existing monospace stack.

The setup title is the only large heading in the compact primary form. Field labels, suggestion legends, and the Advanced summary use semibold weight. Helper text and operation messages use relaxed line heights for multi-line reading. Exact observed type tokens are in the frontmatter; there is no display-font tier or external font asset.

**The Host Type Rule.** Inherit Zen's interface font; use the platform menu font for the operation row and the existing monospace stack for rule chips.

## Layout

The Sine settings dialog is bounded by `min(720px, calc(100vw - 32px))`, with the same viewport allowance vertically. Its content has (16px) padding, and the primary form is centered at a maximum width of (640px). Connection fields form a single-column grid; field labels sit above their controls. Inputs and selects have a minimum height of (36px), full available width, and zero minimum width to allow shrinking.

The Advanced disclosure has a top divider and (28px) separation. Its retained preference rows stack into one column; the older rule grid reflows at (700px), placing domain chips below the rule name. The existing smaller action-row breakpoint is (520px).

The primary control lives in the native pinned/unpinned tab divider beside Clear. It uses a 16px grouping SVG inside a 28px target, revealed on divider hover or keyboard focus. Busy state replaces it with a filled Stop square and keeps it visible. Animate a thin sweep along the native toolbarseparator, with a static line for reduced motion. Do not create a separate progress row or shift tab layout. While feedback exists, pin the existing section so Stop and inline Undo/Retry/Setup remain reachable during native scrolling; reset it when feedback is dismissed. The older compact row/overlay remains only a fallback when no native divider exists.

The final native UI receipt reports no horizontal overflow in the primary form at a (446 × 984px) viewport. This is a verified fixture size, not a supported-device matrix.

## Elevation & Depth

The setup form stays flat within Sine's own dialog surface. Borders separate fields and Advanced; there are no decorative section cards in the primary form. The sidebar row has no border, filled surface, or shadow. Only the fallback overlay has a small shadow (`0 2px 8px rgb(0 0 0 / 15%)`). The primary plan review dialog uses the existing modal shadow (`0 14px 48px rgba(0, 0, 0, 0.35)`) and dark backdrop (`rgba(0, 0, 0, 0.45)`) for all engines, including Decision. Advanced Decision category review uses a native dialog and its own existing backdrop.

**The Purposeful Lift Rule.** Keep the sidebar row and setup form flat. Reserve the small shadow for fallback overlays and the larger existing shadow for modal review.

## Shapes

Fields and the operation row use softly rounded (6px) control corners; row actions use (4px) corners. Primary plan review and Advanced Decision category review retain their distinct existing dialog radii. Saved domain/title chips remain pills and are confined to the editors and review surfaces that use them. Containers and controls use thin (1px) adaptive borders rather than decorative outlines.

## Components

### Connection fields and engine selection

A visible text label sits above each full-width native input or select. Connection fields are rendered for the chosen engine. API keys use password inputs with autocomplete disabled. Keyboard focus uses a (2px) system-accent outline with (2px) offset. Native selection, typing, checkbox, hover, and disabled behavior stay available.

The unconfigured state shows one engine selector. Remote setup adds the applicable consent checkbox; optional review is unchecked by default. The Decision engine shows the second AI connection in an inset fieldset with a legend.

### Advanced disclosure

A native `details/summary` control supplies keyboard interaction and open/closed semantics. Its summary is semibold with (14px) vertical padding. Content is hidden while collapsed; expensive editors initialize on first expansion. It returns to the primary view when setup is reopened.

### Divider feedback and contextual actions

Progress belongs to the existing separator line. Use the host foreground, transparent grouping button, subtle native hover fill, and a clear focus outline. The icon represents grouped rows; there is no wand, sparkle, rotating icon or artificial delay. Stop stays visible and disables only while acknowledging cancellation.

Show one contextual inline action after completion: Undo, or Setup/Retry recovery, with a small SVG dismiss control. These controls add no new row. Announce full progress/outcome text through a polite live status and expose descriptions/tooltips on controls. Successful feedback dismisses after five seconds, paused on action hover or focus; recovery remains until dismissed. Removing feedback preserves a valid session Undo receipt. Dispose listeners, observers and timers when the row is removed or the window unloads.

AI setup includes a default-on checkbox for distinct emoji prefixes. Preserve available existing icons, reserve icons used by untouched groups, replace duplicates locally, and keep plain text/Unicode intact. Disabling the preference affects the next applied sort; no AI request is restarted for this appearance change.

### Review dialogs

Every primary engine uses the native plan preview, bounded to the documented width and (80vh) height, with scrollable content inside the modal. The Decision engine finishes all classification batches before opening this preview. Apply and Cancel govern whether a plan is committed; Escape cancels and focus returns to the prior control. Advanced Decision category review retains its editable names, descriptions, merge controls, and explicit sorting/cancel actions.

### Browsing while planning

The busy state does not freeze the tab list. Background title updates and added or closed tabs do not turn into an error for the entire sort. The completed plan is reconciled with current native tabs: new tabs remain outside the operation, and navigated, pinned, manually moved or regrouped tabs and renamed groups are protected. Undo restores the state immediately before apply, preserving activity during planning; a later title update alone does not disable it. A workspace or selected AI setup change still stops the pending operation with its own concise recovery label.

### Motion

Reveal the idle grouping icon over (140ms). While busy, sweep the existing divider line over (1600ms), preserving its dimensions; Stop itself stays still. No click wiggle, thinking pulse, rotating icon, progress panel entrance or artificial wait belongs to this native control.

After native placement, a bounded FLIP translation settles at most (40) visible rows over (260ms), using `cubic-bezier(0.16, 1, 0.3, 1)`. It adds no artificial wait and does not animate hundreds of off-screen tabs. Independent translation on the native tab stack preserves Zen's transforms and inline styles. Scrolling, workspace change, a new run, or teardown cancels optional motion. Reduced motion skips placement effects and disables divider movement, fallback feedback, spinner, and sort-highlight animations/transitions; Decision highlights also check the preference.

## Do's and Don'ts

### Do:

- **Do** inherit system colors and Zen variables so the user's theme stays authoritative.
- **Do** retain visible focus, native labels, masked API-key fields, and polite status announcements.
- **Do** use the documented control, row, and review shapes for their existing roles.
- **Do** let settings fields and action rows wrap within the host dialog; keep sidebar feedback to one line with its full accessible message.

### Don't:

- **Don't** replace the inherited theme with a new fixed brand palette or downloadable font.
- **Don't** promote advanced rule chips or category editors into the simple connection form.
- **Don't** hide an active Stop control or delete the session Undo receipt when feedback disappears.
- **Don't** present decorative motion when reduced motion is requested.
