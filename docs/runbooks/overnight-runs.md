# Overnight runs — runbook (Andy)

Launch an epic for the night and stop it early (ADR-0049: Overnight runs). Built so far: the launch step (AI-120: M4.17). **Nothing dispatches from a launch yet**: the dispatcher's budget and stop time are M4.18, the epic branch M4.20 and the morning report M4.22. Until then a launch records your budget and stop time and shows progress, but agent tasks start as usual (auto-build and the dial).

| Term      | Meaning                                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Launch    | One night for one epic: its open stories (not Done, Cancelled or archived), a budget and a stop time. One active launch per project |
| Budget    | Max agent tasks (≤ 100), max tokens in plus out (≤ 50,000,000), max API-equivalent USD (≤ 500); all three required                  |
| Stop time | When the night stops starting agent tasks; at most 16 hours after the launch                                                        |
| Stopping  | No new agent tasks start; the ones in flight finish                                                                                 |

## 1. Get the epic ready

Open the epic (board → its card, or `/p/<project>/t/<KEY>`). Under the stories, **Plan the night** lists each open story with what blocks it:

- **Question:** an open question. Click it, answer it on the ticket.
- **Plan:** an M, L or unsized story needs an approved plan. "No plan yet": start a plan task from the ticket's Activity; "Plan awaiting approval": click it, approve or reject on the agent task page or the ticket's Activity.
- **Not Ready:** move the story to Ready.

Launch stays off, with the reasons under the form, until every story is clear and no other launch runs in the project. At most 50 open stories per launch.

## 2. Launch

Fill in max agent tasks, max tokens, max USD and the stop time, then **Launch**. A refusal lists every problem by ticket key; fix them and launch again.

Over MCP (Claude):

1. `night_status` with the epic's key: the same checklist.
2. `launch_night` with `ticket`, `maxRuns`, `maxTokens`, `maxUsd`, `stopAt` (ISO 8601).

## 3. Watch and stop

While it runs, the section shows stories done, running, stopped (flagged Needs-you or cancelled) and waiting, and the spend of the stories' agent tasks since the launch against the budget. Tasks without a usage report count as unknown, never $0.

To stop early: **Stop** in the section, or MCP `stop_night` with the epic's key. The launch shows **Stopping** while its stories still have agent tasks in flight, then ends ("stopped"). A launch past its stop time ends too ("stop_time"). Both are checked whenever the section, `night_status`, a launch or a stop reads the launch, so an over night never blocks the next one. M4.18 will end launches on its own.
