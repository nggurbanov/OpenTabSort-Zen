# `modules/click-handler.mjs` — Tidy-click orchestrator

The function the toolbar button invokes. Sequences all the passes.

## Export

| Name | Notes |
|---|---|
| `handleOrganizeClick()` | async. Idempotent: clicking with nothing to do is a no-op. |

## Sequence

```
1.  wiggleButton()                    — 600ms wand animation for feedback
2.  consolidateDuplicateGroups(ws)    — merge same-named groups
3.  loadRules()                       — pref → file → defaults
4.  dissolveStaleGroups(ws, rules)    — eject tabs from non-rule groups
5.  getEligibleTabs()                 — fresh enumeration after #4
6.  runPass1(tabs, rules)             — plan moves
7.  console.groupCollapsed(...)       — dry-run logging
8.  applyPass1(byGroup, ws, rules)    — execute moves
9.  getAIEngine() === "off" ? skip Pass 2 : continue
10. setButtonThinking(true)           — start wand pulse animation
11. runPass2()                        — branches on engine:
       "local"  → ai.mjs runPass2()       (existing groups only)
       "ollama" → ollama.mjs runPass2Ollama() OR runPass2OllamaFresh()
                  depending on ai-new-group-behavior
12. Plan Mode gate (if applicable):
       getAINewGroupBehavior() in ("identify-only", "auto-add",
       "always-add" with new groups) → showPreviewModal(plan)
       Modal returns the user-edited plan. Apply waits for confirmation.
13. applyPass2(plan, ws, rules)       — execute moves; create new groups;
                                        optionally grow rules array
14. (fresh-categories mode) dissolve any group with zero tabs after rebuild
15. moveUngroupedToTop(ws)            — anything left ungrouped goes to top
16. syncAllGroupColors(ws, rules)     — push colors onto ALL rule-matched groups
17. logNestingDiagnostic()            — warn if any tab-group ended up nested
                                        (a Zen DOM-API edge case)
18. setButtonThinking(false)          — restore wand
19. console.groupEnd()
```

## Why dissolve runs BEFORE Pass 1

If a rule named "Calendar" gets renamed to "Schedule":
- `Calendar` is no longer in the rules → dissolved → its tabs land at the top, ungrouped
- Pass 1 then sees these tabs as ungrouped (no `currentGroup`)
- If their hostname matches a rule (e.g. the new `Schedule`), they get moved into Schedule

Without dissolve, the tabs would still be inside `Calendar` and Pass 1 would have to also handle the rename.

## Logging output

Every click produces a collapsed console group with:
- Per-tab assignment table (action column shows leave/stay/move/group)
- Pending moves by group
- Unmatched tabs (left in place)
- Apply result counts
- Color-sync count

Useful for debugging "why didn't my tab get grouped?" type questions — the assignment table shows exactly which rule matched (or didn't).
