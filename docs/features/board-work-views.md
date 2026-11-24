# Board work views

Chips beside the board's title narrow it to one fixed view, each with its count of open tickets: Needs you (an open question, flagged, or a worker to pick). Its number is the header's: tickets, one per inbox card, for the same scope. Extra parts are named when not 0: "Needs you · 4 tickets · 1 stale · 2 to pick a worker". Stale: Done with an open question, counted but not listed. To pick a worker: listed, not counted, as the inbox leaves them out (AI-347), Mine, Agents, Blocked and In review. The choice is in the URL, so a view can be linked; it combines with the epic filter, and cards still drag as usual (AI-187, ADR-0108). On a phone the chips are one View menu (AI-337).

**How to use:** On a project's board, click a chip; All shows everything again. Link straight to one with `/p/<project>?view=blocked` (`needs-me`, `mine`, `agents`, `blocked`, `in-review`).
