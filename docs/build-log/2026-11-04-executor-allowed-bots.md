# 2026-11-04 — Executor: allow the App's bot to start runs (AI-1: M1.6a: Claude Code executor)

- Second live run (Actions run 41761036430 on AI-1): dispatch, context, report and the ticket comment all worked; the agent step stopped in under a second with `Workflow initiated by non-human actor: andy-intelligence-control (type: Bot)`. `claude-code-action` refuses runs started by a bot unless it is in `allowed_bots`, and the control plane's App starts every run. No agent ran; no Claude quota used.
- Fix: `allowed_bots: andy-intelligence-control` in `claude-executor.yml` (exact name; never `*` on a public repo). Runbook troubleshooting row added; threat model notes who can start the executor agent.
- Follow-ups Andy raised, as tickets: AI-8 (MCP stage-move and comment tools, devkit lifecycle), AI-9 (live UI updates with polling fallback; ADR first), AI-10 (drag tickets between stage columns).
