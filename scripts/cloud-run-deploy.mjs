// Logic for platform/actions/cloud-run-safe-deploy (ADR-0076). gcloud stays in the action; this
// reads `gcloud run services describe --format=json` from stdin, checks URLs and writes the summary.
/* global fetch, AbortSignal */
import { appendFileSync, readFileSync } from "node:fs";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const CANDIDATE_TAG = "candidate";

/** Traffic as gcloud's --to-revisions value, e.g. "rev-a=100" or "rev-a=90,rev-b=10". */
export function servingRevisions(service) {
  return (service.status?.traffic ?? [])
    .filter((t) => (t.percent ?? 0) > 0)
    .map((t) => `${t.revisionName}=${t.percent}`)
    .join(",");
}

function publicUrlOf(service) {
  const env = service.spec?.template?.spec?.containers?.[0]?.env ?? [];
  return env.find((e) => e.name === "PUBLIC_URL")?.value?.replace(/\/+$/, "") ?? "";
}

/** The tagged no-traffic revision the deploy just made. Throws if it is not exactly that. */
export function readCandidate(service) {
  const entry = service.status?.traffic?.find((t) => t.tag === CANDIDATE_TAG);
  if (!entry?.revisionName || !entry.url) throw new Error("no candidate-tagged revision found");
  const taggedShare = (service.status.traffic ?? [])
    .filter((t) => t.revisionName === entry.revisionName)
    .reduce((sum, t) => sum + (t.percent ?? 0), 0);
  if (taggedShare > 0 && servingRevisions(service) !== `${entry.revisionName}=100`) {
    throw new Error(`candidate ${entry.revisionName} already has ${taggedShare}% of traffic`);
  }
  assertLatest(service, entry.revisionName);
  return {
    revision: entry.revisionName,
    tagged_url: entry.url,
    public_url: publicUrlOf(service),
    run_url: service.status.url,
  };
}

/** --to-latest must mean the candidate: another revision may have appeared since (a Terraform apply). */
export function assertLatest(service, revision) {
  const latest = service.status?.latestReadyRevisionName;
  if (latest !== revision) throw new Error(`latest ready revision is ${latest}, not ${revision}`);
}

export function assertPromoted(service, revision) {
  const serving = servingRevisions(service);
  if (serving !== `${revision}=100`)
    throw new Error(`expected ${revision}=100, serving ${serving}`);
}

// The API refuses every host but PUBLIC_URL's, except /health (ADR-0044), so a run.app URL can
// only prove the guard; the 401 from real auth needs the public host, which needs traffic.
export function candidateChecks({ taggedUrl, publicUrl }) {
  return [
    { url: `${taggedUrl}/health`, status: 200 },
    { url: `${taggedUrl}/api/me`, status: publicUrl ? 404 : 401 },
  ];
}

export function publicChecks({ publicUrl, runUrl }) {
  const url = publicUrl || runUrl;
  const checks = [
    { url: `${url}/health`, status: 200 },
    { url: `${url}/api/me`, status: 401 },
  ];
  if (url !== runUrl) {
    checks.push({ url: `${runUrl}/health`, status: 200 }, { url: `${runUrl}/api/me`, status: 404 });
  }
  return checks;
}

/** Runs each check, retrying within a fixed cap: a new revision starts cold (ADR-0028). */
export async function runChecks(
  checks,
  {
    fetchImpl = fetch,
    attempts = 12,
    delayMs = 5000,
    log = (line) => process.stdout.write(`${line}\n`),
  } = {},
) {
  for (const { url, status } of checks) {
    let last;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetchImpl(url, {
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        });
        last = `HTTP ${response.status}`;
        if (response.status === status) break;
      } catch (error) {
        last = error.message;
      }
      last = `${last} (attempt ${attempt}/${attempts})`;
      if (attempt === attempts) throw new Error(`${url}: expected ${status}, got ${last}`);
      await sleep(delayMs);
    }
    log(`ok ${status} ${url}`);
  }
}

export function rollbackCommand({ service, region, serving }) {
  return `gcloud run services update-traffic ${service} --region ${region} --to-revisions=${serving}`;
}

/** What happened to traffic, from the action's step outcomes. Order matters: first match wins. */
export function deployVerdict(o) {
  if (o.before !== "success") return "Could not read the serving revision. Nothing was deployed.";
  if (o.deploy !== "success") return "Candidate did not deploy. **Traffic did not move.**";
  if (o.candidate !== "success" || o.smoke !== "success") {
    return "Candidate failed before promotion. **Traffic did not move**; the command below is not needed unless the service looks wrong.";
  }
  if (o.promote !== "success") {
    return "Promotion failed. **Traffic may have moved**: compare the serving revision below; run the command if it is not the previous one.";
  }
  if (o.verify !== "success" || o.publicSmoke !== "success") {
    return "Candidate failed after promotion. **It is serving traffic: run the command below now.**";
  }
  return "Deployed. The candidate serves 100 percent of traffic.";
}

export function renderSummary({ service, region, before, candidate, after, outcomes }) {
  const lines = [
    `## Deploy: ${service}`,
    "",
    deployVerdict(outcomes),
    "",
    "| | Revision |",
    "| --- | --- |",
    `| Serving before | \`${before || "unknown"}\` |`,
    `| Candidate | \`${candidate || "none"}\` |`,
    `| Serving after | \`${after || "unknown"}\` |`,
  ];
  if (before) {
    lines.push(
      "",
      "Rollback to the previous revision (`docs/runbooks/deploy-and-rollback.md`):",
      "",
      "```bash",
      rollbackCommand({ service, region, serving: before }),
      "```",
    );
  }
  return `${lines.join("\n")}\n`;
}

function setOutputs(outputs) {
  const text = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
  process.stdout.write(text);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, text);
}

const stdinService = () => JSON.parse(readFileSync(0, "utf8"));

async function main([command, argument]) {
  const env = process.env;
  switch (command) {
    case "serving": {
      const serving = servingRevisions(stdinService());
      if (!serving) throw new Error("service reports no serving revision");
      return setOutputs({ serving });
    }
    case "after":
      return setOutputs({ serving: servingRevisions(stdinService()) });
    case "candidate":
      return setOutputs(readCandidate(stdinService()));
    case "assert-latest":
      return assertLatest(stdinService(), argument);
    case "assert-promoted":
      return assertPromoted(stdinService(), argument);
    case "smoke-candidate":
      return runChecks(candidateChecks({ taggedUrl: env.TAGGED_URL, publicUrl: env.PUBLIC_URL }));
    case "smoke-public":
      return runChecks(publicChecks({ publicUrl: env.PUBLIC_URL, runUrl: env.RUN_URL }));
    case "summary":
      return appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        renderSummary({
          service: env.SERVICE,
          region: env.REGION,
          before: env.BEFORE,
          candidate: env.CANDIDATE,
          after: env.AFTER,
          outcomes: {
            before: env.OUTCOME_BEFORE,
            deploy: env.OUTCOME_DEPLOY,
            candidate: env.OUTCOME_CANDIDATE,
            smoke: env.OUTCOME_SMOKE,
            promote: env.OUTCOME_PROMOTE,
            verify: env.OUTCOME_VERIFY,
            publicSmoke: env.OUTCOME_PUBLIC_SMOKE,
          },
        }),
      );
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`::error::${error.message}\n`);
    process.exit(1);
  });
}
