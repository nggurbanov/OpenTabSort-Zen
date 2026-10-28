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

The operation row lives directly beneath the wand separator within the sidebar. It is (32px) high, with (2px 4px) padding and (4px) gaps; width follows the available sidebar. Status stays on one line with ellipsis, and contextual controls remain visible. The full text is available through the status tooltip and accessible label. If no sidebar anchor is available, a fallback overlay is bounded to `min(300px, calc(100vw - 16px))` near the wand.

The final native UI receipt reports no horizontal overflow in the primary form at a (446 × 984px) viewport. This is a verified fixture size, not a supported-device matrix.

## Elevation & Depth

The setup form stays flat within Sine's own dialog surface. Borders separate fields and Advanced; there are no decorative section cards in the primary form. The sidebar row has no border, filled surface, or shadow. Only the fallback overlay has a small shadow (`0 2px 8px rgb(0 0 0 / 15%)`). The chat/local review dialog uses the existing modal shadow (`0 14px 48px rgba(0, 0, 0, 0.35)`) and dark backdrop (`rgba(0, 0, 0, 0.45)`). Decision category review uses a native dialog and its own existing backdrop.

**The Purposeful Lift Rule.** Keep the sidebar row and setup form flat. Reserve the small shadow for fallback overlays and the larger existing shadow for modal review.

## Shapes

Fields and the operation row use softly rounded (6px) control corners; row actions use (4px) corners. Chat/local review and Decision review retain their distinct existing dialog radii. Saved domain/title chips remain pills and are confined to the editors and review surfaces that use them. Containers and controls use thin (1px) adaptive borders rather than decorative outlines.

## Components

### Connection fields and engine selection

A visible text label sits above each full-width native input or select. Connection fields are rendered for the chosen engine. API keys use password inputs with autocomplete disabled. Keyboard focus uses a (2px) system-accent outline with (2px) offset. Native selection, typing, checkbox, hover, and disabled behavior stay available.

The unconfigured state shows one engine selector. Remote setup adds the applicable consent checkbox; optional review is unchecked by default. The Decision engine shows the second AI connection in an inset fieldset with a legend.

### Advanced disclosure

A native `details/summary` control supplies keyboard interaction and open/closed semantics. Its summary is semibold with (14px) vertical padding. Content is hidden while collapsed; expensive editors initialize on first expansion. It returns to the primary view when setup is reopened.

### Sidebar feedback and contextual actions

The row contains a polite live status paragraph, a small busy indicator, and real HTML buttons. Stop appears while work runs; activating it disables the control and reports “Stopping…”. Completion replaces Stop with a valid Undo or the relevant Setup recovery action, plus an icon close button. Error labels are short (`AI offline`, `AI reply cut short`); complete recovery messages remain in the tooltip and accessible label. A successful primary run can say `300 tabs tidy`.

Success feedback dismisses after five seconds, pausing during hover or keyboard focus. Dismissal removes only feedback, preserving a valid session Undo receipt. Setup errors stay until dismissed. Escape dismisses completed feedback; it does not conceal an active Stop control.

Buttons inherit the host font and foreground, with transparent backgrounds, (24px) minimum height, and (2px) padding. Subtle foreground mixes indicate hover and press. A (2px) host-accent outline with (1px) offset marks keyboard focus; disabled Stop reduces opacity. The icon close button is (24px) square and has an explicit accessible name. These compact controls use HTML button keyboard semantics with browser-chrome styling.

The essential operation CSS is embedded in the module and mirrored in `styles/operations.css`, so first feedback remains styled when Sine has not resolved the external sheet. Advanced action buttons retain their separate existing treatment.

### Rule chips

Advanced chips use the monospace token, an adaptive border, and a small kind badge. Domain chips use the host accent; title chips use the retained violet accent. Chip bodies are drag handles with grab/grabbing cursors. Dragging lowers opacity; drop indicators are inset lines. Remove buttons brighten on hover. These are saved-data editor controls, not primary setup elements.

### Review dialogs

The existing native chat/local preview is bounded to the documented width and (80vh) height, with scrollable content inside the modal. Apply and Cancel govern whether a plan is committed; Escape cancels and focus returns to the prior control. Decision category review retains its editable names, descriptions, merge controls, and explicit sorting/cancel actions.

### Motion

The wand's existing click wiggle lasts (550ms); its thinking pulse repeats over (1.2s). Feedback enters over (120ms); its busy indicator rotates over (900ms). These indicate operation state without changing when AI work completes.

After native placement, a bounded FLIP translation settles at most (40) visible rows over (260ms), using `cubic-bezier(0.16, 1, 0.3, 1)`. It adds no artificial wait and does not animate hundreds of off-screen tabs. Independent translation on the native tab stack preserves Zen's transforms and inline styles. Scrolling, workspace change, a new run, or teardown cancels optional motion. Reduced motion skips placement effects and disables wand, feedback, spinner, and sort-highlight animations/transitions; Decision highlights also check the preference.

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
