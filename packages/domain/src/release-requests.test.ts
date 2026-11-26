import {
  InMemoryCodeHost,
  InMemoryDeploymentStore,
  InMemoryReleaseRequestStore,
  InMemoryWatchdogQueue,
  InMemoryWorkTracker,
  RELEASE_REQUEST_LIMITS,
  type Deployment,
  type NewDeployment,
  type ReleaseRequest,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RELEASE_CHECK_DELAY_MS,
  RELEASE_CHECK_MAX_MS,
  ReleaseService,
  releaseRequestMismatch,
} from "./release-requests";

const REPO = {
  fullName: "albernhagen/shop",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/shop",
};
const OWNER = "user:owner";
const digest = (n: number) => `sha256:${String(n).repeat(64).slice(0, 64)}`;
const sha = (n: number) => String(n).repeat(40).slice(0, 40);

describe("ReleaseService", () => {
  let clock: Date;
  let tracker: InMemoryWorkTracker;
  let deployments: InMemoryDeploymentStore;
  let requests: InMemoryReleaseRequestStore;
  let host: InMemoryCodeHost;
  let queue: InMemoryWatchdogQueue;
  let service: ReleaseService;
  let projectId: string;

  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };
  const deploy = async (overrides: Partial<NewDeployment>): Promise<Deployment> => {
    advance(1_000);
    const at = clock.toISOString();
    return deployments.record({
      projectId,
      environment: "prod",
      imageDigest: digest(1),
      gitSha: sha(1),
      revision: null,
      kind: "deploy",
      status: "succeeded",
      startedAt: at,
      finishedAt: at,
      actor: "system",
      previousDeploymentId: null,
      ...overrides,
    });
  };
  const configure = (patch: Parameters<InMemoryWorkTracker["updateProject"]>[1]) =>
    tracker.updateProject(projectId, patch);

  beforeEach(async () => {
    clock = new Date("2026-11-26T10:00:00.000Z");
    const now = () => clock;
    tracker = new InMemoryWorkTracker();
    const project = await tracker.createProject({
      name: "Shop",
      key: "SHOP",
      repos: [REPO.fullName],
    });
    projectId = project.id;
    await configure({ deployKind: "cloud-run", environments: "dev-and-prod" });
    deployments = new InMemoryDeploymentStore();
    requests = new InMemoryReleaseRequestStore();
    host = new InMemoryCodeHost([REPO]);
    queue = new InMemoryWatchdogQueue();
    service = new ReleaseService({
      tracker,
      deployments,
      requests,
      codeHost: async () => host,
      queue,
      now,
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  const onlyRun = () => {
    const runs = [...host.workflowRuns.values()];
    expect(runs).toHaveLength(1);
    return runs[0]!;
  };

  describe("promote", () => {
    it("GivenASucceededDevDeployment_WhenTheOwnerPromotesWithNoDigest_ThenReleaseYmlRunsWithItsDigestAndTheRequestIsDispatched", async () => {
      await deploy({ environment: "dev", imageDigest: digest(1) });
      const latest = await deploy({ environment: "dev", imageDigest: digest(2), gitSha: sha(2) });

      const { request, summary } = await service.promote({ projectId }, OWNER);

      const run = onlyRun();
      expect(run.workflow).toBe("release.yml");
      expect(run.inputs).toEqual({
        action: "promote",
        environment: "prod",
        digest: digest(2),
        revision: "",
        request: request.id,
      });
      expect(request).toMatchObject({
        status: "dispatched",
        action: "promote",
        digest: digest(2),
        sourceDeploymentId: latest.id,
        actor: OWNER,
        runId: run.run.id,
      });
      expect(summary).toContain("prod will serve sha256:2222222222");
      expect([...queue.queued.values()]).toEqual([
        {
          kind: "release",
          projectId,
          requestId: request.id,
          at: new Date(clock.getTime() + RELEASE_CHECK_DELAY_MS).toISOString(),
        },
      ]);
    });

    it("GivenANamedDigest_WhenPromoted_ThenThatDigestShips", async () => {
      await deploy({ environment: "dev", imageDigest: digest(1) });
      await deploy({ environment: "dev", imageDigest: digest(2) });
      await service.promote({ projectId, digest: digest(1) }, OWNER);
      expect(onlyRun().inputs.digest).toBe(digest(1));
    });

    it("GivenADigestNoSucceededDevDeploymentHas_WhenPromoted_ThenRefusedAndNothingDispatched", async () => {
      await deploy({ environment: "dev", imageDigest: digest(1), status: "failed" });
      await expect(service.promote({ projectId, digest: digest(1) }, OWNER)).rejects.toMatchObject({
        code: "invalid_field",
      });
      expect(host.workflowRuns.size).toBe(0);
      expect(await requests.list(projectId)).toEqual([]);
    });

    it("GivenProdAlreadyServesTheDigest_WhenPromoted_ThenRefused", async () => {
      await deploy({ environment: "dev", imageDigest: digest(1) });
      await deploy({ environment: "prod", imageDigest: digest(1), kind: "promote" });
      await expect(service.promote({ projectId }, OWNER)).rejects.toMatchObject({
        code: "not_releasable",
        message: expect.stringContaining("already serves"),
      });
    });

    it("GivenAProdOnlyProject_WhenPromoted_ThenRefusedWithAReasonAndNothingDispatched", async () => {
      await configure({ environments: "prod-only" });
      await expect(service.promote({ projectId }, OWNER)).rejects.toMatchObject({
        code: "not_releasable",
        message: expect.stringContaining("roll back instead"),
      });
      expect(host.workflowRuns.size).toBe(0);
    });

    it("GivenDeployKindNone_WhenPromotedOrRolledBack_ThenBothAreRefusedSayingWhy", async () => {
      await configure({ deployKind: "none" });
      for (const call of [
        () => service.promote({ projectId }, OWNER),
        () => service.rollback({ projectId }, OWNER),
      ]) {
        await expect(call()).rejects.toMatchObject({
          code: "not_releasable",
          message: expect.stringContaining("does not deploy (deploy kind none)"),
        });
      }
      expect(host.workflowRuns.size).toBe(0);
    });

    it("GivenAnAgent_WhenItPromotes_ThenForbiddenAndNothingDispatched", async () => {
      await deploy({ environment: "dev" });
      await expect(service.promote({ projectId }, "agent:run-1")).rejects.toMatchObject({
        code: "forbidden",
      });
      expect(host.workflowRuns.size).toBe(0);
    });

    it("GivenNoCodeHost_WhenPromoted_ThenUnavailableAndNoRequestUsesTheCap", async () => {
      await deploy({ environment: "dev" });
      const offline = new ReleaseService({
        tracker,
        deployments,
        requests,
        codeHost: async () => null,
        queue,
        now: () => clock,
      });
      await expect(offline.promote({ projectId }, OWNER)).rejects.toMatchObject({
        code: "code_host_unavailable",
      });
      expect(await requests.list(projectId)).toEqual([]);
    });
  });

  describe("rollback", () => {
    let older: Deployment;
    beforeEach(async () => {
      older = await deploy({ revision: "shop-00001", imageDigest: digest(1) });
      await deploy({ revision: "shop-00002", imageDigest: digest(2), status: "failed" });
      await deploy({ revision: "shop-00003", imageDigest: digest(3) });
    });

    it("GivenTheDefaultRevision_WhenTheOwnerRollsBack_ThenThePreviousSucceededRevisionIsSent", async () => {
      const { request, summary } = await service.rollback({ projectId }, OWNER);
      expect(onlyRun().inputs).toEqual({
        action: "rollback",
        environment: "prod",
        digest: "",
        revision: "shop-00001",
        request: request.id,
      });
      expect(request).toMatchObject({
        revision: "shop-00001",
        digest: digest(1),
        sourceDeploymentId: older.id,
      });
      expect(summary).toBe("prod will serve revision shop-00001 (commit 1111111) again");
    });

    it("GivenTheServingRevisionNamed_WhenRolledBack_ThenRefused", async () => {
      await expect(
        service.rollback({ projectId, revision: "shop-00003" }, OWNER),
      ).rejects.toMatchObject({ code: "not_releasable" });
    });

    it("GivenAFailedDeploymentsRevision_WhenRolledBack_ThenRefused", async () => {
      await expect(
        service.rollback({ projectId, revision: "shop-00002" }, OWNER),
      ).rejects.toMatchObject({ code: "invalid_field" });
    });

    it("GivenAProdOnlyProject_WhenRolledBackInProd_ThenItIsOffered", async () => {
      await configure({ environments: "prod-only" });
      await service.rollback({ projectId }, OWNER);
      expect(onlyRun().inputs.action).toBe("rollback");
      await expect(
        service.rollback({ projectId, environment: "dev" }, OWNER),
      ).rejects.toMatchObject({ code: "not_releasable" });
    });

    it("GivenOneSucceededRevision_WhenRolledBack_ThenRefusedForNothingEarlier", async () => {
      await deploy({ environment: "dev", revision: "shop-dev-1" });
      await expect(
        service.rollback({ projectId, environment: "dev" }, OWNER),
      ).rejects.toMatchObject({
        code: "not_releasable",
        message: expect.stringContaining("no earlier succeeded revision"),
      });
    });
  });

  describe("caps and dispatch failures", () => {
    beforeEach(async () => {
      await deploy({ revision: "shop-00001" });
      await deploy({ revision: "shop-00002", imageDigest: digest(2) });
    });

    it("GivenARequestUnderAMinuteAgo_WhenAnotherArrives_ThenRateLimitedAndOneRunOnly", async () => {
      await service.rollback({ projectId }, OWNER);
      advance(RELEASE_REQUEST_LIMITS.minGapMs - 1);
      await expect(service.rollback({ projectId }, OWNER)).rejects.toMatchObject({
        code: "rate_limited",
      });
      expect(host.workflowRuns.size).toBe(1);
      advance(1);
      await service.rollback({ projectId }, OWNER);
      expect(host.workflowRuns.size).toBe(2);
    });

    it("GivenTheAppLacksActionsWrite_WhenRolledBack_ThenTheRequestSaysSoAndNothingRuns", async () => {
      host.failDispatch = Object.assign(new Error("Resource not accessible by integration"), {
        status: 403,
      });
      await expect(service.rollback({ projectId }, OWNER)).rejects.toMatchObject({
        code: "dispatch_failed",
        message: expect.stringContaining("needs actions: write"),
      });
      const [stored] = await requests.list(projectId);
      expect(stored).toMatchObject({ status: "dispatch_failed" });
      expect(stored?.error).toContain("ask Andy");
    });

    it("GivenTheRunCannotBeSavedAfterTheDispatch_WhenRolledBack_ThenItSaysTheRunStartedAndQueuesTheCheck", async () => {
      vi.spyOn(requests, "update").mockRejectedValueOnce(new Error("store down"));
      const { request, summary } = await service.rollback({ projectId }, OWNER);
      expect(summary).toContain(
        "release.yml started (https://github.com/albernhagen/shop/actions/runs/1)",
      );
      expect(request.status).toBe("requested");
      expect([...queue.queued.values()]).toMatchObject([
        { kind: "release", requestId: request.id },
      ]);

      advance(RELEASE_CHECK_DELAY_MS);
      expect(await service.check(projectId, request.id)).toBe("unlinked");
      expect((await requests.get(request.id))?.status).toBe("ended_unreported");
    });

    it("GivenNoRunSavedButTheWorkflowReportedItsStart_WhenChecked_ThenItWaitsForTheEnd", async () => {
      vi.spyOn(requests, "update").mockRejectedValueOnce(new Error("store down"));
      const { request } = await service.rollback({ projectId }, OWNER);
      await requests.update(request.id, { status: "started", updatedAt: clock.toISOString() }, [
        "requested",
      ]);
      advance(RELEASE_CHECK_DELAY_MS);
      expect(await service.check(projectId, request.id)).toBe("rescheduled");
      expect((await requests.get(request.id))?.status).toBe("started");
    });

    it("GivenTheAppIsNotInstalled_WhenRolledBack_ThenDispatchFailed", async () => {
      host = new InMemoryCodeHost([]);
      await expect(service.rollback({ projectId }, OWNER)).rejects.toMatchObject({
        code: "dispatch_failed",
      });
    });
  });

  describe("check", () => {
    let request: ReleaseRequest;
    beforeEach(async () => {
      await deploy({ revision: "shop-00001" });
      await deploy({ revision: "shop-00002", imageDigest: digest(2) });
      request = (await service.rollback({ projectId }, OWNER)).request;
      queue.queued.clear();
    });
    const setRun = (
      status: "completed" | "in_progress",
      conclusion: "cancelled" | "failure" | "success" | null,
    ) => {
      const entry = host.workflowRuns.get(request.runId!)!;
      entry.run = { ...entry.run, status, conclusion };
    };

    it("GivenTheRunWasCancelledBeforeAnEnd_WhenChecked_ThenTheRequestIsCancelledWithAReason", async () => {
      setRun("completed", "cancelled");
      advance(RELEASE_CHECK_DELAY_MS);
      expect(await service.check(projectId, request.id)).toBe("cancelled");
      const stored = await requests.get(request.id);
      expect(stored).toMatchObject({ status: "cancelled" });
      expect(stored?.error).toContain("a deploy may have taken its place");
    });

    it("GivenTheRunEndedWithoutAnEndReport_WhenChecked_ThenEndedUnreported", async () => {
      setRun("completed", "failure");
      expect(await service.check(projectId, request.id)).toBe("ended_unreported");
      expect((await requests.get(request.id))?.status).toBe("ended_unreported");
    });

    it("GivenTheRunIsStillGoing_WhenChecked_ThenCheckedAgainLaterUntilTheLimit", async () => {
      setRun("in_progress", null);
      expect(await service.check(projectId, request.id)).toBe("rescheduled");
      expect(queue.queued.size).toBe(1);
      advance(RELEASE_CHECK_MAX_MS);
      expect(await service.check(projectId, request.id)).toBe("gave_up");
      expect((await requests.get(request.id))?.status).toBe("dispatched");
    });

    it("GivenTheRequestAlreadySucceeded_WhenChecked_ThenNothingChanges", async () => {
      await requests.update(request.id, { status: "started", updatedAt: clock.toISOString() }, [
        "dispatched",
      ]);
      await requests.update(request.id, { status: "succeeded", updatedAt: clock.toISOString() }, [
        "started",
      ]);
      setRun("completed", "cancelled");
      expect(await service.check(projectId, request.id)).toBe("final");
      expect((await requests.get(request.id))?.status).toBe("succeeded");
    });

    it("GivenAnotherProjectsRequest_WhenChecked_ThenNotFound", async () => {
      expect(await service.check("other", request.id)).toBe("not_found");
    });
  });
});

describe("releaseRequestMismatch", () => {
  const request: ReleaseRequest = {
    id: "r1",
    projectId: "shop",
    action: "promote",
    environment: "prod",
    digest: digest(1),
    revision: null,
    sourceDeploymentId: "d1",
    actor: OWNER,
    createdAt: "2026-11-26T10:00:00.000Z",
    status: "dispatched",
    runId: "1",
    runUrl: null,
    deploymentId: null,
    error: null,
    updatedAt: "2026-11-26T10:00:00.000Z",
  };
  const report = {
    projectId: "shop",
    kind: "promote" as const,
    environment: "prod" as const,
    imageDigest: digest(1),
  };

  it("GivenTheMatchingReport_WhenMatched_ThenNoMismatch", () => {
    expect(releaseRequestMismatch(request, report)).toBeNull();
    expect(releaseRequestMismatch({ ...request, status: "requested" }, report)).toBeNull();
  });

  it("GivenAnyDifference_WhenMatched_ThenItSaysWhy", () => {
    expect(releaseRequestMismatch(null, report)).toBe("unknown release request");
    expect(releaseRequestMismatch(request, { ...report, projectId: "x" })).toBe(
      "unknown release request",
    );
    expect(releaseRequestMismatch(request, { ...report, kind: "rollback" })).toContain("promote");
    expect(releaseRequestMismatch(request, { ...report, environment: "dev" })).toContain("prod");
    expect(releaseRequestMismatch(request, { ...report, imageDigest: digest(2) })).toContain(
      "another image digest",
    );
    expect(releaseRequestMismatch({ ...request, status: "started" }, report)).toContain("started");
  });
});
