# New project setup path

A new project opens on its setup path, `/p/<project>/setup` (AI-373), not an empty board. It has five steps, done in order on one card at a time (direction B's card, design review 2026-11-23):

| Step                     | What Andy does                                                                                            | Done when (read from the API)                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Create project           | Add project (name, key, repo)                                                                             | Always                                                             |
| Write the brief          | Answers four short pages; the brief is proposed as a PR, exactly as MCP `submit_brief` does; he merges it | `docs/product/brief.md` is on the default branch, or a plan exists |
| Plan milestones          | Starts the plan-project agent task                                                                        | A plan is proposed                                                 |
| Approve the plan         | Approves or parks each milestone (each shows its case), or sends the plan back with a note                | The plan is approved                                               |
| Baseline and first build | Merges the baseline PR, turns Builds on in settings                                                       | Baseline merged and Builds on                                      |

- `docs/product/discovery.md`'s Brief answers pre-fill a new brief (ADR-0145). The draft is kept in this browser as he types.
- While a project with no story tickets has a step left, the board shows the next step and one button that opens it.
- New read: `GET /api/projects/{id}/brief` (owner only): whether the brief is on the default branch, and discovery's answers.

**How to use:** picker → Add project. Come back from the board's setup bar.
