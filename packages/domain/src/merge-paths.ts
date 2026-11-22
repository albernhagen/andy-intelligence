/**
 * The two path lists the merge verdict applies (ADR-0124, AI-215): the one place they are kept.
 * The coordinator procedure and CODEOWNERS (AI-217) cite this file instead of restating them.
 * Globs: `*` within a segment, `**` across segments, case-insensitive (see `globToRegExp`).
 */

/**
 * Kept kinds (ADR-0124): Andy merges these in every mode. "Who merges": the rule, its code and
 * the documents that state it. "What judges a PR": CI, the baseline, CODEOWNERS, the review
 * scripts, procedures and evals, and the gate. PRs that need Andy's hands (Terraform apply, a
 * secret, an external account) and doubt stay procedural; `infra/**` here covers the first.
 */
export const KEPT_PATHS: readonly string[] = [
  // Who merges.
  "docs/architecture/adr/0124-merge-modes.md",
  "docs/architecture/adr/0134-*.md",
  "platform/procedures/coordinate.md",
  "docs/runbooks/coordinating-sessions.md",
  "AGENTS.md",
  "CLAUDE.md",
  "packages/domain/src/merge-*",
  // What judges a PR.
  "**/.github/**",
  "**/CODEOWNERS",
  "platform/actions/**",
  "platform/baseline/**",
  "platform/procedures/**",
  "platform/evals/**",
  "scripts/review-*",
  "packages/domain/src/gate*",
  // Needs Andy's hands.
  "infra/**",
  ".terraform-version",
];

/**
 * The high-risk list (ADR-0092's table, as paths): in `low-risk` mode a PR touching any of these
 * waits for Andy. Rows that need judgement beyond a path (a new dependency, a major bump, a
 * loosened rule) are covered by listing the files they live in.
 */
export const HIGH_RISK_PATHS: readonly string[] = [
  // CI and infra, deploy and release.
  "**/.github/**",
  "infra/**",
  ".terraform-version",
  "platform/actions/**",
  "platform/baseline/**",
  "**/Dockerfile",
  // Access: sign-in, the allow-list, permissions, IAM, credentials, outside entry points.
  "**/auth/**",
  "**/auth.*",
  "**/oauth*",
  "**/oauth*/**",
  "**/permission*",
  "**/permission*/**",
  "apps/api/src/project-access*",
  "apps/api/src/github/**",
  "apps/api/src/webhook*",
  // Data: rules, the schema version, migrations.
  "**/firestore.rules",
  "packages/store/src/index.ts",
  "**/migration*",
  "**/migration*/**",
  // Review and merge, the executor sandbox, the schemas the executor reads.
  "scripts/review-*",
  "scripts/executor-*",
  "platform/executor/**",
  "packages/contracts/**",
  "packages/domain/src/gate*",
  "packages/domain/src/merge-*",
  "packages/domain/src/dispatch-caps*",
  // Rules for agents.
  "**/AGENTS.md",
  "**/CLAUDE.md",
  "docs/BUILD-PROMPT.md",
  "**/.claude/**",
  "context-budget.json",
  "**/CODEOWNERS",
  "platform/procedures/**",
  "docs/runbooks/coordinating-sessions.md",
  // Dependencies.
  "**/package.json",
  "**/pnpm-lock.yaml",
  "**/.npmrc",
  // Decisions: security docs always; ADRs, runbooks and design docs are checked as docs-only PRs
  // (`DOCS_ONLY_HIGH_RISK_PATHS`), since a ticket's PR may change them to record what it does.
  "docs/security/**",
];

/** High risk only when every changed file is under `docs/` (ADR-0092 row "Decisions"). */
export const DOCS_ONLY_HIGH_RISK_PATHS: readonly string[] = [
  "docs/architecture/adr/**",
  "docs/runbooks/**",
  "docs/architecture/*.md",
];
