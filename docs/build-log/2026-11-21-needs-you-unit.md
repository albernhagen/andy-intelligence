# 2026-11-21 — AI-326: Needs you: one word, and each count names its unit

From the AI-322 UX review (quick win 2), option (B), which the coordinator picked.

- **One word:** the work view is "Needs you" on the board and on Work (`WORK_VIEW_LABELS`), never "Needs me". The MCP view name stays `needs-me`.
- **Two units, each named:** the header's "Needs you 6" and the inbox headings count things to answer: questions plus flagged tickets, stale ones included. The work chip counts open tickets, including tickets whose worker is still to be picked (ADR-0082), so it reads "Needs you · 4 tickets". The header link's tooltip says "6 questions or flagged tickets to answer". `design.md` says which counts what.
- **Follow-up:** AI-347 (M, not started) would count tickets everywhere, so the numbers match.
- **Screenshots:** the board's and Work's chips were re-rendered.
