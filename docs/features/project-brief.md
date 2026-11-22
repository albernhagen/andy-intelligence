# Project brief

Each project's product context in `docs/product/brief.md` (ADR-0053): written from the onboarding answers as a PR Andy merges. Agent tasks read it: at dispatch the control plane puts it in the prompt as untrusted, escaped, capped data; refine gets all of it, plan and build the Architectural expectations (ADR-0117), which include the design direction and where the design file lives (ADR-0132). No brief: the task starts without one.

**How to use:** MCP `submit_brief` with the answers from [`onboard.md`](../../platform/procedures/onboard.md), then merge the brief PR.
