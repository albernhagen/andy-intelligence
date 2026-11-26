import {
  InMemoryWatchdogQueue,
  InMemoryWorkTracker,
  type ChangedFile,
  type CodeHostEvent,
  type Listing,
  type NewTicket,
  type Project,
  type PullRequest,
  type Stage,
  type Ticket,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PullRequestTickets } from "./pull-requests";
import { TicketService } from "./tickets";
import {
  VERIFYING_NEEDS_YOU_MS,
  VERIFYING_SWITCH,
  VerifyingChecks,
  isNonDeployPath,
  skipsVerifying,
  verifiesMerges,
} from "./verifying";

const story: NewTicket = {
  type: "feature",
  title: "Board",
  body: "Andy can't see tickets.",
  acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list tickets"],
  size: "S",
  sizeReason: "one screen",
};

const merged: Extract<CodeHostEvent, { kind: "pull_request" }> = {
  kind: "pull_request",
  deliveryId: "d-1",
  projectId: "ai",
  repo: "albernhagen/andy-intelligence",
  action: "closed",
  receivedAt: "2026-11-04T12:00:00.000Z",
  pullRequest: {
    number: 70,
    state: "merged",
    draft: false,
    title: "AI-1: something",
    bodyFirstLine: "",
    fromFork: false,
    intoDefaultBranch: true,
    headRef: "AI-1/something",
    headSha: "abc",
    baseRef: "main",
    url: "https://github.com/albernhagen/andy-intelligence/pull/70",
  } satisfies PullRequest,
};

const file = (path: string, previousPath: string | null = null): ChangedFile => ({
  path,
  previousPath,
});
const listing = (paths: string[], complete = true): Listing<ChangedFile> => ({
  items: paths.map((p) => file(p)),
  complete,
});

describe("VERIFYING_SWITCH", () => {
  it("GivenTheShippedCode_WhenRead_ThenTheSwitchIsOffUntilTheVerifyTaskShips", () => {
    expect(VERIFYING_SWITCH).toBe(false);
  });
});

describe("skipsVerifying", () => {
  it("GivenDocsInfraOrMarkdownPaths_WhenChecked_ThenNonDeploy", () => {
    expect(isNonDeployPath("docs/features/board.md")).toBe(true);
    expect(isNonDeployPath("infra/control-plane/main.tf")).toBe(true);
    expect(isNonDeployPath("apps/web/README.md")).toBe(true);
    expect(isNonDeployPath("apps/api/src/app.ts")).toBe(false);
    expect(isNonDeployPath("docsite/index.ts")).toBe(false);
  });

  it("GivenOnlyDocsAndInfraChanged_WhenChecked_ThenSkipsVerifying", () => {
    expect(skipsVerifying(listing(["docs/a.md", "infra/x.tf", "README.md"]))).toBe(true);
  });

  it("GivenACodeFileChanged_WhenChecked_ThenVerifies", () => {
    expect(skipsVerifying(listing(["docs/a.md", "apps/api/src/app.ts"]))).toBe(false);
  });

  it("GivenACodeFileRenamedIntoDocs_WhenChecked_ThenVerifies", () => {
    expect(skipsVerifying({ items: [file("docs/x.ts", "apps/x.ts")], complete: true })).toBe(false);
  });

  it("GivenACutShortListing_WhenChecked_ThenVerifies", () => {
    expect(skipsVerifying(listing(["docs/a.md"], false))).toBe(false);
  });
});

describe("verifiesMerges", () => {
  it("GivenTheSwitchAndADeployKind_WhenChecked_ThenOnlyBothTogetherVerify", () => {
    expect(verifiesMerges(false, { deployKind: "cloud-run" })).toBe(false);
    expect(verifiesMerges(true, { deployKind: "none" })).toBe(false);
    expect(verifiesMerges(true, { deployKind: "cloud-run" })).toBe(true);
  });
});

describe("Verifying on merge (AI-181)", () => {
  let tracker: InMemoryWorkTracker;
  let queue: InMemoryWatchdogQueue;
  let service: TicketService;
  let project: Project;
  let clock: number;
  const now = () => new Date(clock);

  beforeEach(async () => {
    clock = Date.parse("2026-11-05T12:00:00.000Z");
    tracker = new InMemoryWorkTracker(() => new Date((clock += 1000)));
    queue = new InMemoryWatchdogQueue();
    const checks = new VerifyingChecks(tracker, queue, now);
    service = new TicketService(tracker, null, null, now, null, null, undefined, (t) =>
      checks.entered(t),
    );
    project = await tracker.createProject({ name: "AI", key: "AI" });
    project = await tracker.updateProject(project.id, { deployKind: "cloud-run" });
  });

  async function ticketAt(stage: Stage): Promise<Ticket> {
    const t = await service.create(project.id, story, "andy");
    if (stage === "backlog") return t;
    return service.move(project.id, t.id, stage, "andy", { force: true, reason: "setup" });
  }
  const reload = async (t: Ticket) => (await tracker.getTicket(project.id, t.id))!;
  const deploying = (): Project => ({ ...project, deployKind: "cloud-run" });
  const prs = (verifying: boolean, paths = ["apps/api/src/app.ts"]) => {
    const listChangedFiles = vi.fn(async () => listing(paths));
    return {
      prs: new PullRequestTickets(service, tracker, { verifying, files: { listChangedFiles } }),
      listChangedFiles,
    };
  };

  it("GivenTheSwitchOff_WhenADeployingProjectsPullRequestMerges_ThenDoneAsToday", async () => {
    const t = await ticketAt("ready_for_review");
    const { prs: p, listChangedFiles } = prs(false);
    expect((await p.apply(merged, deploying())).moves).toEqual(["done"]);
    expect((await reload(t)).stage).toBe("done");
    expect(listChangedFiles).not.toHaveBeenCalled();
  });

  it("GivenTheDefaultOptions_WhenAPullRequestMerges_ThenDoneBecauseTheSwitchShipsOff", async () => {
    const t = await ticketAt("ready_for_review");
    await new PullRequestTickets(service, tracker).apply(merged, deploying());
    expect((await reload(t)).stage).toBe("done");
  });

  it("GivenTheSwitchOn_WhenACodePullRequestMergesInADeployingProject_ThenVerifyingAndACheckQueued", async () => {
    const t = await ticketAt("ready_for_review");
    const { prs: p } = prs(true);
    expect((await p.apply(merged, deploying())).moves).toEqual(["verifying"]);
    expect((await reload(t)).stage).toBe("verifying");
    const [check] = [...queue.queued.values()];
    expect(check).toMatchObject({ kind: "verifying", projectId: project.id, ticketId: t.id });
    expect(Date.parse(check!.at) - clock).toBeGreaterThanOrEqual(VERIFYING_NEEDS_YOU_MS - 5000);
  });

  it("GivenTheSwitchOn_WhenAPullRequestMergesFromBacklog_ThenEveryStepToVerifying", async () => {
    const t = await ticketAt("backlog");
    const { prs: p } = prs(true);
    expect((await p.apply(merged, deploying())).moves).toEqual([
      "ready",
      "in_progress",
      "ready_for_review",
      "verifying",
    ]);
    expect((await reload(t)).stage).toBe("verifying");
  });

  it("GivenTheSwitchOn_WhenAPullRequestMergesInAProjectThatDoesNotDeploy_ThenDone", async () => {
    const t = await ticketAt("ready_for_review");
    const { prs: p, listChangedFiles } = prs(true);
    await p.apply(merged, { ...project, deployKind: "none" });
    expect((await reload(t)).stage).toBe("done");
    expect(listChangedFiles).not.toHaveBeenCalled();
  });

  it("GivenTheSwitchOn_WhenADocsAndInfraOnlyPullRequestMerges_ThenDone", async () => {
    const t = await ticketAt("ready_for_review");
    const { prs: p } = prs(true, ["docs/a.md", "infra/x.tf"]);
    await p.apply(merged, deploying());
    expect((await reload(t)).stage).toBe("done");
    expect(queue.queued.size).toBe(0);
  });

  it("GivenTheSwitchOn_WhenTheChangedFilesCannotBeRead_ThenVerifying", async () => {
    const t = await ticketAt("ready_for_review");
    const listChangedFiles = vi.fn(async () => {
      throw new Error("rate limited");
    });
    const p = new PullRequestTickets(service, tracker, {
      verifying: true,
      files: { listChangedFiles },
    });
    await p.apply(merged, deploying());
    expect((await reload(t)).stage).toBe("verifying");
  });

  it("GivenATicketInVerifying_WhenAPullRequestMergesWithTheSwitchOff_ThenDone", async () => {
    const t = await ticketAt("ready_for_review");
    await prs(true).prs.apply(merged, deploying());
    await prs(false).prs.apply({ ...merged, deliveryId: "d-2" }, deploying());
    expect((await reload(t)).stage).toBe("done");
  });

  it("GivenAProjectThatDoesNotDeploy_WhenMovedToVerifying_ThenRefusedUnlessForced", async () => {
    await tracker.updateProject(project.id, { deployKind: "none" });
    const t = await ticketAt("ready_for_review");
    await expect(service.move(project.id, t.id, "verifying", "andy")).rejects.toThrow(
      "doesn't deploy",
    );
    await expect(service.moveForward("AI-1", "verifying", "agent:r1")).rejects.toThrow(
      "doesn't deploy",
    );
    expect(
      await service.move(project.id, t.id, "verifying", "andy", { force: true }),
    ).toMatchObject({ stage: "verifying" });
  });

  it("GivenATicketInVerifying_WhenMovedToReadyForReview_ThenRefused", async () => {
    const t = await ticketAt("ready_for_review");
    await service.move(project.id, t.id, "verifying", "andy");
    await expect(service.move(project.id, t.id, "ready_for_review", "andy")).rejects.toThrow(
      "can't move from verifying",
    );
  });

  it("GivenATicketInVerifying_WhenSentBackToInProgress_ThenFlaggedNeedsYou", async () => {
    const t = await ticketAt("ready_for_review");
    await service.move(project.id, t.id, "verifying", "andy");
    const back = await service.move(project.id, t.id, "in_progress", "system");
    expect(back).toMatchObject({ stage: "in_progress", needsAttention: true });
  });

  it("GivenATicketInVerifying_WhenMovedToDone_ThenDone", async () => {
    const t = await ticketAt("ready_for_review");
    await service.move(project.id, t.id, "verifying", "andy");
    expect(await service.move(project.id, t.id, "done", "andy")).toMatchObject({ stage: "done" });
  });

  it("GivenATicketInReview_WhenMovedForwardByKeyToVerifying_ThenAccepted", async () => {
    await ticketAt("ready_for_review");
    expect(await service.moveForward("AI-1", "verifying", "agent:r1")).toMatchObject({
      stage: "verifying",
    });
    expect(await service.moveForward("AI-1", "done", "agent:r1")).toMatchObject({ stage: "done" });
  });
});

describe("VerifyingChecks", () => {
  let tracker: InMemoryWorkTracker;
  let service: TicketService;
  let checks: VerifyingChecks;
  let project: Project;
  let clock: number;

  beforeEach(async () => {
    clock = Date.parse("2026-11-05T12:00:00.000Z");
    tracker = new InMemoryWorkTracker(() => new Date(clock));
    checks = new VerifyingChecks(tracker, new InMemoryWatchdogQueue(), () => new Date(clock));
    service = new TicketService(tracker);
    project = await tracker.createProject({ name: "AI", key: "AI" });
    project = await tracker.updateProject(project.id, { deployKind: "cloud-run" });
  });

  async function verifyingTicket(): Promise<Ticket> {
    const t = await service.create(project.id, story, "andy");
    await service.move(project.id, t.id, "ready_for_review", "andy", { force: true });
    return service.move(project.id, t.id, "verifying", "andy");
  }

  it("GivenATicketInVerifyingOverTwoHours_WhenChecked_ThenFlaggedNeedsYouWithAComment", async () => {
    const t = await verifyingTicket();
    clock += VERIFYING_NEEDS_YOU_MS + 1000;
    expect(await checks.check(project.id, t.id)).toBe("flagged");
    expect((await tracker.getTicket(project.id, t.id))?.needsAttention).toBe(true);
    const events = await tracker.listEvents(project.id, t.id);
    expect(events.at(-1)).toMatchObject({ kind: "comment", actor: "system" });
  });

  it("GivenAFlaggedTicket_WhenCheckedAgain_ThenNothingChanges", async () => {
    const t = await verifyingTicket();
    clock += VERIFYING_NEEDS_YOU_MS + 1000;
    await checks.check(project.id, t.id);
    expect(await checks.check(project.id, t.id)).toBe("already_flagged");
  });

  it("GivenATicketThatLeftVerifying_WhenChecked_ThenLeftAlone", async () => {
    const t = await verifyingTicket();
    await service.move(project.id, t.id, "done", "andy");
    clock += VERIFYING_NEEDS_YOU_MS + 1000;
    expect(await checks.check(project.id, t.id)).toBe("left");
    expect((await tracker.getTicket(project.id, t.id))?.needsAttention).toBe(false);
  });

  it("GivenAnEarlyDelivery_WhenChecked_ThenEarlySoTheQueueRetries", async () => {
    const t = await verifyingTicket();
    clock += VERIFYING_NEEDS_YOU_MS - 60_000;
    expect(await checks.check(project.id, t.id)).toBe("early");
  });

  it("GivenATicketThatReenteredVerifying_WhenTheOldCheckArrives_ThenSuperseded", async () => {
    const t = await verifyingTicket();
    clock += VERIFYING_NEEDS_YOU_MS;
    await service.move(project.id, t.id, "in_progress", "andy");
    await service.move(project.id, t.id, "ready_for_review", "andy");
    await service.move(project.id, t.id, "verifying", "andy");
    expect(await checks.check(project.id, t.id)).toBe("superseded");
  });

  it("GivenAnUnknownTicket_WhenChecked_ThenNotFound", async () => {
    expect(await checks.check(project.id, "nope")).toBe("not_found");
  });

  it("GivenAQueueFailure_WhenATicketEntersVerifying_ThenLoggedAndNotThrown", async () => {
    const failing = new VerifyingChecks(
      tracker,
      {
        scheduleCheck: async () => {
          throw new Error("PERMISSION_DENIED");
        },
      },
      () => new Date(clock),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await expect(failing.entered({ projectId: "ai", id: "t1", key: "AI-1" })).resolves.toBe(
      undefined,
    );
    expect(log.mock.calls.flat().join()).toContain("verifying check not queued");
    log.mockRestore();
  });
});
