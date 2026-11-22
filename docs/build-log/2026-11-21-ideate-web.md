# 2026-11-21 — AI-299: Parity: ideate from the web UI

Step 3 of AI-285 (parity). It is built on AI-134's ideate agent task (`POST …/ideate/agent-task`, PR #240).

- **Board:** an outline **Ideate** button in the header opens a form with one field, "Idea" (4,000 characters, the API's cap), and **Start ideate**. The button is outline so that the form's submit is the only filled button (`design.md`).
- **Progress:** once started, the form becomes the task's card. It links to the agent task page with its status, polled while the task is in flight. When the task ends, the card shows its summary ("Created epic AI-12 in Ideas with its spec draft PR …") or why it recorded nothing (for example, the hourly cap on ideas). Both are plain text from the task. The epic shows up in Backlog → Ideas through the board's own polling.
- **Same rules as MCP:** the route's service (`RunService.requestProjectTask`) refuses a second ideate task in flight, the project's agent-tasks-at-once dial and the global cap, and reserves spend. The form shows the API's message. The task records its result through `IdeateService`, as MCP `ideate` does, so it gets the same caps and outcomes. Like a manual Build start, it isn't blocked by the project's Paused switch, which stops dispatch's automatic starts.
- **Parity:** the Ideate entry in `parity.ts` loses its AI-299 pending mark and gains a note. AI-320 still owns the MCP tools for starting agent tasks and the project-plan control.
- **Hooks:** `useRun` moved from `RunPage.tsx` to `lib/queries.ts`, so the form and the agent task page poll the same way. `useStartIdeate` is new.
