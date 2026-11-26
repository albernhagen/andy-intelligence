# How it works today: the full list

What is built on `main` now, moved from `README.md` so its "How it works today" stays one screen. Update it in the same PR as the change; one feature's detail: [`docs/features/`](features/).

**Working:**

- tickets on a board (Backlog split into Up next and Ideas; only Up next gets refined; cards show size, risk and confidence; Ready sorts by them; MCP `list_ready` filters them; MCP `board` reads it) with a Needs-you inbox, answerable in the UI or with the `/inbox` skill in Claude Code; product discovery before the brief with the `/discover` skill (ADR-0145); a Claude connector (MCP) with every ticket decision the UI offers; GitHub PRs that move tickets; Refine and Build agent tasks on GitHub Actions; PR checks and review agents; the merge gate (an agent PR merges itself when checks and reviews pass, no veto applies and `autoMerge` covers its size; `AI` stays `none`); Dependabot; the project baseline (a registered repo gets its baseline PR from the App, ADR-0142; a `cloud-run` project also gets `deploy.yml` and `release.yml`, AI-206); agent evals (runbook `agent-evals.md`); cost guardrails.
- Each feature: [`docs/features/`](features/).
- A plan can name npm packages (at most 5); once Andy approves it, a trusted executor job outside the sandbox adds the newest version at least 7 days old, install scripts off, and the manifest and lockfile change ships in the PR; a build that needs an unnamed package stops and the next start re-plans (AI-386, ADR-0156).
- Each project has a default worker (agent, Andy or ask) and executor (GitHub Actions or a local runner); a ticket can override both; only an agent's tickets build.
- Settings → Local runners mints secrets for `apps/local-runner` (refine and plan on Andy's Mac, ADR-0089); MCP lists runners and revokes one (owner only, ADR-0143), never mints.
- Project settings (`/p/<project>/settings`): switches, setup checklist, changes with Revert.
- Project logos (AI-393): each project shows its uploaded logo (SVG sanitized, or PNG) or its key on a tile wherever it is named; Settings → Logo or MCP `set_project_logo`.
- Pages poll: 5 s in use, 60 s idle, none hidden (ADR-0091).
- Keyboard: `?` lists the shortcuts (AI-338); Cmd+K (Ctrl+K) opens a command palette that finds a ticket by key or title and runs shortcut commands (AI-370).
- Look: design direction A tokens (indigo accent, surfaces, Inter and Geist Mono served by the app); theme switch (system, light, dark) in the Settings menu (ADR-0151).
- Sidebar meters and a banner show Claude quota from task reports (one "Quota unknown" marker with no reading, AI-370); on a phone the header shows the fullest window and a one-tap **Pause**/**Resume** (AI-176).
- Ticket panel: next move first; worker, executor, routing under How it runs (AI-336).
- Agent task cost: ticket panel, Activity (links each task's page), MCP `status`.
- Epics: child tickets, cost; map: MCP `milestone_map`; Roadmap (header, MCP `roadmap`): milestones and their epics; epics and the board's epic groups show their milestone's status, which Andy sets there or on the roadmap (AI-311). A not-reviewed milestone shows its case (who it serves, expected return, cheapest test) and effort (its tickets by size) beside that control; plan-project writes the cases (ADR-0149).
- Dispatch starts a ticket only when its milestone is approved or it has none (AI-306).
- A daily digest (MCP `digest`) leads with a model-written summary of yesterday (Mountain time; one agent task a day, AI-323), then lists the last 24 hours: exceptions, merges and cost, work in progress, totals. What's new shows that summary, then its exceptions, with a 24 hours window (AI-341).
- What's new (header, MCP `whats_new`): milestones, the merge mode, merged PRs' release notes and who merged each (the mode or a person, AI-218).
- Releases (MCP `list_releases`, AI-183: M6.9): a project's deployments to prod or dev, newest first, each with the tickets it shipped and its release notes; no page yet (AI-189: M6.10).
- Coordinator sessions merge only through MCP `merge_pr` (AI-220): the merge mode decides, the App merges at the judged head, else it answers `wait` with every reason.
- Epic merge mode (AI-216): a child ticket builds on and merges into `epic/<KEY>`; when the epic's last child ticket is Done one PR to `main` opens for Andy.
- Merge queue per repo (AI-110): the gate's and `merge_pr`'s merges go one at a time per repo, oldest clean first; the next PR is synced with `main` and re-checked before it merges; a failed sync goes to Needs-you. While `main` is red (a required check failed on its tip), merges wait (`main_red`) and resume when it is green; over 30 minutes, one Needs-you note (AI-382).
- Needs-you lists "Waiting for your merge": clean PRs the merge mode leaves for Andy, with why and the release note (AI-218), and a Merge button (also on the ticket panel in Ready for review): Andy's click goes through the merge queue and waives only what the mode keeps for him, pinned to the PR's diff (AI-388, ADR-0157).
- PR sync (project setting, AI-388): `queue` (default) syncs only the PR next in the merge queue; `all` keeps the Re-sync open PRs workflow merging `main` into every open PR.
- Dashboards chart delivery and cost per week (AI-117), and a project's DORA metrics over 30 or 90 days from its production deployment records (AI-200; lead time not measured until commit times are recorded).
- Verifying stage (AI-181): between Ready for review and Done for projects that deploy; a merge goes there unless it changed only docs or `infra/`; over 2 hours → Needs-you. Off until the verify task (AI-188) turns it on.
- Needs-you email (AI-77): each ticket that needs Andy, batched per 10 minutes, 20 a day; off until configured (runbook `email-notifications.md`).
- Config proposals (inbox, MCP): a finding kind on 3+ PRs becomes a pending `AGENTS.md` change, never applied; idle until findings are stored (ADR-0097).
- A weekly model scout (AI-268) proposes a tier change from OpenRouter's public models list, at most one a week, never applied; off until its Terraform is applied.

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
- Board → **Ideate** starts ideate from the web (AI-299).
- A new project opens on its setup path (`/p/<project>/setup`, AI-373, AI-381): every step of runbook `managed-project.md` in order (repo and App, baseline PR, repo settings, reusable workflows, reviewer token, `agent` environment), each with its command and a copy button, the GitHub page, and a status read live by the App or marked done by hand; then the brief (as `submit_brief`), the plan agent, approve or park each milestone, one proving refine, and Builds. The repo's limits are checked above every step; Add project shows the repo and App steps first. The board shows the next step until done.
- MCP `start_plan_project` and `start_ideate` start them, as the routes do; the Project plan card has a **Start plan-project task** button (AI-320).
- Epic breakdown (AI-383): MCP `start_epic_breakdown` has a read-only plan-epic agent task draft a top-level epic's tickets (up to 12) in an approved milestone. The draft waits in Needs-you (`list_needs_me` `epicBreakdowns`). Approving it creates the tickets in Ideas with blockers linked; sending it back keeps Andy's note for the next draft.
