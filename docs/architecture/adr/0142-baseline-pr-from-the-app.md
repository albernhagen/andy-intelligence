---
title: The App opens the baseline PR; workflows, agent settings and GitHub settings stay Andy's
status: accepted (Andy, 2026-11-22: no `workflows` permission for the App)
date: 2026-11-22
---

# 0142 — Baseline PR from the App: missing files only; workflows, agent settings and GitHub settings stay Andy's

AI-113: M5.14: Baseline PR on registration, report-only on existing repos.

## Context and Problem Statement

When a repo is registered on a project, the control-plane App should open its first PR with the project baseline (ADR-0031, ADR-0038) and a report. The App has contents and pull-request write, but no `workflows` permission (GitHub refuses any commit that touches `.github/workflows/**` without it) and no administration permission (rulesets, Actions and security settings). Andy won't grant either. Existing files and rulesets must never be overwritten without his review (AI-65).

## Considered Options

1. **The App writes what it may; the report gives Andy one command for the rest.**
2. **Grant the App `workflows` and administration.** One step for Andy, but any App bug or stolen key could change every managed repo's CI and branch protection.
3. **Keep the CLI only** (`baseline.mjs onboard`). Nothing happens on registration.

## Decision Outcome

Option 1 (Andy, 2026-11-22).

- The PR holds only files the repo is missing: managed files, seed files, missing `.gitignore` lines and `.andy/baseline.json`, from `andy-intelligence` at `main`'s tip. A file that differs is listed, never written.
- Never in it: `.github/workflows/**` and `.claude/**` (agent settings, the same rule as single-file proposals). The report lists the missing ones and gives `baseline.mjs finish <repo> --ref <sha> --branch <branch>`, which adds them to the PR's branch with Andy's `gh` login (missing ones only).
- GitHub settings are read with the App's identity and reported (matches, differs, couldn't read). The App never writes them; the report gives `baseline.mjs apply`.
- An empty repo has nothing to open a PR against, and its starter needs `pnpm install` for a lockfile: it goes to Needs-you with `baseline.mjs onboard`, which applies the settings too. This is the ticket's "new and empty" case.
- Any failure becomes a Needs-you ticket in the project with the error and the CLI command. The baseline source repo itself is skipped.

### Consequences

- A registered repo gets its baseline PR without Andy at a terminal; workflows and settings still need one command each.
- Reads are capped (60 source files, 40 repo files, one PR per registration); see R-AI-113.
