# Project agent tasks

Andy starts plan-project (milestones for a new project) or ideate (an idea into an epic and a spec draft) as an agent task. It runs read-only on the project's repo, one of each per project at a time; its result is stored as a submitted one: the plan waits for approval in Needs-you, the idea becomes an epic with a spec PR or a question

**How to use:** Board → **Ideate**: type the idea, **Start ideate**, and the form shows the task until its epic lands in Ideas (AI-299); or `POST /api/projects/<id>/plan/agent-task`, `POST /api/projects/<id>/ideate/agent-task` with `{"idea": "…"}`; see [project plans](project-plans.md)
