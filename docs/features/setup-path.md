# New project setup path

A new project opens on its setup path, `/p/<project>/setup` (AI-373, AI-381): one card at a time, from a new repo to the first agent task. It shows every step of runbook [`managed-project.md`](../runbooks/managed-project.md) in its order (the step table there says how each is checked), with Write the brief, Plan milestones and Approve the plan before the proving refine.

- **Repo limits** sit above every step (public, default branch `main`, `pnpm-lock.yaml`, `.nvmrc`, one repo); each failure is named.
- **Hand steps** show a one-line instruction, each command with the repo filled in and Copy, and the GitHub page. They open in any order.
- **Status:** Done, Not yet or Can't tell, read live through the App. Where it can't read (Actions settings, secrets) or a read fails: **Mark done**, stored with who and when, shown as "Marked by hand".
- **Add project** shows the repo and App steps first: a project needs its repo, with the App installed, to be created.
- **GitHub steps before the brief:** the brief is a PR whose checks need the baseline and reviewer token.
- The app never runs a step or sees a token. A domain test keeps the commands equal to the runbook's.
- The board shows the next step until setup is done.

Routes (owner only): `GET …/brief`, `GET …/onboarding` (`?refresh=true`: Check again), `POST …/onboarding/marks`. MCP `project_setup` returns `onboarding` and takes `mark`.

**How to use:** picker → Add project. Come back from the board's setup bar.
