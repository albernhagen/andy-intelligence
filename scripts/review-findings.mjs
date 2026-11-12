#!/usr/bin/env node
/* global fetch, AbortSignal, console */
// Review findings to the control plane (ADR-0097): posts one review verdict's findings to
// `POST /review/findings` with the job's Actions OIDC token (ADR-0019 pattern). The control
// plane takes the repo, PR and reviewer from the token; this body carries only the head SHA and
// each finding's severity, kind, title and file, cut to the caps. Best effort: any failure is a
// warning and exit 0, so a control-plane outage never fails a review.
//
// Env: ROLE (security | adversarial), FINDINGS (the agent's JSON), HEAD_SHA, CONTROL_PLANE_URL
// (empty: skip), ACTIONS_ID_TOKEN_REQUEST_URL and ACTIONS_ID_TOKEN_REQUEST_TOKEN (from
// `id-token: write`).
import { fileURLToPath } from "node:url";
import { FINDING_KINDS, ROLES, parseFindings } from "./review-gate.mjs";

/** Caps, as the control plane checks them (REVIEW_FINDING_LIMITS, REVIEW_VERDICT_LIMITS). */
export const LIMITS = { findings: 50, title: 300, file: 300 };
const TIMEOUT_MS = 15_000;

/** One plain line: control characters and runs of whitespace become one space. */
const line = (value, max) =>
  String(value)
    // eslint-disable-next-line no-control-regex -- stripping them is the point
    .replace(/[\u0000-\u001f\u007f\s]+/g, " ")
    .trim()
    .slice(0, max);

/** The body to post, or null when the agent's output isn't a verdict for this role. */
export function verdictReport(raw, roleKey, headSha) {
  const role = ROLES[roleKey];
  if (!role || !/^[0-9a-f]{40}$/.test(headSha ?? "")) return null;
  const parsed = parseFindings(raw, role);
  if (!parsed) return null;
  // Most severe first, so the cap drops the least severe.
  const findings = [...parsed.findings]
    .sort((a, b) => role.severities.indexOf(a.severity) - role.severities.indexOf(b.severity))
    .slice(0, LIMITS.findings)
    .map((f) => ({
      severity: f.severity,
      kind: FINDING_KINDS.includes(f.kind) ? f.kind : "other",
      title: line(f.title ?? "", LIMITS.title),
      file: typeof f.file === "string" && f.file.trim() ? line(f.file, LIMITS.file) : null,
    }));
  return { headSha, findings };
}

async function main(env = process.env, fetchImpl = fetch) {
  const warn = (msg) => console.log(`::warning title=review-findings::${msg}`);
  const base = env.CONTROL_PLANE_URL;
  if (!base) return console.log("No control plane URL: findings not recorded.");
  const report = verdictReport(env.FINDINGS, env.ROLE, env.HEAD_SHA);
  if (!report) return warn("no valid verdict to record");
  try {
    const idRes = await fetchImpl(
      `${env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${encodeURIComponent(base)}`,
      {
        headers: { authorization: `bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!idRes.ok) return warn(`no Actions OIDC token (HTTP ${idRes.status})`);
    const { value } = await idRes.json();
    const res = await fetchImpl(`${base}/review/findings`, {
      method: "POST",
      headers: { authorization: `Bearer ${value}`, "content-type": "application/json" },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return warn(`control plane answered HTTP ${res.status}`);
    console.log(`Recorded ${report.findings.length} finding(s) for this verdict.`);
  } catch (err) {
    warn(`could not reach the control plane: ${err instanceof Error ? err.name : "error"}`);
  }
}

export { main };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
