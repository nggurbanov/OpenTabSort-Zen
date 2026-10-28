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
  operation-border: "var(--zen-colors-border, color-mix(in srgb, currentColor 25%, transparent))"
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
  panel: "8px"
  review: "12px"
  decision-review: "16px"
  chip: "999px"
spacing:
  field-label-gap: "6px"
  action-gap: "10px"
  nested-gap: "12px"
  panel-padding: "14px"
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
  operation-panel:
    backgroundColor: "{colors.operation-surface}"
    textColor: "{colors.operation-text}"
    rounded: "{rounded.panel}"
    padding: "{spacing.panel-padding}"
    width: "min(360px, calc(100vw - 32px))"
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

The small AI setup and operation panel share this native character with the retained editors. Provider-specific fields appear when relevant; advanced tools sit behind a native disclosure. Theme adaptation comes from CSS system colors and Zen variables, not fixed light/dark screen palettes.

**Key Characteristics:**

- Host-controlled colors and typography.
- Compact controls with explicit keyboard focus.
- A quiet settings surface and persistent operation feedback.
- Native dialogs and disclosure, with bounded widths and wrapping content.

This is an extraction of the current implementation, not a new identity. Sources are [userChrome.css](userChrome.css), [operation styles](styles/operations.css), [simple settings](modules/simple-settings.mjs), [operation UI](modules/operation-ui.mjs), and [review dialogs](modules/preview-modal.mjs). The final settings receipt is `/tmp/opentabsort-simple-ui-final/metadata.json` (2026-10-28 04:09:34 UTC); it covers light, dark, narrow, and expanded states.

## Colors

The palette belongs to Zen and the operating system. The frontmatter preserves CSS color keywords, mixed colors, and host-variable bindings as the normative values.

### Primary

- **Host accent** marks keyboard focus, progress, and domain chips. The operation panel prefers Zen's primary variable and falls back to the system accent.
- **Title-chip accent** is the existing violet marker for title rules in Advanced. It is a chip distinction, not an application brand color.

### Neutral

- **Canvas / Canvas text** keep modal review opaque and readable, including platforms with translucent browser chrome.
- **Field / Field text** style native-looking connection inputs and selects.
- **Operation surface / text / border** inherit Zen's tertiary surface, toolbar text, and border variables, with system-color fallbacks.
- **Control border / section divider** use low-opacity mixes of the current foreground to adapt to the host theme.
- **Category error** uses the existing light/dark error pair in the advanced category editor.

**The Host Theme Rule.** System colors and Zen variables remain the color authority; a screenshot's resolved hex values are not new palette tokens.

No independent secondary palette or synthesized tonal ramp is established.

## Typography

Settings inherit the host interface font. Operation feedback uses the platform `font: menu` shorthand; this is intentionally not represented as a fixed font family. Rule chips use the existing monospace stack.

The setup title is the only large heading in the compact primary form. Field labels, suggestion legends, and the Advanced summary use semibold weight. Helper text and operation messages use relaxed line heights for multi-line reading. Exact observed type tokens are in the frontmatter; there is no display-font tier or external font asset.

**The Host Type Rule.** Inherit Zen's interface font; use the platform menu font for the operation panel and the existing monospace stack for rule chips.

## Layout

The Sine settings dialog is bounded by `min(720px, calc(100vw - 32px))`, with the same viewport allowance vertically. Its content has (16px) padding, and the primary form is centered at a maximum width of (640px). Connection fields form a single-column grid; field labels sit above their controls. Inputs and selects have a minimum height of (36px), full available width, and zero minimum width to allow shrinking.

The Advanced disclosure has a top divider and (28px) separation. Its retained preference rows stack into one column; the older rule grid reflows at (700px), placing domain chips below the rule name. The existing smaller action-row breakpoint is (520px).

The operation panel sits (16px) from the inline start and bottom of the browser viewport. Its width is bounded by the operation-panel token; buttons wrap, messages break long text, and progress spans the panel. Notifications use the opposite inline edge.

The final native UI receipt reports no horizontal overflow in the primary form at a (446 × 984px) viewport. This is a verified fixture size, not a supported-device matrix.

## Elevation & Depth

The setup form stays flat within Sine's own dialog surface. Borders separate fields and Advanced; there are no decorative section cards in the primary form. The operation panel has a small shadow (`0 2px 8px rgb(0 0 0 / 15%)`). The chat/local review dialog uses the existing modal shadow (`0 14px 48px rgba(0, 0, 0, 0.35)`) and dark backdrop (`rgba(0, 0, 0, 0.45)`). Decision category review uses a native dialog and its own existing backdrop.

**The Purposeful Lift Rule.** Use the small operation shadow for transient feedback and the larger existing shadow for modal review; keep the setup form flat.

## Shapes

Fields use softly rounded control corners; operation panels use the panel radius. Chat/local review and Decision review retain their distinct existing dialog radii. Saved domain/title chips remain pills and are confined to the editors and review surfaces that use them. Containers and controls use thin (1px) adaptive borders rather than decorative outlines.

## Components

### Connection fields and engine selection

A visible text label sits above each full-width native input or select. Connection fields are rendered for the chosen engine. API keys use password inputs with autocomplete disabled. Keyboard focus uses a (2px) system-accent outline with (2px) offset. Native selection, typing, checkbox, hover, and disabled behavior stay available.

The unconfigured state shows one engine selector. Remote setup adds the applicable consent checkbox; optional review is unchecked by default. The Decision engine shows the second AI connection in an inset fieldset with a legend.

### Advanced disclosure

A native `details/summary` control supplies keyboard interaction and open/closed semantics. Its summary is semibold with (14px) vertical padding. Content is hidden while collapsed; expensive editors initialize on first expansion. It returns to the primary view when setup is reopened.

### Operation panel and action buttons

The native-looking panel contains a polite live status paragraph, progress, and real buttons. While planning, progress can be indeterminate; live Decision batches show determinate processed/total counts. Stop disables itself and changes status to “Stopping…”. On completion, progress and Stop hide; Undo appears when a valid receipt exists, and Dismiss becomes available. Connection failures can expose AI setup.

Operation buttons use native appearance, inherited font, a minimum height of (30px), and (4px 10px) padding. Their explicit focus ring follows the host accent. Disabled Stop uses the native disabled treatment. Advanced action buttons retain their separate small, mixed-foreground background and hover treatment.

### Rule chips

Advanced chips use the monospace token, an adaptive border, and a small kind badge. Domain chips use the host accent; title chips use the retained violet accent. Chip bodies are drag handles with grab/grabbing cursors. Dragging lowers opacity; drop indicators are inset lines. Remove buttons brighten on hover. These are saved-data editor controls, not primary setup elements.

### Review dialogs

The existing native chat/local preview is bounded to the documented width and (80vh) height, with scrollable content inside the modal. Apply and Cancel govern whether a plan is committed; Escape cancels and focus returns to the prior control. Decision category review retains its editable names, descriptions, merge controls, and explicit sorting/cancel actions.

### Motion

The wand's existing click wiggle lasts (550ms); the thinking pulse repeats over (1.2s). Motion supports operation state. The shared operation stylesheet disables wand, spinner, and sort-highlight animation/transition when reduced motion is requested; Decision highlights also check that preference before running.

## Do's and Don'ts

### Do:

- **Do** inherit system colors and Zen variables so the user's theme stays authoritative.
- **Do** retain visible focus, native labels, masked API-key fields, and polite status announcements.
- **Do** use the documented control, panel, and review shapes for their existing roles.
- **Do** let fields, action rows, and long status text wrap within the host dialog.

### Don't:

- **Don't** replace the inherited theme with a new fixed brand palette or downloadable font.
- **Don't** promote advanced rule chips or category editors into the simple connection form.
- **Don't** hide an active operation or remove Stop/Undo feedback to make the surface look quieter.
- **Don't** present decorative motion when reduced motion is requested.
