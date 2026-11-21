# Milestone dispatch rule

Refine, build and night-launch dispatch start a ticket only when its milestone is approved, or it has none (ADR-0131: Milestones; AI-306: M4.36). A ticket's milestone is its top-level epic's. A held ticket stays where it is:

| Where                             | What it shows                                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Ticket status line (MCP `status`) | In Up next or Ready: "Waiting: Milestone M6: Dev to prod is parked" (or "is not reviewed")                                  |
| Project dispatch decision         | `milestone_held` when that is the only reason no Ready ticket started: "Ready tickets wait: their milestone isn't approved" |
| Night launch                      | refused, with the same reason in its list of problems                                                                       |

Fails closed: a milestone that can't be read holds its tickets ("Milestone <id> can't be read"). A ticket with no milestone runs as before, so nothing changes until a project has milestones. Each dispatch reads each milestone once (`get`, never the project's list) and at most one more epic per child epic.

**How to use:** approve or park a milestone (AI-304: M4.34 adds the tools); MCP `status` with a ticket's key shows why it waits; `status` without one shows the project's last dispatch decision.
