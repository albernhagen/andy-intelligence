import { sign } from "@octokit/webhooks-methods";
import { describe, expect, it } from "vitest";
import {
  WebhookPayloadError,
  isRecordedEvent,
  toCodeHostEvent,
  verifySignature,
  webhookRepo,
  type DeliveryMeta,
} from "./webhook";

const meta = (event: DeliveryMeta["event"]): DeliveryMeta => ({
  event,
  deliveryId: "72d3162e-cc78-11e3-81ab-4c9367dc0958",
  projectId: "ai",
  receivedAt: "2026-11-02T12:00:00.000Z",
});

const repository = { full_name: "albernhagen/andy-intelligence", id: 1, default_branch: "main" };

const pullRequest = (over: Record<string, unknown> = {}) => ({
  action: "opened",
  repository,
  pull_request: {
    number: 31,
    state: "open",
    merged: false,
    draft: false,
    title: "M1.5: GitHub App",
    body: "https://ai.andybernhagen.com/p/ai/t/AI-14\r\n\nThe rest is not stored.",
    head: { ref: "m1.5/github-app", sha: "abc123", repo: { full_name: repository.full_name } },
    base: { ref: "main" },
    html_url: "https://github.com/albernhagen/andy-intelligence/pull/31",
    ...over,
  },
});

describe("verifySignature", () => {
  const body = JSON.stringify({ zen: "Keep it logically awesome." });

  it("GivenABodySignedWithTheSecret_WhenVerified_ThenTrue", async () => {
    expect(await verifySignature("s3cret", body, await sign("s3cret", body))).toBe(true);
  });

  it("GivenADifferentSecret_WhenVerified_ThenFalse", async () => {
    expect(await verifySignature("s3cret", body, await sign("other", body))).toBe(false);
  });

  it("GivenATamperedBody_WhenVerified_ThenFalse", async () => {
    expect(await verifySignature("s3cret", body + " ", await sign("s3cret", body))).toBe(false);
  });

  it("GivenAMissingOrMalformedHeader_WhenVerified_ThenFalse", async () => {
    expect(await verifySignature("s3cret", body, undefined)).toBe(false);
    expect(await verifySignature("s3cret", body, "sha1=abc")).toBe(false);
    expect(await verifySignature("s3cret", body, "sha256=nothex")).toBe(false);
  });
});

describe("toCodeHostEvent", () => {
  it("GivenAnOpenedPullRequest_WhenMapped_ThenOnlyTheKeptFieldsAreRecorded", () => {
    const event = toCodeHostEvent(meta("pull_request"), pullRequest());
    expect(event).toEqual({
      kind: "pull_request",
      deliveryId: "72d3162e-cc78-11e3-81ab-4c9367dc0958",
      projectId: "ai",
      repo: "albernhagen/andy-intelligence",
      action: "opened",
      receivedAt: "2026-11-02T12:00:00.000Z",
      pullRequest: {
        number: 31,
        state: "open",
        draft: false,
        title: "M1.5: GitHub App",
        bodyFirstLine: "https://ai.andybernhagen.com/p/ai/t/AI-14",
        fromFork: false,
        intoDefaultBranch: true,
        headRef: "m1.5/github-app",
        headSha: "abc123",
        baseRef: "main",
        url: "https://github.com/albernhagen/andy-intelligence/pull/31",
      },
    });
  });

  it("GivenAClosedAndMergedPullRequest_WhenMapped_ThenStateIsMerged", () => {
    const payload = { ...pullRequest({ state: "closed", merged: true }), action: "closed" };
    const event = toCodeHostEvent(meta("pull_request"), payload);
    expect(event.kind === "pull_request" && event.pullRequest.state).toBe("merged");
  });

  it("GivenAClosedUnmergedPullRequest_WhenMapped_ThenStateIsClosed", () => {
    const event = toCodeHostEvent(meta("pull_request"), pullRequest({ state: "closed" }));
    expect(event.kind === "pull_request" && event.pullRequest.state).toBe("closed");
  });

  it("GivenAVeryLongTitle_WhenMapped_ThenItIsCapped", () => {
    const event = toCodeHostEvent(meta("pull_request"), pullRequest({ title: "x".repeat(5000) }));
    expect(event.kind === "pull_request" && event.pullRequest.title.length).toBe(256);
  });

  it("GivenAPullRequestFromAForkOrADeletedFork_WhenMapped_ThenFromFork", () => {
    for (const repo of [{ full_name: "stranger/andy-intelligence" }, null]) {
      const head = { ref: "AI-1", sha: "abc123", repo };
      const event = toCodeHostEvent(meta("pull_request"), pullRequest({ head }));
      expect(event.kind === "pull_request" && event.pullRequest.fromFork).toBe(true);
    }
  });

  it("GivenAPullRequestIntoAnotherBranch_WhenMapped_ThenNotIntoTheDefaultBranch", () => {
    const event = toCodeHostEvent(meta("pull_request"), pullRequest({ base: { ref: "feature" } }));
    expect(event.kind === "pull_request" && event.pullRequest.intoDefaultBranch).toBe(false);
  });

  it("GivenANullOrVeryLongBody_WhenMapped_ThenTheFirstLineIsEmptyOrCapped", () => {
    const none = toCodeHostEvent(meta("pull_request"), pullRequest({ body: null }));
    expect(none.kind === "pull_request" && none.pullRequest.bodyFirstLine).toBe("");
    const long = toCodeHostEvent(meta("pull_request"), pullRequest({ body: "y".repeat(5000) }));
    expect(long.kind === "pull_request" && long.pullRequest.bodyFirstLine.length).toBe(256);
  });

  it("GivenACompletedCheckRunWithAnUnknownConclusion_WhenMapped_ThenConclusionIsOther", () => {
    const event = toCodeHostEvent(meta("check_run"), {
      action: "completed",
      repository,
      check_run: {
        id: 99,
        name: "check",
        status: "completed",
        conclusion: "something_new",
        head_sha: "abc123",
        html_url: "https://github.com/albernhagen/andy-intelligence/runs/99",
        pull_requests: [{ number: 31 }],
      },
    });
    expect(event).toMatchObject({
      kind: "check_run",
      checkRun: {
        id: "99",
        status: "completed",
        conclusion: "other",
        pullRequestNumbers: [31],
      },
    });
  });

  it("GivenAWaitingCheckRun_WhenMapped_ThenStatusIsQueued", () => {
    const event = toCodeHostEvent(meta("check_run"), {
      action: "created",
      repository,
      check_run: {
        id: 1,
        name: "c",
        status: "waiting",
        conclusion: null,
        head_sha: "a",
        html_url: "https://github.com/x/y/runs/1",
      },
    });
    expect(event).toMatchObject({ checkRun: { status: "queued", conclusion: null } });
  });

  it("GivenACompletedWorkflowRun_WhenMapped_ThenItIsRecorded", () => {
    const event = toCodeHostEvent(meta("workflow_run"), {
      action: "completed",
      repository,
      workflow_run: {
        id: 123456789,
        name: "CI",
        event: "pull_request",
        status: "completed",
        conclusion: "failure",
        head_branch: "m1.5/github-app",
        head_sha: "abc123",
        html_url: "https://github.com/albernhagen/andy-intelligence/actions/runs/123456789",
      },
    });
    expect(event).toMatchObject({
      kind: "workflow_run",
      workflowRun: { id: "123456789", trigger: "pull_request", conclusion: "failure" },
    });
  });

  it("GivenAPayloadWithoutARepository_WhenMapped_ThenItThrows", () => {
    const { pull_request } = pullRequest();
    expect(() => toCodeHostEvent(meta("pull_request"), { action: "opened", pull_request })).toThrow(
      WebhookPayloadError,
    );
  });

  it("GivenAPayloadOfTheWrongShape_WhenMapped_ThenItThrows", () => {
    expect(() => toCodeHostEvent(meta("check_run"), pullRequest())).toThrow(WebhookPayloadError);
  });
});

describe("helpers", () => {
  it("GivenEventNames_WhenChecked_ThenOnlyRecordedOnesMatch", () => {
    expect(isRecordedEvent("pull_request")).toBe(true);
    expect(isRecordedEvent("push")).toBe(false);
  });

  it("GivenPayloads_WhenAskedForTheRepo_ThenFullNameOrNull", () => {
    expect(webhookRepo({ repository })).toBe("albernhagen/andy-intelligence");
    expect(webhookRepo({})).toBeNull();
  });
});
