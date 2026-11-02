---
status: accepted (direction; detailed design after M1: First end-to-end flow)
date: 2026-11-01
---

# 0032 — Deployment modes and a standalone devkit

Decided by Andy, 2026-11-01.

## Context and Problem Statement

The plan has one deployment: the control plane on GCP (Cloud Run, Firestore, Firebase Auth with Andy's allow-list, Cloud Tasks watchdog, GitHub Actions executors). Skills (§7.3) exist only as something the control plane hands to executors.

Andy wants two more ways to use the system:

1. Drive the development lifecycle (ideate, refine, plan, build, review, verify) straight from Claude Code, with no control plane running.
2. Give it to a friend who runs it locally, on their own machine, subscription and GitHub account.

## Decision Outcome

Three layers:

| Layer               | What it is                                                                                                                       | Runs where                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Devkit**          | Vendor-neutral procedures (the substance) + thin skills/subagents per harness, reaching tools (tickets, GitHub, GCP) through MCP | Any MCP-capable harness: Claude Code first |
| **Control plane**   | UI, API, MCP server, state, routing, quota/cost policy. One host for the devkit, not the only one                                | A deployment mode                          |
| **Deployment mode** | `gcp`: today's design. `local`: one process on the user's machine (later)                                                        | —                                          |

**Decisions**

- **Devkit first, local UI later.** Phase 1: the devkit installs into Claude Code and runs the full lifecycle on its own. Phase 2: the full control plane runs locally with one command.
- **Standalone tickets are markdown in the project repo** (e.g. `work/`): tickets, questions, status as files; git is the history. A `WorkTracker` adapter maps them to the domain, so the control plane can import them later. ADR-0016 (native tracking in the control plane) still holds when a control plane is used.
- **Distribution: a `devkit/` folder in this repo**, published as a Claude Code plugin marketplace from this repo. Versioned with the project baseline (ADR-0031).
- **Rule from now on:** new code keeps GCP specifics behind ports. Runs/config/spend storage, the task queue (Cloud Tasks) and auth (Firebase + allow-list) get ports when they are first built or touched, so a `local` mode can add adapters without rework.
- **Not SaaS:** a friend's install is their own single-tenant instance. The multi-tenant non-goal stands.
- **Timing:** detailed design (port list, local executor, local storage, auth, packaging) after M1: First end-to-end flow.

### Consequences

- Good: the devkit is useful without any infrastructure; the control plane becomes one consumer of it; friends can use it at zero cloud cost.
- Bad: two ticket stores to keep in step (markdown and Firestore) once both exist; more ports to build as M1 slices touch storage, queue and auth; a local executor (Claude Code CLI on the user's machine) and its trust boundary still need designing.
