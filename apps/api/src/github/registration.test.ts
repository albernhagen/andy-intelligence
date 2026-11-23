import { readFileSync } from "node:fs";
import { InMemoryCodeHost, InMemoryWorkTracker, type Project } from "@andy/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { BASELINE_SOURCE, BaselineProposer, DATA_NOTE, MAX_BASELINE_REPOS } from "./registration";

const ROOT = new URL("../../../../", import.meta.url);
const SOURCE_TIP = "e".repeat(40);
const TARGET = "albernhagen/web";

const repo = (fullName: string) => ({
  fullName,
  defaultBranch: "main",
  private: false,
  url: `https://github.com/${fullName}`,
});

/** The baseline source's files as this checkout has them: the manifest, its sources, configs. */
function sourceFiles(): Map<string, string> {
  const read = (p: string) => readFileSync(new URL(p, ROOT), "utf8");
  const manifest = JSON.parse(read("platform/baseline/manifest.json")) as Record<
    string,
    { from: string }[] | string
  >;
  const files = new Map([
    ["platform/baseline/manifest.json", read("platform/baseline/manifest.json")],
  ]);
  for (const key of ["managed", "lines", "seed", "starter"]) {
    for (const f of manifest[key] as { from: string }[]) files.set(f.from, read(f.from));
  }
  for (const f of ["repo", "security", "actions", "labels", "ruleset-main", "source-only"]) {
    const p = `platform/baseline/github/${f}.json`;
    files.set(p, read(p));
  }
  return files;
}

describe("BaselineProposer", () => {
  let host: InMemoryCodeHost;
  let tracker: InMemoryWorkTracker;
  let proposer: BaselineProposer;
  let project: Project;
  let target: Map<string, string>;

  beforeEach(async () => {
    host = new InMemoryCodeHost([repo(BASELINE_SOURCE), repo(TARGET)]);
    host.branches.set(`${BASELINE_SOURCE}#main`, SOURCE_TIP);
    host.repoFiles.set(BASELINE_SOURCE, sourceFiles());
    target = new Map([["package.json", "{}\n"]]);
    host.repoFiles.set(TARGET, target);
    tracker = new InMemoryWorkTracker();
    project = await tracker.createProject({ name: "Web", key: "WEB", repos: [TARGET] });
    proposer = new BaselineProposer(host, tracker, () => new Date("2026-11-22T00:00:00Z"));
  });

  const needsYou = async () =>
    (await tracker.listTickets(project.id)).filter((t) => t.needsAttention);

  it("GivenANewlyRegisteredRepo_WhenProposed_ThenOnePrHasTheBaselineWithoutWorkflowsOrAgentSettings", async () => {
    const outcome = await proposer.onRepoRegistered(project, TARGET);
    expect(outcome.kind).toBe("opened");
    expect(host.baselineProposals).toHaveLength(1);
    const { proposal } = host.baselineProposals[0]!;
    const paths = proposal.files.map((f) => f.path);
    expect(proposal.branch).toBe(`baseline/${SOURCE_TIP.slice(0, 7)}`);
    expect(paths).toContain("lefthook.yml");
    expect(paths).toContain(".andy/baseline.json");
    expect(paths.some((p) => p.startsWith(".github/workflows/"))).toBe(false);
    expect(paths.some((p) => p.startsWith(".claude/"))).toBe(false);
    expect(
      JSON.parse(proposal.files.find((f) => f.path === ".andy/baseline.json")!.content),
    ).toMatchObject({ source: BASELINE_SOURCE, version: SOURCE_TIP, updated: "2026-11-22" });
    expect(proposal.body).toContain(
      `node platform/baseline/baseline.mjs finish ${TARGET} --ref ${SOURCE_TIP} --branch baseline/eeeeeee`,
    );
    expect(proposal.body).toContain("`.github/workflows/agent-run.yml`: missing");
    expect(await needsYou()).toEqual([]);
  });

  it("GivenAFileThatDiffers_WhenProposed_ThenItIsReportedAndNotInThePr", async () => {
    target.set("lefthook.yml", "ours: true\n");
    await proposer.onRepoRegistered(project, TARGET);
    const { proposal } = host.baselineProposals[0]!;
    expect(proposal.files.map((f) => f.path)).not.toContain("lefthook.yml");
    expect(proposal.body).toContain("- `lefthook.yml`: differs from the baseline; left unchanged");
  });

  it("GivenARulesetThatDiffersAndAdminOnlySettings_WhenProposed_ThenTheReportSaysSoAndNothingIsWritten", async () => {
    host.settings.set(`${TARGET}#rulesets?includes_parents=false`, {
      status: 200,
      data: [{ id: 7, name: "protect-main" }],
    });
    host.settings.set(`${TARGET}#rulesets/7`, {
      status: 200,
      data: { name: "protect-main", target: "branch", enforcement: "disabled", rules: [] },
    });
    host.settings.set(`${TARGET}#actions/permissions`, { status: 403, data: null });
    host.settings.set(`${TARGET}#`, { status: 500, data: { message: "boom" } });
    await proposer.onRepoRegistered(project, TARGET);
    const body = host.baselineProposals[0]!.proposal.body;
    expect(body).toContain("- ruleset: differs; left unchanged");
    expect(body).toContain('`enforcement`: want `"active"`, have `"disabled"`');
    expect(body).toContain("- actions: couldn't read (the App has no administration permission)");
    expect(body).toContain('- repo: couldn\'t read: `"repo: HTTP 500 {\\"message\\":\\"boom\\"}"`');
    expect(body).toContain(`node platform/baseline/baseline.mjs apply ${TARGET} --dry-run`);
    expect(host.settingReads.every((r) => r.startsWith(`${TARGET}#`))).toBe(true);
  });

  it("GivenTheBaselineSourceRepo_WhenRegistered_ThenNothingIsProposedOrTicketed", async () => {
    expect(await proposer.onRepoRegistered(project, BASELINE_SOURCE.toUpperCase())).toEqual({
      kind: "source",
    });
    expect(host.baselineProposals).toEqual([]);
    expect(await needsYou()).toEqual([]);
  });

  it("GivenOpeningThePrFails_WhenProposed_ThenTheErrorIsANeedsYouTicket", async () => {
    host.failPropose = new Error("422 Reference already exists");
    const outcome = await proposer.onRepoRegistered(project, TARGET);
    expect(outcome).toMatchObject({ kind: "failed", error: "422 Reference already exists" });
    const [ticket] = await needsYou();
    expect(ticket?.title).toBe(`Baseline PR for ${TARGET} failed`);
    expect(ticket?.body).toContain("422 Reference already exists");
    expect(ticket?.body).toContain(`baseline.mjs onboard ${TARGET} --ref ${SOURCE_TIP}`);
  });

  it("GivenTheSourceCantBeRead_WhenProposed_ThenTheErrorIsANeedsYouTicketAndNoPr", async () => {
    host.repoFiles.get(BASELINE_SOURCE)!.delete("lefthook.yml");
    const outcome = await proposer.onRepoRegistered(project, TARGET);
    expect(outcome.kind).toBe("failed");
    expect(host.baselineProposals).toEqual([]);
    expect((await needsYou())[0]?.body).toContain("has no lefthook.yml");
  });

  it("GivenAnEmptyRepo_WhenProposed_ThenNeedsYouGivesTheOnboardCommand", async () => {
    host.emptyRepos.add(TARGET);
    const outcome = await proposer.onRepoRegistered(project, TARGET);
    expect(outcome.kind).toBe("empty_repo");
    const [ticket] = await needsYou();
    expect(ticket?.title).toBe(`Baseline for ${TARGET}: the repo is empty`);
    expect(ticket?.body).toContain(`node platform/baseline/baseline.mjs onboard ${TARGET}`);
  });

  it("GivenEveryFileAlreadyThere_WhenProposed_ThenNoPrAndTheReportIsANeedsYouTicket", async () => {
    await proposer.onRepoRegistered(project, TARGET);
    for (const f of host.baselineProposals[0]!.proposal.files) target.set(f.path, f.content);
    host.baselineProposals.length = 0;
    const outcome = await proposer.onRepoRegistered(project, TARGET);
    expect(outcome.kind).toBe("nothing_to_write");
    expect(host.baselineProposals).toEqual([]);
    expect((await needsYou())[0]?.title).toBe(`Baseline for ${TARGET}: nothing for the App to add`);
  });

  it("GivenMoreReposThanTheCap_WhenTheProjectIsRegistered_ThenTheFirstGetPrsSideBySideAndTheRestOneNeedsYouTicket", async () => {
    const names = [
      "albernhagen/r1",
      "albernhagen/r2",
      "albernhagen/r3",
      "albernhagen/r4",
      "albernhagen/r5",
    ];
    for (const n of names) {
      host.install(repo(n));
      host.repoFiles.set(n, new Map([["package.json", "{}\n"]]));
    }
    const many = await tracker.createProject({
      name: "Many",
      key: "MANY",
      repos: [BASELINE_SOURCE, ...names],
    });
    const outcomes = await proposer.onProjectRegistered(many);
    expect(host.baselineProposals.map((p) => p.fullName)).toEqual(
      names.slice(0, MAX_BASELINE_REPOS),
    );
    expect(outcomes.has(BASELINE_SOURCE)).toBe(false);
    expect(outcomes.get("albernhagen/r5")?.kind).toBe("over_cap");
    const tickets = (await tracker.listTickets(many.id)).filter((t) => t.needsAttention);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.body).toContain("baseline.mjs onboard albernhagen/r4");
    expect(tickets[0]?.body).toContain("baseline.mjs onboard albernhagen/r5");
  });

  it("GivenAProposalPastTheDeadline_WhenTheProjectIsRegistered_ThenItStopsWaitingAndNeedsYouSaysSo", async () => {
    const slow = new BaselineProposer(host, tracker, () => new Date(), 5);
    host.readFile = () => new Promise(() => {});
    const outcomes = await slow.onProjectRegistered(project);
    expect(outcomes.get(TARGET)?.kind).toBe("timed_out");
    const [ticket] = await needsYou();
    expect(ticket?.title).toBe(`Baseline PR for ${TARGET} didn't finish`);
    expect(ticket?.body).toContain(DATA_NOTE);
  });
});
