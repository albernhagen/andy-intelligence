# Project baseline

Same checks, files and GitHub settings for another repo. A new repo also gets a starter `design.md` (written once, never overwritten; the owner edits it), and its agent rules say a ticket that changes a UI follows it (ADR-0132).

**On registration (AI-113):** a repo added to a project gets a PR from the App with the baseline files it's missing and a report: applied, differs (left unchanged), skipped, left out. Workflows and agent settings are left out (the App can't write them); the report gives the `finish` command that adds them to the PR. GitHub settings are reported only; `apply` sets them. An empty repo, or any failure, goes to Needs-you with the `onboard` command (ADR-0142).

**How to use:** `platform/baseline/baseline.mjs` ([runbook](../runbooks/onboard-a-repo.md))
