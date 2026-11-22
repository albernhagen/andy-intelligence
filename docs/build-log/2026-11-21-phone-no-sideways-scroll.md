# 2026-11-21 — AI-325: Phone: no screen scrolls sideways

From AI-322: UX deep dive (quick win 1). At 390 px the board, ticket panel, epic panel and dashboards were wider than the screen.

| Screen                               | Was    | Cause                                                                                                                             | Fix                             |
| ------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Board, ticket panel (over the board) | 837 px | The lanes' `sr-only` text is absolutely placed; the lane scroller wasn't positioned, so that text escaped it and widened the page | `relative` on the lane scroller |
| OPS board, epic panel                | 569 px | As above, plus the title row (Group by epic, Epic, Show cancelled) didn't wrap                                                    | The title row wraps             |
| Dashboards                           | 402 px | The stage legend didn't wrap                                                                                                      | The legend wraps                |

**Check:** `apps/web/e2e/phone.ts` `expectPageFits` fails when `document.documentElement.scrollWidth` exceeds the viewport, and names the elements at the right edge. Every phone screenshot spec calls it; `phone-width.spec.ts` covers the board, OPS board, epic panel and both dashboards. Desktop screenshots are unchanged; one phone image changed (the board's title row wraps).
