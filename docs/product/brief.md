# Project brief — andy-intelligence (project `AI`)

The project brief is the product and domain context agents read (ADR-0053: Project brief). This one was written by hand on 2026-11-04 from Andy's answers, since the onboarding interview isn't built yet (M5: Multi-project in parallel). Sections are short on purpose: [`ARCHITECTURE.md`](../architecture/ARCHITECTURE.md) is the detailed source and this file points at it rather than repeating it.

## Idea

A personal control plane for agentic software development: ideas become refined tickets, agents build them under cost and quota controls, agents review every PR, and Andy approves releases. Enterprise-shaped (durable state, policy, gates, least privilege, audit, contract-first) but sized for one person. Detail: ARCHITECTURE §1–3.

## Users and business

- **Andy** is the only user: a staff software engineer with about twenty side-project ideas, a couple active at any time, mostly public web apps, APIs and mobile apps. His bottleneck is keyboard time, not ideas.
- **A friend may self-host later** (ADR-0032: Deployment modes and a standalone devkit). Commercialization is a possibility, not a plan: keep ports and deployment portability, but build nothing multi-tenant.
- No revenue intent today.

## Vision

In about a year, Andy's side projects run in production with little keyboard time, through a pipeline he trusts end to end: he answers refinement questions, approves plans only where a project's policy asks, and approves releases; S and M work merges on its own (ADR-0050). Work can be reviewed and driven from his phone (ADR-0052). He opens the UI to decide, not to operate.

## Goals and non-goals

Goals are ARCHITECTURE §1. Andy's emphasis, in order:

1. Minimal keyboard time: autonomy by default, with policy gates he can tighten per project. First proof: the system builds itself while Andy is away (M2: Self-hosting: andy-intelligence builds itself).
2. Several projects in parallel, picked up as inspiration strikes (M5: Multi-project in parallel).
3. Quality a perfectionist staff engineer would ship (bar below).
4. Spend optimized across providers as the market changes (M9: Add Jules + model routing, M10: Paid models + spend caps).
5. Everything reachable from the phone (M7: Mobile).

Non-goals are ARCHITECTURE §1, plus: multi-tenant SaaS; hand review of agent code as the norm.

## Architectural expectations

- Principles and technology: ARCHITECTURE §2 and §11 (TypeScript monorepo, Cloud Run, Firestore, GitHub Actions executors, Terraform).
- Andy's standards (`AGENTS.md`, the template's rules): simple over clever, reuse popular libraries, one responsibility per unit, boring solutions, patterns already in the codebase.
- Cloud: scale to zero; minimize operational overhead even at marginally higher usage cost; a cap on everything that scales; no surprise bills (ADR-0028).
- Contract-first; GCP specifics behind ports so a local mode only adds adapters (ADR-0032).
- Security: agents read-only, writes as PRs, public-repo hygiene, continuous review (ARCHITECTURE §9).
- Ticketing and UI: Shortcut's simplicity as the starting point (ADR-0058, ADR-0059, ADR-0070), not a clone: a modern, minimalist design of its own, biased toward Andy's real use (deciding, not operating). Feature, chore and bug; order on the board is the priority; stories in markdown; simple lanes. Automatic by default, editable everywhere, never complicated or over-engineered.
- **Quality bar for anything called shipped**, here and in managed projects: tests, CI green, security and adversarial review passed, docs current, **and production monitoring** (alerts and an error budget per project).
- Spend: no fixed ceiling yet; minimize. Today: the Claude subscription (Ultra, may be cut) plus a $25/month GCP budget. Revisit once runs record their cost (M1.8: Build + gate).

## Open questions

- Spend ceiling, once run costs are measured.
- Production monitoring as part of "shipped": per-project alerts and an error budget belong in M6: Dev → prod releases (the prod monitoring agent that opens tickets stays deferred). Add at M6 slicing.
- Whether and when to open the devkit to others (ADR-0032 phase 1).
