# Epics on the board

An epic gets no board card, since nobody builds it; lanes, lane counts and work-view chips leave epics out (AI-403). Its tickets sit under its header (Group by epic, and Ideas): key and title link to the epic's panel, with "N of M done" (Done of non-Cancelled tickets). A child epic's header names its parent. The roadmap lists every epic under its milestone, child epics indented, then a No milestone group. MCP `board` and `status` still list and count epics, for agents, so their per-stage counts can be higher than the web board's; AI-404 settles parity.

**How to use:** turn on Group by epic, or open Ideas, and click an epic's title. An epic with no tickets: pick it in the board's Epic filter and click Open, or find it on the Roadmap or with Cmd+K. Create one with New epic on a [milestone page](milestone-page.md), or add a ticket and set its Type to Epic in its panel.
