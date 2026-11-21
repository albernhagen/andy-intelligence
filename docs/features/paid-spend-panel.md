# Paid spend panel

Dashboards shows **Paid spend**: today and month to date for each project and for all projects, against the caps in force, with the share used (highlighted at 80% and at the cap). Spend the ledger can't read shows as unknown, never $0. Pay-per-use models only; subscription usage stays in the quota banner (AI-257: M10.9: Spend panel and cap alerts). Below it, **By provider** lists each provider's spend today and this month, for the project or all projects (AI-280's totals). At 80% of a daily or monthly cap, and when paid tasks stop at a cap (naming the ticket whose paid task was refused), a notice goes to the Needs-you email, once per cap and window and at most 10 a day; with email off it goes to the logs. A notice whose email fails is retried on the next spend event in its window.

**How to use:** open Dashboards for one project or for all projects; set caps in [project settings](spend-caps.md).
