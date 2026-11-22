# 2026-11-22 — AI-337: Phone board: one stage at a time

From AI-322: UX deep dive (larger change 3). At 390 px the board showed Backlog and a third of Ready, cut at the edge, and the first card started 440 px down, under the controls and six work view chips.

- **Fix:** below `sm` (`useIsPhone`), stage tabs with counts (`Segmented`, scrolling in their own strip) sit above one full-width lane. The board opens on the first stage holding a ticket that needs you (the Needs you work view), else In progress, counting only tickets the filters show (`openingStage` in `apps/web/src/lib/board.ts`). The chips become one View menu beside the title; Ideate, Group by epic, Epic and Show cancelled sit under an Options button, which shows how many of them are on. Drag still reorders within the lane; moving between stages is the ticket panel's Move. Desktop is unchanged.
- **Result:** the first card starts 240 px under the header on Backlog, the tallest lane top (its quick add and Up next and Ideas headers).
- **Check:** `phone-board.spec.ts`: opening stage, one full-width lane, first card within 250 px, every tab fits 390 px, View menu in the URL, Options. AI-334's title-row check now opens Options first.
- **Screenshots:** rendered in CI's Docker image; two new phone images (`phone-board.png`, `phone-board-in-progress.png`), `phone-shell-board-more.png` changed, no desktop image changed.
