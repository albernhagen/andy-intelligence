// Logic for platform/actions/cloud-run-caller-config (AI-206: M6.17; ADR-0114, the `cloud-run`
// deploy kind). A managed repo's deploy.yml and release.yml call it first, before any cloud call or
// build: it picks the environment, checks the repo variables that environment needs (naming every
// missing one) and the dispatch inputs, and outputs the values the later steps use.
import { appendFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { smokeChecks } from "./cloud-run-deploy.mjs";
import { checkInputs } from "./cloud-run-release.mjs";

/**
 * Repo variables per environment, the same names the control plane uses: `GCP_*` for prod and
 * `GCP_DEV_*` for dev. Each is a `project-env` output or input (infra/modules/project-env).
 */
export const PREFIX = { prod: "GCP_", dev: "GCP_DEV_" };
export const ENVIRONMENT_VARIABLES = {
  PROJECT_ID: "project_id",
  REGION: "region",
  SERVICE: "service",
  SERVICE_URL: "service_url",
  WIF_PROVIDER: "wif_provider",
  DEPLOYER_SA: "deployer_sa",
  IMAGE_REPO: "image_repo",
};
export const SMOKE_VARIABLE = "DEPLOY_SMOKE_CHECKS";
export const SMOKE_OTHER_HOSTS_VARIABLE = "DEPLOY_SMOKE_CHECKS_OTHER_HOSTS";

/** The first environment (ADR-0114): dev when the repo has a dev deployer, else prod. */
export function firstEnvironment(vars) {
  return vars.GCP_DEV_WIF_PROVIDER ? "dev" : "prod";
}

/** The environment's values by output name; adds each missing variable's name to `missing`. */
function environmentValues(vars, environment, missing) {
  const values = {};
  for (const [suffix, output] of Object.entries(ENVIRONMENT_VARIABLES)) {
    const name = `${PREFIX[environment]}${suffix}`;
    const value = (vars[name] ?? "").trim();
    if (!value) missing.push(name);
    // Values become step outputs: a newline would let one variable write another output.
    else if (/[\r\n]/.test(value)) throw new Error(`repo variable ${name} must be one line`);
    values[output] = value;
  }
  return values;
}

function requireNone(missing) {
  if (missing.length === 0) return;
  const list = missing.join(", ");
  throw new Error(
    `missing repo variable${missing.length > 1 ? "s" : ""} ${list}: set ${missing.length > 1 ? "them" : "it"} from the project-env Terraform outputs (docs/features/deploy-caller.md)`,
  );
}

function checkSmoke(vars, missing) {
  if (!(vars[SMOKE_VARIABLE] ?? "").trim()) {
    missing.push(SMOKE_VARIABLE);
    return;
  }
  smokeChecks({ publicHost: vars[SMOKE_VARIABLE], otherHosts: vars[SMOKE_OTHER_HOSTS_VARIABLE] });
}

/**
 * `workflow` is `deploy` or `release`; `vars` the repo variables (`toJSON(vars)`); `inputs` the
 * release dispatch inputs. Throws with a message for the run log; returns the step outputs.
 */
export function callerConfig({ workflow, vars, inputs = {} }) {
  const missing = [];
  if (workflow === "deploy") {
    const environment = firstEnvironment(vars);
    const values = environmentValues(vars, environment, missing);
    checkSmoke(vars, missing);
    requireNone(missing);
    return { environment, ...values, image: `${values.image_repo}/${values.service}` };
  }
  if (workflow !== "release") throw new Error("workflow must be deploy or release");

  const checked = checkInputs({ ...inputs, configured: true });
  const values = environmentValues(vars, checked.environment, missing);
  const out = { ...checked, ...values, image: `${values.image_repo}/${values.service}` };
  if (checked.action === "promote") {
    // Promote ships the digest the first environment verified, from that environment's registry.
    const first = firstEnvironment(vars);
    const source = first === checked.environment ? values : environmentValues(vars, first, missing);
    out.source_image = `${source.image_repo}/${source.service}`;
    checkSmoke(vars, missing);
  } else {
    out.source_image = "";
  }
  requireNone(missing);
  return out;
}

function setOutputs(outputs) {
  const lines = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
  process.stdout.write(lines);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
}

/** `VARS` is `toJSON(vars)`: repo variables are not secret, and only names reach the log. */
function readVars(raw) {
  try {
    const vars = JSON.parse(raw || "{}");
    if (vars && typeof vars === "object" && !Array.isArray(vars)) return vars;
  } catch {
    // Reported below without the input.
  }
  throw new Error("VARS: expected the repo variables as a JSON object");
}

function main() {
  const env = process.env;
  setOutputs(
    callerConfig({
      workflow: env.WORKFLOW,
      vars: readVars(env.VARS),
      inputs: {
        action: env.ACTION,
        environment: env.ENVIRONMENT,
        digest: env.DIGEST,
        revision: env.REVISION,
        request: env.REQUEST,
      },
    }),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`::error::${error.message}\n`);
    process.exit(1);
  }
}
