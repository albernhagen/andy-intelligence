# 2026-11-04 — M1.7: Refinement built (AI-2)

- A refine run now asks Andy 1–5 questions. The agent returns them as structured output (`--json-schema` with `platform/procedures/refine.schema.json`); the control plane checks them against `RefineOutput` and writes them all-or-none, once per run (ADR-0054: Refine run protocol).
- The procedure moved from the prompt into `platform/procedures/refine.md` (ADR-0032); the executor workflow puts it before the run's prompt, from the platform's commit.
- Answering the last question on a Backlog ticket whose Definition of Ready is met moves it to Ready (`system`, `ifUpdatedAt`). Works from the UI and MCP `answer_question`.
- New MCP tool `refine` (ticket key → run). Andy still starts refine; starting it on ticket creation is M1.8: Build + gate's dispatcher.
- Caps: refine needs Backlog and no open questions; 3 refine runs per ticket. A failed run or a rejected result writes no questions.
- The refine run on AI-2 (agent comment, 2026-11-04) listed the gaps this slice closed: result channel, procedure doc, caps on agent questions, idempotent writes, the `ifUpdatedAt` check, a run cap, the failure path.
