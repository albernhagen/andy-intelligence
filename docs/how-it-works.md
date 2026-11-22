# How it works today: the full list

What is built on `main` now, moved from `README.md` so its "How it works today" stays one screen. Update it in the same PR as the change; one feature's detail: [`docs/features/`](features/).

**Working:**

- tickets on a board (Backlog split into Up next and Ideas; only Up next gets refined; cards show size, risk and confidence; Ready sorts by them; MCP `list_ready` filters them; MCP `board` reads it) with a Needs-you inbox, answerable in the UI or with the `/inbox` skill in Claude Code; a Claude connector (MCP) with every ticket decision the UI offers; GitHub PRs that move tickets; Refine and Build agent tasks on GitHub Actions; PR checks and review agents; the merge gate (an agent PR merges itself when checks and reviews pass, no veto applies and `autoMerge` covers its size; `AI` stays `none`); Dependabot; the project baseline; agent evals (runbook `agent-evals.md`); cost guardrails.
- Each feature: [`docs/features/`](features/).
- Each project has a default worker (agent, Andy or ask) and executor (GitHub Actions or a local runner); a ticket can override both; only an agent's tickets build.
- Settings → Local runners mints secrets for `apps/local-runner` (refine and plan on Andy's Mac, ADR-0089).
- Project settings (`/p/<project>/settings`): switches, setup checklist, changes with Revert.
- Pages poll: 5 s in use, 60 s idle, none hidden (ADR-0091).
- Keyboard: `?` lists the shortcuts (AI-338).
- A header gauge and banner show Claude quota from task reports; on a phone the header shows the fullest window and a one-tap **Pause**/**Resume** (AI-176).
- Ticket panel: next move first; worker, executor, routing under How it runs (AI-336).
- Agent task cost: ticket panel, Activity (links each task's page), MCP `status`.
- Epics: stories, cost; map: MCP `milestone_map`; Roadmap (header, MCP `roadmap`): milestones and their epics; epics and the board's epic groups show their milestone's status, which Andy sets there or on the roadmap (AI-311).
- Dispatch starts a ticket only when its milestone is approved or it has none (AI-306).
- A daily digest (What's new → Digest, MCP `digest`) lists the last 24 hours: exceptions, merges and cost, work in progress, totals.
- What's new (header, MCP `whats_new`): milestones, merged PRs' release notes.
- Dashboards chart delivery and cost per week (AI-117), and a project's DORA metrics over 30 or 90 days from its production deployment records (AI-200; lead time not measured until commit times are recorded).
- Needs-you email (AI-77): each ticket that needs Andy, batched per 10 minutes, 20 a day; off until configured (runbook `email-notifications.md`).
- Config proposals (inbox, MCP): a finding kind on 3+ PRs becomes a pending `AGENTS.md` change, never applied; idle until findings are stored (ADR-0097).

**Dispatch:**

- with auto-build on, Ready tickets start from the top, up to the project's "Agent tasks at once" dial (default 2, max 4), 4 across projects (1 at quota warn) and 5 agent PRs waiting for Andy; "Paused" stops new starts, and so does the quota reserve.
- Project settings, the board and MCP `status` show why dispatch is idle (ADR-0079).
- A ticket whose `touches` overlap a build in flight waits ("Waiting: overlaps AI-12 in flight") while the next starts; MCP `list_in_flight` shows each task's ticket, branch, PR and files (a build's ticket panel shows its branch and files), and each build gets its own ADR number (ADR-0080).
- Blockers can be in any project (AI-96).
- **Clear quota idle** (banner, Project settings, MCP `clear_quota_idle`) discards a quota reading you don't believe, logged with who and when; the digest lists it (AI-74).
- When `main` moves, each open agent PR lacking it gets a sync task: merge `main`, resolve conflicts, rerun checks, push; an unsettled conflict goes to Needs you; no auto-merge while a sync is pending (ADR-0083).
- Paid (`pay_per_use`) routes reserve their per-task cap in the spend ledger first and don't start past a cap or without a price (`spend_cap`, AI-248); none has a price yet.
- `claude-api` (Claude Code on an API key, off by default) runs paid tasks under their reserved budget (AI-260).

**Project agent tasks (AI-134):**

- Andy starts plan-project or ideate as a read-only agent task (`POST …/plan/agent-task`, `…/ideate/agent-task`); its result is stored as a submitted one, so a plan waits for approval and an idea becomes an epic with a spec PR or a question.
- No MCP tool or button yet.
