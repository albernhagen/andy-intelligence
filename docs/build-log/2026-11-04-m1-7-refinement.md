# 2026-11-04 — M1.7: Refinement built (AI-2)

- A refine run now asks Andy 1–5 questions. The agent returns them as structured output (`--json-schema` with `platform/procedures/refine.schema.json`); the control plane checks them against `RefineOutput` and writes them all-or-none, once per run (ADR-0054: Refine run protocol).
- The procedure moved from the prompt into `platform/procedures/refine.md` (ADR-0032); the executor workflow puts it before the run's prompt, from the platform's commit.
- Answering the last question on a Backlog ticket whose Definition of Ready is met moves it to Ready (`system`, `ifUpdatedAt`). Works from the UI and MCP `answer_question`.
- Refine starts by itself (Andy, 2026-11-04: "the system should not rely on me taking manual actions"): `RefineDispatcher` runs on ticket create, on a last answer that leaves the DoR unmet, and after each run's report, one run per project at a time, oldest ticket first. Per-project `autoRefine` (default on) is the off switch: UI `/projects`, `PATCH /api/projects/{p}`, MCP `set_auto_refine`. A failed refine or dispatch, or a 3rd pass with the DoR unmet, flags Needs-you and isn't retried.
- Refine also proposes size, size reason and tier, written only where the ticket has none, so answers alone can meet the DoR (resolves the build-log tier decision).
- New MCP tools `refine` (ticket key → run, for when auto-refine is off or a refine failed) and `set_auto_refine`.
- Caps: refine needs Backlog and no open questions; 3 refine runs per ticket. A failed run or a rejected result writes no questions.
- The refine run on AI-2 (agent comment, 2026-11-04) listed the gaps this slice closed: result channel, procedure doc, caps on agent questions, idempotent writes, the `ifUpdatedAt` check, a run cap, the failure path.
