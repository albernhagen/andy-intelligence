# andy-intelligence — Security checks, project baseline, running locally

Moved unchanged from [README.md](../README.md) "Develop" (AI-221); one link path adjusted for this folder.

### Security checks on PRs (ADR-0025, ADR-0030)

| Check                                                | Workflow                 | Fails on                                                                                                  |
| ---------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `trufflehog`                                         | `secret-scan.yml`        | Verified or unverifiable secrets                                                                          |
| `codeql (javascript-typescript)`, `codeql (actions)` | `security-scans.yml`     | Code scanning alerts, high or higher (ruleset)                                                            |
| `dependency-review`                                  | `security-scans.yml`     | New dependency with a high/critical advisory                                                              |
| `terraform-misconfig`                                | `security-scans.yml`     | Trivy HIGH/CRITICAL in `infra/`                                                                           |
| `security-review`                                    | `security-review.yml`    | Agent finding high/critical, unless labelled `security-accepted` (docs-only PRs skip the agent)           |
| `adversarial-review`                                 | `adversarial-review.yml` | Agent `blocker` with a failing scenario, unless labelled `review-accepted` (docs-only PRs skip the agent) |
| `agent-evals` (not required yet)                     | `agent-evals.yml`        | Agent-config change: pass rate under 90%, or input tokens +20%                                            |

Weekly + manual: `system-security-review.yml` opens a PR updating the threat model. Action pins are commit SHAs, bumped by Dependabot.

Dependabot (ADR-0042): npm updates that are patches, or minors of packages at 1.0+ auto-merge once the required checks pass (`dependabot-auto-merge.yml`); majors, 0.x minors, GitHub Actions and Terraform providers wait for Andy. Bot merges never deploy (`deploy.yml` guard). `.github/CODEOWNERS` lists only the kept paths (ADR-0124): `protect-main` requires Andy's approval or admin bypass on them, and other PRs request no review.

The steps behind these checks live in composite actions in `platform/actions/`; the workflows only set triggers, permissions and the job names the `main` ruleset requires (ADR-0038).

### Project baseline (ADR-0031, ADR-0038)

Every repo Andy manages gets the same checks, files and GitHub settings (ARCHITECTURE §8.1). Run from this repo with your `gh` login; never in CI. Steps: [`docs/runbooks/onboard-a-repo.md`](runbooks/onboard-a-repo.md).

```sh
node platform/baseline/baseline.mjs onboard <owner/repo> --ref v1.0.0   # files + GitHub settings
node platform/baseline/baseline.mjs apply <owner/repo> --dry-run        # show settings drift
node platform/baseline/baseline.mjs check <owner/repo>                  # drift report; exit 1 on drift
```

Run locally (needs a Firebase project for sign-in):

```sh
GCP_PROJECT_ID=andy-intelligence-512400 ALLOWED_EMAILS=you@example.com \
FIREBASE_API_KEY=... FIREBASE_AUTH_DOMAIN=andy-intelligence-512400.firebaseapp.com \
pnpm --filter @andy/api dev          # :8080
pnpm --filter @andy/web dev          # :5173, proxies /api to :8080
```

Set `PUBLIC_URL` (public origin, e.g. `http://localhost:8080`) to turn on `/mcp` and its OAuth endpoints (ADR-0039: MCP OAuth facade).
