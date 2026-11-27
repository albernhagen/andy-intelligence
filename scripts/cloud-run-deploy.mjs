// Logic for platform/actions/cloud-run-safe-deploy (ADR-0076). gcloud stays in the action; this
// reads `gcloud run services describe --format=json` from stdin, checks URLs and writes the summary.
/* global fetch, AbortSignal */
import { appendFileSync } from "node:fs";
import process from "node:process";
import { text } from "node:stream/consumers";
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

/**
 * Parses a smoke-check input: one check per line, `<path> <status>[,<status>…]`, e.g. `/health 200`
 * or `/ 200,301`. Blank lines and `#` comments are skipped. `name` is the action input, for errors.
 */
export function parseSmokeChecks(text, name) {
  const checks = [];
  for (const raw of (text ?? "").split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const match = /^(\/\S*)\s+(\d{3}(?:,\d{3})*)$/.exec(line);
    if (!match) throw new Error(`${name}: expected "<path> <status>[,<status>…]", got "${line}"`);
    const statuses = match[2].split(",").map(Number);
    if (statuses.some((s) => s < 100 || s > 599)) {
      throw new Error(`${name}: status must be 100 to 599, got "${line}"`);
    }
    checks.push({ path: match[1], status: statuses.length === 1 ? statuses[0] : statuses });
  }
  return checks;
}

/**
 * The checks a service declares (cloud-run-safe-deploy inputs): `publicHost` for its public host
 * (PUBLIC_URL, or the run.app URL without one); `otherHosts` for any other host while PUBLIC_URL is
 * set (a host guard, like the control plane's ADR-0044 one, answers there differently), and the
 * same as `publicHost` when not given. Throws when no check is given: a deploy must smoke test.
 */
export function smokeChecks({ publicHost, otherHosts }) {
  const pub = parseSmokeChecks(publicHost, "smoke-checks");
  if (pub.length === 0) throw new Error("smoke-checks: give at least one check");
  const other = parseSmokeChecks(otherHosts, "smoke-checks-other-hosts");
  return { publicHost: pub, otherHosts: other.length > 0 ? other : pub };
}

const at = (base, checks) => checks.map(({ path, status }) => ({ url: `${base}${path}`, status }));

// A tagged URL is never the public host: with PUBLIC_URL set it gets the other-host checks; without
// one every host is public. The 401 from real auth on the public host needs traffic first.
export function candidateChecks({ taggedUrl, publicUrl }, checks) {
  return at(taggedUrl, publicUrl ? checks.otherHosts : checks.publicHost);
}

export function publicChecks({ publicUrl, runUrl }, checks) {
  const url = publicUrl || runUrl;
  const list = at(url, checks.publicHost);
  if (url !== runUrl) list.push(...at(runUrl, checks.otherHosts));
  return list;
}

/**
 * Runs each check (`status`: one code or a list of accepted ones), retrying within a fixed cap: a
 * new revision starts cold (ADR-0028).
 */
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
    const expected = [status].flat();
    let last;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetchImpl(url, {
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        });
        last = `HTTP ${response.status}`;
        if (expected.includes(response.status)) break;
      } catch (error) {
        last = error.message;
      }
      last = `${last} (attempt ${attempt}/${attempts})`;
      if (attempt === attempts)
        throw new Error(`${url}: expected ${expected.join(" or ")}, got ${last}`);
      await sleep(delayMs);
    }
    log(`ok ${expected.join(",")} ${url}`);
  }
}

/**
 * The registry tag that keeps the image prod runs (AI-389): registry cleanup never deletes a
 * version whose tag starts with a keep prefix (project-env `image_keep_tag_prefixes`), so a cold
 * start or rollback can still pull it. `image` must be by digest, `<repo>/<name>@sha256:<hex>`, so
 * the tag names exactly what was deployed; the tag is `<prefix><hex>`, the same for a re-promote.
 */
export function keepTag({ image, prefix }) {
  if (!/^[a-z][a-z0-9._-]*$/.test(prefix ?? "")) {
    throw new Error(
      `keep-tag-prefix: expected lowercase letters, digits, ".", "_" or "-", got "${prefix}"`,
    );
  }
  const match = /^([^@\s]+)@sha256:([0-9a-f]{64})$/.exec(image ?? "");
  if (!match)
    throw new Error(
      `keep-tag-prefix needs the image by digest (<repo>/<name>@sha256:…), got "${image}"`,
    );
  const [, name, hex] = match;
  if (/:[^/]*$/.test(name))
    throw new Error(`image must not carry both a tag and a digest, got "${image}"`);
  return { source: image, target: `${name}:${prefix}${hex}` };
}

export function rollbackCommand({ service, region, serving }) {
  return `gcloud run services update-traffic ${service} --region ${region} --to-revisions=${serving}`;
}

/** What happened to traffic, from the action's step outcomes. Order matters: first match wins. */
export function deployVerdict(o) {
  if (o.inputs === "failure")
    return "The smoke checks, keep tag prefix or image are missing or malformed. Nothing was deployed.";
  if (o.before !== "success") return "Could not read the serving revision. Nothing was deployed.";
  if (o.deploy !== "success") return "Candidate did not deploy. **Traffic did not move.**";
  if (o.candidate !== "success" || o.smoke !== "success") {
    return "Candidate failed before promotion. **Traffic did not move**; the command below is not needed unless the service looks wrong.";
  }
  if (o.keepTag === "failure") {
    return "Could not tag the image so registry cleanup keeps it. **Traffic did not move.**";
  }
  if (o.promote !== "success") {
    return "Promotion failed. **Traffic may have moved**: compare the serving revision below; run the command if it is not the previous one.";
  }
  if (o.verify !== "success" || o.publicSmoke !== "success") {
    return "Candidate failed after promotion. **It is serving traffic: run the command below now.**";
  }
  return "Deployed. The candidate serves 100 percent of traffic.";
}

export function renderSummary({ service, region, before, candidate, after, keepTag, outcomes }) {
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
  if (keepTag && outcomes.keepTag === "success") {
    lines.push("", `Registry cleanup keeps this image: tagged \`${keepTag}\`.`);
  }
  if (outcomes.untag === "failure") {
    lines.push(
      "",
      `**Warning:** the \`${CANDIDATE_TAG}\` tag could not be removed, so its public URL still reaches the candidate. Remove it: \`gcloud run services update-traffic ${service} --region ${region} --remove-tags=${CANDIDATE_TAG}\``,
    );
  }
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

// Asynchronous on purpose: readFileSync(0) throws EAGAIN on a non-blocking pipe when gcloud's
// output has not arrived yet (AI-64). The error omits the input: job logs are public.
async function stdinService(command) {
  const input = await text(process.stdin);
  if (!input.trim()) throw new Error(`${command}: expected the service JSON on stdin, got nothing`);
  try {
    return JSON.parse(input);
  } catch {
    throw new Error(
      `${command}: expected the service JSON on stdin, got ${input.length} unparsable characters`,
    );
  }
}

const declaredChecks = (env) => ({
  publicHost: env.SMOKE_CHECKS,
  otherHosts: env.SMOKE_CHECKS_OTHER_HOSTS,
});

async function main([command, argument]) {
  const env = process.env;
  switch (command) {
    case "serving": {
      const serving = servingRevisions(await stdinService(command));
      if (!serving) throw new Error("service reports no serving revision");
      return setOutputs({ serving });
    }
    case "after":
      return setOutputs({ serving: servingRevisions(await stdinService(command)) });
    case "candidate":
      return setOutputs(readCandidate(await stdinService(command)));
    case "assert-latest":
      return assertLatest(await stdinService(command), argument);
    case "assert-promoted":
      return assertPromoted(await stdinService(command), argument);
    case "check-smoke-inputs":
      return smokeChecks(declaredChecks(env));
    case "smoke-candidate":
      return runChecks(
        candidateChecks(
          { taggedUrl: env.TAGGED_URL, publicUrl: env.PUBLIC_URL },
          smokeChecks(declaredChecks(env)),
        ),
      );
    case "keep-tag":
      return setOutputs(keepTag({ image: env.IMAGE, prefix: env.KEEP_TAG_PREFIX }));
    case "smoke-public":
      return runChecks(
        publicChecks(
          { publicUrl: env.PUBLIC_URL, runUrl: env.RUN_URL },
          smokeChecks(declaredChecks(env)),
        ),
      );
    case "summary":
      return appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        renderSummary({
          service: env.SERVICE,
          region: env.REGION,
          before: env.BEFORE,
          candidate: env.CANDIDATE,
          after: env.AFTER,
          keepTag: env.KEEP_TAG,
          outcomes: {
            inputs: env.OUTCOME_INPUTS,
            before: env.OUTCOME_BEFORE,
            deploy: env.OUTCOME_DEPLOY,
            candidate: env.OUTCOME_CANDIDATE,
            smoke: env.OUTCOME_SMOKE,
            keepTag: env.OUTCOME_KEEP_TAG,
            promote: env.OUTCOME_PROMOTE,
            verify: env.OUTCOME_VERIFY,
            publicSmoke: env.OUTCOME_PUBLIC_SMOKE,
            untag: env.OUTCOME_UNTAG,
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
