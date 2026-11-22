# Project agent tasks

Andy starts plan-project (milestones for a new project) or ideate (an idea into an epic and a spec draft) as an agent task. It runs read-only on the project's repo, one of each per project at a time; its result is stored as a submitted one: the plan waits for approval in Needs-you, the idea becomes an epic with a spec PR or a question

**How to use:** Project settings → Project plan → **Start plan-project task**; MCP `start_plan_project` (`project`) and `start_ideate` (`project`, `idea`), with the same caps and refusals as the routes (AI-320); or `POST /api/projects/<id>/plan/agent-task`, `POST /api/projects/<id>/ideate/agent-task` with `{"idea": "…"}`; see [project plans](project-plans.md)
