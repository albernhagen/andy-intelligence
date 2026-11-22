# 2026-11-21 — AI-320: Parity: start the project-plan and ideate agent tasks from the web UI and MCP

The parity registry test (AI-300) found these on PR #240. AI-134 added `POST …/plan/agent-task` and `POST …/ideate/agent-task`, but nothing in the web or MCP called them.

- **MCP** (`mcp/tools-project-tasks.ts`, new group `projectTasks`):
  - `start_plan_project` takes `project`; `start_ideate` takes `project` and `idea` (1 to 4,000 characters).
  - Both call `RunService.requestProjectTask`, as the routes do. That gives the same owner check and the same caps: one task of each kind in flight per project, the agent-tasks-at-once dial, the cap across projects, and the spend reservation. The refusal text is the same too.
  - Both return what `build` and `refine` return about a started task.
- **Web, plan-project:** the Project plan card on project settings has an outline **Start plan-project task** button when there is no plan or the last one was rejected. After the start it links to the agent task. The card polls, so the proposed plan shows when the task finishes. The ideate form is AI-299 (PR #366).
- **Pause and quota:** as with a manual Build start, the owner's start isn't held by the Paused switch or the quota reserve, which stop dispatch's automatic starts. The descriptions say each start spends Claude quota.
- **Parity:** the "Start a project agent task" entry now names both tools, moves out of the open gaps, and loses its pending mark.
- **Tests:** `project-task-tools.test.ts` runs MCP against REST on one in-process app. It covers a start over each, a second start refused with the same text on both sides, the dial, GitHub not connected, and a blank idea. The web tests cover the button starting a task and showing the API's refusal.
