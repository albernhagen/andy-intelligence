// Logic for `.github/workflows/release.yml` and its actions (AI-190: M6.11; ADR-0114, "The release
// contract every kind meets"). gcloud stays in the workflow and actions; this checks the inputs,
// reads `gcloud … describe --format=json` from stdin, checks /health and writes the summary.
import { appendFileSync } from "node:fs";
import process from "node:process";
import { text } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import {
  assertPromoted,
  rollbackCommand,
  runChecks,
  servingRevisions,
} from "./cloud-run-deploy.mjs";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
// Cloud Run revision names: lowercase letters, digits and hyphens, starting with a letter.
const REVISION = /^[a-z](?:[a-z0-9-]{0,98}[a-z0-9])?$/;
const REQUEST = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * The dispatch inputs, checked before any cloud call. Throws with a message for the run log.
 * `configured`: whether the environment's deploy identity is set up in this repo's variables.
 */
export function checkInputs({ action, environment, digest, revision, request, configured }) {
  if (action !== "promote" && action !== "rollback") {
    throw new Error("action must be promote or rollback");
  }
  if (environment !== "dev" && environment !== "prod") {
    throw new Error("environment must be dev or prod");
  }
  if (!configured) throw new Error(`environment ${environment} is not set up for this repo`);
  if (request && !REQUEST.test(request)) {
    throw new Error("request must be 1 to 80 letters, digits, - or _");
  }
  if (action === "promote") {
    // Promote ships what dev verified to prod (ADR-0114).
    if (environment !== "prod") throw new Error("promote goes to prod");
    if (!DIGEST.test(digest ?? "")) throw new Error("promote needs digest sha256:<64 hex>");
    if (revision) throw new Error("promote takes a digest, not a revision");
    return { action, environment, digest, revision: "", request: request ?? "" };
  }
  if (!REVISION.test(revision ?? "")) throw new Error("rollback needs a revision name");
  if (digest) throw new Error("rollback takes a revision, not a digest");
  return { action, environment, digest: "", revision, request: request ?? "" };
}

/** The `sha256:` digest at the end of an image reference (`…@sha256:…`), or null. */
export function digestOf(imageReference) {
  const match = /@(sha256:[0-9a-f]{64})$/.exec(imageReference ?? "");
  return match ? match[1] : null;
}

/**
 * From `gcloud run revisions describe --format=json`: the revision exists, belongs to `service`
 * and is ready. Returns its image digest (the Deployment record needs one).
 */
export function checkRevision(revision, service) {
  const name = revision.metadata?.name;
  const owner = revision.metadata?.labels?.["serving.knative.dev/service"];
  if (owner !== service) throw new Error(`revision ${name} is not a revision of ${service}`);
  const ready = (revision.status?.conditions ?? []).find((c) => c.type === "Ready");
  if (ready?.status !== "True") throw new Error(`revision ${name} is not ready`);
  const digest = digestOf(revision.status?.imageDigest);
  if (!digest) throw new Error(`revision ${name} has no image digest`);
  return { image_digest: digest };
}

/** From `gcloud artifacts docker images describe --format=json`: the image is that digest. */
export function checkImage(image, digest) {
  const found = image.image_summary?.digest;
  if (found !== digest) throw new Error(`image ${digest} not found in the registry`);
  return { image_digest: digest };
}

/** From `gcloud run services describe --format=json`: where the service answers, and its traffic. */
export function readTarget(service) {
  const env = service.spec?.template?.spec?.containers?.[0]?.env ?? [];
  const publicUrl = env.find((e) => e.name === "PUBLIC_URL")?.value?.replace(/\/+$/, "") ?? "";
  return { url: publicUrl || service.status?.url || "", serving: servingRevisions(service) };
}

/** What happened to traffic in a rollback, from the action's step outcomes. First match wins. */
export function rollbackVerdict(o) {
  if (o.pin === "skipped" || !o.pin) {
    return "Could not read the serving revision. **Traffic did not move.**";
  }
  if (o.pin !== "success") {
    return "Traffic could not be pinned. **Compare the serving revision below** with the one you asked for.";
  }
  if (o.verify !== "success" || o.health !== "success") {
    return "Traffic moved, but the check failed. **Look at the service now**; the command below returns to what served before.";
  }
  return "Rolled back. The revision serves 100 percent of traffic and `/health` answers 200.";
}

export function renderRollbackSummary({ service, region, revision, before, after, outcomes }) {
  const lines = [
    `## Rollback: ${service}`,
    "",
    rollbackVerdict(outcomes),
    "",
    "| | Revision |",
    "| --- | --- |",
    `| Serving before | \`${before || "unknown"}\` |`,
    `| Asked for | \`${revision}\` |`,
    `| Serving after | \`${after || "unknown"}\` |`,
  ];
  if (before) {
    lines.push(
      "",
      "To return to what served before (`docs/runbooks/deploy-and-rollback.md`):",
      "",
      "```bash",
      rollbackCommand({ service, region, serving: before }),
      "```",
    );
  }
  return `${lines.join("\n")}\n`;
}

function setOutputs(outputs) {
  const lines = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
  process.stdout.write(lines);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
}

// The error omits the input: job logs are public.
async function stdinJson(command) {
  const input = await text(process.stdin);
  if (!input.trim()) throw new Error(`${command}: expected JSON on stdin, got nothing`);
  try {
    return JSON.parse(input);
  } catch {
    throw new Error(
      `${command}: expected JSON on stdin, got ${input.length} unparsable characters`,
    );
  }
}

async function main([command, argument]) {
  const env = process.env;
  switch (command) {
    case "inputs":
      return setOutputs(
        checkInputs({
          action: env.ACTION,
          environment: env.ENVIRONMENT,
          digest: env.DIGEST,
          revision: env.REVISION,
          request: env.REQUEST,
          configured: Boolean(env.CONFIGURED),
        }),
      );
    case "revision":
      return setOutputs(checkRevision(await stdinJson(command), argument));
    case "image":
      return setOutputs(checkImage(await stdinJson(command), argument));
    case "target":
      return setOutputs(readTarget(await stdinJson(command)));
    case "assert-pinned":
      return assertPromoted(await stdinJson(command), argument);
    case "health":
      return runChecks([{ url: `${env.TARGET_URL}/health`, status: 200 }]);
    case "summary":
      return appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        renderRollbackSummary({
          service: env.SERVICE,
          region: env.REGION,
          revision: env.REVISION,
          before: env.BEFORE,
          after: env.AFTER,
          outcomes: {
            pin: env.OUTCOME_PIN,
            verify: env.OUTCOME_VERIFY,
            health: env.OUTCOME_HEALTH,
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
