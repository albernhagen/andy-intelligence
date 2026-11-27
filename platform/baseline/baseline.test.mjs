import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { configFor, deployKindFor, loadConfig, parseArgs, parseGhResponse } from "./baseline.mjs";
import { pinActions, renderFiles } from "./files.mjs";
import {
  ENVIRONMENT_VARIABLES,
  PREFIX,
  PREVIEW_VARIABLES,
  SMOKE_VARIABLE,
} from "../../scripts/cloud-run-caller.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(
  readFileSync(path.join(ROOT, "platform/baseline/manifest.json"), "utf8"),
);
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

describe("parseArgs", () => {
  it("GivenOnboardWithRef_WhenParsed_ThenOptions", () => {
    expect(parseArgs(["onboard", "albernhagen/scratch", "--ref", "v1.0.0"])).toMatchObject({
      command: "onboard",
      repo: "albernhagen/scratch",
      ref: "v1.0.0",
    });
  });

  it("GivenFilesWithoutRef_WhenParsed_ThenError", () => {
    expect(() => parseArgs(["files", "albernhagen/scratch"])).toThrow("needs --ref");
  });

  it("GivenFinishWithRefAndBaselineBranch_WhenParsed_ThenOptions", () => {
    expect(
      parseArgs(["finish", "a/b", "--ref", "abc1234", "--branch", "baseline/abc1234"]),
    ).toMatchObject({ command: "finish", ref: "abc1234", branch: "baseline/abc1234" });
  });

  it("GivenFinishWithoutABaselineBranch_WhenParsed_ThenError", () => {
    expect(() => parseArgs(["finish", "a/b", "--ref", "abc1234"])).toThrow("--branch");
    expect(() =>
      parseArgs(["finish", "a/b", "--ref", "abc1234", "--branch", "main; rm -rf /"]),
    ).toThrow("--branch");
  });

  it("GivenFilesWithADeployKind_WhenParsed_ThenOptions", () => {
    expect(parseArgs(["files", "a/b", "--ref", "v1", "--deploy-kind", "cloud-run"])).toMatchObject({
      command: "files",
      deployKind: "cloud-run",
    });
  });

  it("GivenAnUnknownDeployKindOrOneOnCheck_WhenParsed_ThenError", () => {
    expect(() => parseArgs(["files", "a/b", "--ref", "v1", "--deploy-kind", "static"])).toThrow(
      "deploy kind must be one of",
    );
    expect(() => parseArgs(["check", "a/b", "--deploy-kind", "cloud-run"])).toThrow(
      "takes no --deploy-kind",
    );
  });

  it("GivenFilesWithEnvironments_WhenParsed_ThenOptions", () => {
    expect(
      parseArgs(["files", "a/b", "--ref", "v1", "--environments", "dev-and-prod"]),
    ).toMatchObject({ environments: "dev-and-prod" });
  });

  it("GivenAnUnknownPolicyOrOneOnFinish_WhenParsed_ThenError", () => {
    expect(() => parseArgs(["files", "a/b", "--ref", "v1", "--environments", "staging"])).toThrow(
      "environments must be one of",
    );
    expect(() =>
      parseArgs([
        "finish",
        "a/b",
        "--ref",
        "abc1234",
        "--branch",
        "baseline/abc1234",
        "--environments",
        "prod-only",
      ]),
    ).toThrow("takes no --environments");
  });

  it("GivenABadRepoOrSection_WhenParsed_ThenError", () => {
    expect(() => parseArgs(["check", "scratch"])).toThrow("owner/name");
    expect(() => parseArgs(["check", "a/b", "--only", "ruleset,secrets"])).toThrow("secrets");
  });
});

describe("deployKindFor", () => {
  it("GivenAFlag_WhenResolved_ThenTheFlagWinsOverTheRecord", () => {
    expect(deployKindFor("none", '{"deployKind":"cloud-run"}')).toBe("none");
  });

  it("GivenNoFlag_WhenResolved_ThenTheRecordElseNone", () => {
    expect(deployKindFor(undefined, '{"deployKind":"cloud-run"}')).toBe("cloud-run");
    expect(deployKindFor(undefined, '{"version":"abc"}')).toBe("none");
    expect(deployKindFor(undefined, null)).toBe("none");
  });

  it("GivenARecordThatIsNotJson_WhenResolved_ThenAsksForTheFlag", () => {
    expect(() => deployKindFor(undefined, "nope")).toThrow("pass --deploy-kind");
  });
});

/**
 * AI-206: M6.17: deploy.yml and release.yml (and AI-207: M6.18: preview.yml) are written only for a
 * `cloud-run` project (ADR-0114),
 * with every andy-intelligence action pinned by SHA.
 */
describe("deploy caller in the baseline", () => {
  const SHA = "f".repeat(40);
  const DEPLOY_FILES = [
    ".github/workflows/deploy.yml",
    ".github/workflows/release.yml",
    ".github/workflows/preview.yml",
  ];
  const render = (deployKind) =>
    renderFiles(manifest, read, { sha: SHA, ref: "v1.0.0", deployKind }).managed;

  it("GivenACloudRunProject_WhenRendered_ThenDeployAndReleaseArePinnedBySha", () => {
    const files = render("cloud-run").filter((f) => DEPLOY_FILES.includes(f.path));
    expect(files.map((f) => f.path)).toEqual(DEPLOY_FILES);
    for (const f of files) {
      const uses = [...f.content.matchAll(/uses:\s+(\S+)/g)].map((m) => m[1]);
      expect(uses.length, f.path).toBeGreaterThan(0);
      for (const u of uses) expect(u, f.path).toMatch(/@[0-9a-f]{40}$/);
      if (!f.path.endsWith("preview.yml")) {
        expect(f.content).toContain(
          `${manifest.source}/platform/actions/cloud-run-safe-deploy@${SHA}`,
        );
      }
      expect(f.content).toContain(
        `${manifest.source}/platform/actions/cloud-run-caller-config@${SHA}`,
      );
    }
  });

  it("GivenACloudRunProject_WhenRendered_ThenPreviewUsesThePinnedPreviewAction", () => {
    const preview = render("cloud-run").find((f) => f.path === ".github/workflows/preview.yml");
    expect(preview.content).toContain(
      `${manifest.source}/platform/actions/cloud-run-preview@${SHA}`,
    );
    expect(preview.content).not.toContain("uses: ./");
  });

  it("GivenADeployKindNoneProject_WhenRendered_ThenNeitherDeployNorRelease", () => {
    const paths = render("none").map((f) => f.path);
    for (const p of DEPLOY_FILES) expect(paths).not.toContain(p);
  });

  it("GivenTheManifest_WhenRead_ThenOnlyTheDeployFilesAndDependabotNeedAKind", () => {
    const kinded = manifest.managed.filter((m) => m.deployKind);
    expect(kinded.map((m) => [m.path, m.deployKind, m.pin])).toEqual([
      [".github/workflows/deploy.yml", "cloud-run", true],
      [".github/workflows/release.yml", "cloud-run", true],
      [".github/workflows/preview.yml", "cloud-run", true],
      // One source per kind (AI-399): `cloud-run` adds the infra/ Terraform root.
      [".github/dependabot.yml", "none", undefined],
      [".github/dependabot.yml", "cloud-run", undefined],
    ]);
  });
});

/**
 * AI-109: M6.22: the deploy scaffold. A `cloud-run` project's baseline PR seeds a template
 * Terraform root in infra/ with one environment (`prod-only`) or two (`dev-and-prod`), each with a
 * budget, its modules pinned by SHA; a `none` project gets none of it.
 */
describe("deploy scaffold in the baseline", () => {
  const SHA = "e".repeat(40);
  const seed = (deployKind, environments) =>
    renderFiles(manifest, read, { sha: SHA, ref: "v1.0.0", deployKind, environments }).seed;
  const file = (files, p) => files.find((f) => f.path === p)?.content ?? "";
  const SCAFFOLD = [
    ".terraform-version",
    "infra/main.tf",
    "infra/variables.tf",
    "infra/outputs.tf",
    "infra/terraform.tfvars.example",
    "infra/tests/plan.tftest.hcl",
  ];
  const repoVariables = (environment, preview) => [
    ...Object.keys(ENVIRONMENT_VARIABLES).map((n) => `${PREFIX[environment]}${n}`),
    ...(preview ? Object.keys(PREVIEW_VARIABLES).map((n) => `${PREFIX[environment]}${n}`) : []),
  ];

  it("GivenDeployKindNone_WhenRendered_ThenNoDeployScaffold", () => {
    const paths = seed("none", "dev-and-prod").map((f) => f.path);
    for (const p of SCAFFOLD) expect(paths).not.toContain(p);
  });

  it("GivenCloudRunProdOnly_WhenRendered_ThenOneEnvironmentWithABudget", () => {
    const files = seed("cloud-run", "prod-only");
    expect(files.map((f) => f.path)).toEqual(expect.arrayContaining(SCAFFOLD));
    const main = file(files, "infra/main.tf");
    expect(main.match(/^module "\w+"/gm)).toEqual(['module "prod"', 'module "prod_budget"']);
  });

  it("GivenCloudRunDevAndProd_WhenRendered_ThenTwoEnvironmentsEachWithABudget", () => {
    const main = file(seed("cloud-run", "dev-and-prod"), "infra/main.tf");
    expect(main.match(/^module "\w+"/gm)).toEqual([
      'module "dev"',
      'module "prod"',
      'module "dev_budget"',
      'module "prod_budget"',
    ]);
  });

  it.each(["prod-only", "dev-and-prod"])(
    "Given%s_WhenRendered_ThenEveryModuleIsPinnedBySha",
    (environments) => {
      const main = file(seed("cloud-run", environments), "infra/main.tf");
      const sources = [...main.matchAll(/^\s*source\s*=\s*"([^"]+)"/gm)]
        .map((m) => m[1])
        .filter((s) => s !== "hashicorp/google");
      expect(sources.length).toBeGreaterThan(0);
      for (const s of sources) {
        expect(s).toMatch(
          new RegExp(
            `^git::https://github.com/${manifest.source}.git//infra/modules/[\\w-]+\\?ref=${SHA}$`,
          ),
        );
      }
    },
  );

  it("GivenProdOnly_WhenRendered_ThenOutputsNameEveryDeployCallerVariable", () => {
    const outputs = file(seed("cloud-run", "prod-only"), "infra/outputs.tf");
    for (const v of [...repoVariables("prod", true), SMOKE_VARIABLE])
      expect(outputs).toMatch(new RegExp(`^\\s+${v}\\s+=`, "m"));
  });

  it("GivenDevAndProd_WhenRendered_ThenOutputsNameEveryDeployCallerVariable", () => {
    const outputs = file(seed("cloud-run", "dev-and-prod"), "infra/outputs.tf");
    for (const v of [
      ...repoVariables("dev", true),
      ...repoVariables("prod", false),
      SMOKE_VARIABLE,
    ])
      expect(outputs).toMatch(new RegExp(`^\\s+${v}\\s+=`, "m"));
  });

  it.each(["prod-only", "dev-and-prod"])(
    "Given%s_WhenRendered_ThenNoRealProjectOrBillingIds",
    (environments) => {
      for (const f of seed("cloud-run", environments).filter((f) => f.path.startsWith("infra/"))) {
        for (const m of f.content.matchAll(/project_id\s*=\s*"([^"]+)"/g))
          expect(m[1], f.path).toMatch(/^example-(dev|prod)-000000$/);
        for (const m of f.content.matchAll(/[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}/g))
          expect(m[0], f.path).toBe("000000-000000-000000");
      }
    },
  );
});

describe("parseGhResponse", () => {
  it("GivenHeadersAndJson_WhenParsed_ThenStatusAndData", () => {
    const out = 'HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n{"enabled":true}';
    expect(parseGhResponse(out)).toEqual({ status: 200, data: { enabled: true } });
  });

  it("GivenNoContent_WhenParsed_ThenNullData", () => {
    expect(parseGhResponse("HTTP/2.0 204 No Content\r\nX: y\r\n\r\n")).toEqual({
      status: 204,
      data: null,
    });
  });

  it("GivenNoStatusLine_WhenParsed_ThenError", () => {
    expect(() => parseGhResponse("", "gh: not logged in")).toThrow("not logged in");
  });
});

describe("baseline consistency", () => {
  it("GivenTheManifest_WhenRead_ThenEverySourceFileExists", () => {
    const entries = [...manifest.managed, ...manifest.lines, ...manifest.seed, ...manifest.starter];
    for (const e of entries) expect(existsSync(path.join(ROOT, e.from)), e.from).toBe(true);
  });

  it("GivenTheManifest_WhenRead_ThenTheDesignFileIsACreateOnlySeed", () => {
    expect(manifest.seed).toContainEqual({ path: "design.md", from: "template/design.md" });
    expect(manifest.managed.map((m) => m.path)).not.toContain("design.md");
    expect(read("template/design.md")).toMatch(/project owner edits this file/);
  });

  it("GivenTheAgentRulesTemplate_WhenRead_ThenUiTicketsFollowTheDesignFile", () => {
    const rules = read("template/AGENTS.md.template");
    expect(rules).toMatch(/changes a UI follows `design\.md`/);
    expect(rules).toMatch(
      /interactive session, ask; an unattended build records the conflict as a deviation/,
    );
  });

  it("GivenPinnedWorkflows_WhenRendered_ThenNoLocalActionsRemain", () => {
    for (const e of manifest.managed.filter((m) => m.pin)) {
      const out = pinActions(read(e.from), {
        source: manifest.source,
        sha: "a".repeat(40),
        ref: "v1.0.0",
      });
      expect(out, e.from).not.toMatch(/uses:\s+\.\//);
    }
  });

  it("GivenTheRulesetForAManagedRepo_WhenComparedWithCallerJobs_ThenEveryRequiredCheckIsAJob", () => {
    const workflows = manifest.managed
      .filter((m) => m.pin)
      .map((m) => read(m.from))
      .join("\n");
    const jobs = new Set([...workflows.matchAll(/^ {2}([\w-]+):\s*$/gm)].map((m) => m[1]));
    for (const lang of workflows.match(/language: \[([^\]]+)\]/)[1].split(","))
      jobs.add(`codeql (${lang.trim()})`);
    const required = requiredChecks(
      configFor(loadConfig(), "albernhagen/managed", manifest.source),
    );
    for (const check of required) expect(jobs.has(check), check).toBe(true);
  });

  it("GivenSourceOnlyChecks_WhenComparedWithThisRepo_ThenEachIsRequiredAndAJobHere", () => {
    const config = loadConfig();
    const workflows = readdirSync(path.join(ROOT, ".github/workflows"))
      .map((f) => read(`.github/workflows/${f}`))
      .join("\n");
    const jobs = new Set([...workflows.matchAll(/^ {2}([\w-]+):\s*$/gm)].map((m) => m[1]));
    expect(config.sourceOnlyChecks.length).toBeGreaterThan(0);
    for (const check of config.sourceOnlyChecks) {
      expect(requiredChecks(config), check).toContain(check);
      expect(jobs.has(check), check).toBe(true);
    }
  });
});

const requiredChecks = (config) =>
  config.ruleset.rules
    .find((r) => r.type === "required_status_checks")
    .parameters.required_status_checks.map((c) => c.context);

describe("configFor", () => {
  it("GivenTheSourceRepo_WhenConfigured_ThenSourceOnlyChecksStayRequired", () => {
    const config = configFor(loadConfig(), "Albernhagen/Andy-Intelligence", manifest.source);
    expect(requiredChecks(config)).toContain("firestore-suite");
  });

  it("GivenAManagedRepo_WhenConfigured_ThenSourceOnlyChecksAreDroppedAndTheRestKept", () => {
    const base = loadConfig();
    const config = configFor(base, "albernhagen/managed", manifest.source);
    expect(requiredChecks(config)).not.toContain("firestore-suite");
    expect(requiredChecks(config)).toEqual(
      requiredChecks(base).filter((c) => !base.sourceOnlyChecks.includes(c)),
    );
    expect(requiredChecks(base)).toContain("firestore-suite");
  });

  it("GivenAManagedRepoWithoutTheJobs_WhenConfigured_ThenSandboxAndEvalChecksAreNotRequired", () => {
    const evalChecks = ["sandbox-self-test", "agent-evals", "agent-evals-plumbing"];
    const base = loadConfig();
    const config = configFor(base, "albernhagen/managed", manifest.source);
    expect(requiredChecks(base)).toEqual(expect.arrayContaining(evalChecks));
    for (const check of evalChecks) expect(requiredChecks(config)).not.toContain(check);
  });

  it("GivenAManagedRepoWithoutTheJobs_WhenConfigured_ThenReleaseNoteAndUiScreenshotsAreNotRequired", () => {
    const base = loadConfig();
    const config = configFor(base, "albernhagen/managed", manifest.source);
    expect(requiredChecks(base)).toEqual(
      expect.arrayContaining(["release-note", "ui-screenshots"]),
    );
    expect(requiredChecks(config)).not.toContain("release-note");
    expect(requiredChecks(config)).not.toContain("ui-screenshots");
  });
});

/**
 * AI-106: M5.3: the managed-repo caller (ADR-0096). The control plane accepts callbacks and the
 * push grant only from `CLAUDE_EXECUTOR_REF`, so the caller must call exactly that executor.
 */
describe("managed-repo caller", () => {
  const CALLER = "template/.github/workflows/agent-run.yml";
  const executorTs = read("packages/github/src/executor.ts");
  const platformRepo = /PLATFORM_REPO = "([^"]+)"/.exec(executorTs)?.[1];
  const executorRef = `${platformRepo}/.github/workflows/claude-executor.yml@refs/heads/main`;
  const uses = (text) => [...text.matchAll(/^\s+uses:\s+(\S+)/gm)].map((m) => m[1]);
  const withoutComments = (text) =>
    text
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");

  it("GivenTheManifest_WhenRead_ThenTheCallerIsAManagedFile", () => {
    expect(manifest.managed).toContainEqual({
      path: ".github/workflows/agent-run.yml",
      from: CALLER,
    });
  });

  it("GivenTheCaller_WhenRead_ThenItCallsTheExecutorTheControlPlaneAccepts", () => {
    expect(executorTs).toContain(
      "export const CLAUDE_EXECUTOR_REF = `${PLATFORM_REPO}/.github/workflows/claude-executor.yml@refs/heads/main`",
    );
    const [only, ...rest] = uses(read(CALLER));
    expect(rest).toEqual([]);
    expect(only.replace(/@main$/, "@refs/heads/main")).toBe(executorRef);
  });

  it("GivenTheCaller_WhenRead_ThenOnlyTheAdrsPermissionsAndInputs", () => {
    const text = read(CALLER);
    expect(text).toMatch(/^permissions: \{\}$/m);
    const jobPermissions = /^ {4}permissions:\n((?: {6}.+\n)+)/m.exec(text)?.[1] ?? "";
    expect(
      jobPermissions
        .split("\n")
        .filter(Boolean)
        .map((l) => l.trim().split(" #")[0]),
    ).toEqual(["contents: read", "id-token: write"]);
    const inputs = /^ {4}inputs:\n((?: {6}.+\n)+)/m.exec(text)?.[1] ?? "";
    expect([...inputs.matchAll(/^ {6}([\w-]+):$/gm)].map((m) => m[1])).toEqual([
      "run_id",
      "credential",
    ]);
  });

  it("GivenTheCaller_WhenRead_ThenItPassesBothCredentialsByNameForTheAgentEnvironment", () => {
    // AI-106: GitHub resolves a passed secret from the executor job's environment (`agent`)
    // first; the caller must still name it, or it reaches the executor empty.
    const text = read(CALLER);
    expect(text).toContain("CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}");
    expect(text).toContain("ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}");
  });

  it("GivenThisReposCaller_WhenComparedWithTheTemplate_ThenOnlyUsesDiffers", () => {
    const local = withoutComments(read(".github/workflows/agent-run.yml"));
    const template = withoutComments(read(CALLER));
    expect(template.replace(uses(template)[0], "./.github/workflows/claude-executor.yml")).toBe(
      local,
    );
  });
});

/** Dependabot by deploy kind (AI-399): a `none` repo gets no entry for a directory it lacks. */
describe("dependabot.yml in the baseline", () => {
  const dependabot = (deployKind) =>
    renderFiles(manifest, read, { sha: "f".repeat(40), ref: "v1.0.0", deployKind }).managed.filter(
      (f) => f.path === ".github/dependabot.yml",
    );
  const body = (text) => text.slice(text.indexOf("version: 2"));

  it("GivenANoneProject_WhenRendered_ThenOneDependabotFileWithNoTerraformOrDocker", () => {
    const files = dependabot("none");
    expect(files).toHaveLength(1);
    expect(files[0].content).toContain("dependency-type: development");
    expect(files[0].content).toContain("dependency-type: production");
    expect(files[0].content).not.toMatch(/package-ecosystem: (terraform|docker)/);
  });

  it("GivenACloudRunProject_WhenRendered_ThenTheNoneEntriesPlusAMonthlyTerraformGroupForInfra", () => {
    const [none] = dependabot("none");
    const files = dependabot("cloud-run");
    expect(files).toHaveLength(1);
    const content = files[0].content;
    expect(content).toContain(body(none.content));
    const terraform = content.slice(content.indexOf("package-ecosystem: terraform"));
    expect(terraform).toContain("directory: /infra");
    expect(terraform).toContain("interval: monthly");
    expect(terraform).toContain('patterns: ["*"]');
    expect(terraform).toContain("default-days: 7");
  });

  it("GivenEitherKind_WhenRendered_ThenActionsAreMonthlyAndNpmWeekly", () => {
    for (const kind of ["none", "cloud-run"]) {
      const [{ content }] = dependabot(kind);
      const actions = content.slice(content.indexOf("package-ecosystem: github-actions"));
      expect(actions.slice(0, actions.indexOf("groups:")), kind).toContain("interval: monthly");
      const npm = content.slice(
        content.indexOf("package-ecosystem: npm"),
        content.indexOf("package-ecosystem: github-actions"),
      );
      expect(npm, kind).toContain("interval: weekly");
    }
  });
});
