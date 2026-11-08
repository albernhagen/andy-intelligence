import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertLatest,
  assertPromoted,
  candidateChecks,
  deployVerdict,
  publicChecks,
  readCandidate,
  renderSummary,
  rollbackCommand,
  runChecks,
  servingRevisions,
} from "./cloud-run-deploy.mjs";

const OK = {
  before: "success",
  deploy: "success",
  candidate: "success",
  smoke: "success",
  promote: "success",
  verify: "success",
  publicSmoke: "success",
};
const SKIPPED_AFTER_SMOKE = {
  ...OK,
  smoke: "failure",
  promote: "skipped",
  verify: "skipped",
  publicSmoke: "skipped",
};

const service = (traffic, latest = "new") => ({
  status: { traffic, latestReadyRevisionName: latest, url: "https://svc.run.app" },
  spec: {
    template: {
      spec: { containers: [{ env: [{ name: "PUBLIC_URL", value: "https://ai.example.com/" }] }] },
    },
  },
});
const afterDeploy = [
  { revisionName: "old", percent: 100 },
  { revisionName: "new", tag: "candidate", url: "https://candidate---svc.run.app" },
];

describe("servingRevisions", () => {
  it("GivenSplitTrafficAndZeroPercentTag_WhenRead_ThenListsOnlyServingRevisions", () => {
    expect(
      servingRevisions(
        service([
          { revisionName: "a", percent: 90 },
          { revisionName: "b", percent: 10 },
          { revisionName: "c", tag: "candidate" },
        ]),
      ),
    ).toBe("a=90,b=10");
  });

  it("GivenNoTraffic_WhenRead_ThenEmpty", () => {
    expect(servingRevisions({})).toBe("");
  });
});

describe("readCandidate", () => {
  it("GivenTaggedNoTrafficRevision_WhenRead_ThenReturnsItsNameAndUrls", () => {
    expect(readCandidate(service(afterDeploy))).toEqual({
      revision: "new",
      tagged_url: "https://candidate---svc.run.app",
      public_url: "https://ai.example.com",
      run_url: "https://svc.run.app",
    });
  });

  it("GivenNoCandidateTag_WhenRead_ThenThrows", () => {
    expect(() => readCandidate(service([{ revisionName: "old", percent: 100 }]))).toThrow(
      "no candidate-tagged",
    );
  });

  it("GivenCandidateHoldsPartOfTraffic_WhenRead_ThenThrows", () => {
    expect(() =>
      readCandidate(
        service([
          { revisionName: "old", percent: 50 },
          { revisionName: "new", percent: 50 },
          { revisionName: "new", tag: "candidate", url: "https://c" },
        ]),
      ),
    ).toThrow("already has 50%");
  });

  it("GivenANewerRevisionThanTheTag_WhenRead_ThenThrows", () => {
    expect(() => readCandidate(service(afterDeploy, "other"))).toThrow("latest ready revision");
  });
});

describe("assertions before and after promotion", () => {
  it("GivenLatestIsAnotherRevision_WhenAssertLatest_ThenThrows", () => {
    expect(() => assertLatest(service([], "tf"), "new")).toThrow("tf");
  });

  it("GivenCandidateServesAll_WhenAssertPromoted_ThenPasses", () => {
    expect(() =>
      assertPromoted(service([{ revisionName: "new", percent: 100 }]), "new"),
    ).not.toThrow();
  });

  it("GivenLatestEntryAfterToLatest_WhenAssertPromoted_ThenPasses", () => {
    const traffic = [{ revisionName: "new", percent: 100, latestRevision: true }];
    expect(() => assertPromoted(service(traffic), "new")).not.toThrow();
  });

  it("GivenTrafficStillOnOld_WhenAssertPromoted_ThenThrows", () => {
    expect(() => assertPromoted(service(afterDeploy), "new")).toThrow("serving old=100");
  });
});

describe("smoke check lists", () => {
  it("GivenPublicUrlSet_WhenCandidateChecks_ThenApiMeIsRefusedByHostGuard", () => {
    expect(candidateChecks({ taggedUrl: "https://t", publicUrl: "https://ai" })).toEqual([
      { url: "https://t/health", status: 200 },
      { url: "https://t/api/me", status: 404 },
    ]);
  });

  it("GivenNoPublicUrl_WhenCandidateChecks_ThenApiMeReachesAuth", () => {
    expect(candidateChecks({ taggedUrl: "https://t", publicUrl: "" })[1].status).toBe(401);
  });

  it("GivenCustomDomain_WhenPublicChecks_ThenChecksBothHosts", () => {
    expect(publicChecks({ publicUrl: "https://ai", runUrl: "https://r" })).toEqual([
      { url: "https://ai/health", status: 200 },
      { url: "https://ai/api/me", status: 401 },
      { url: "https://r/health", status: 200 },
      { url: "https://r/api/me", status: 404 },
    ]);
  });

  it("GivenNoCustomDomain_WhenPublicChecks_ThenChecksRunUrlOnce", () => {
    expect(publicChecks({ publicUrl: "", runUrl: "https://r" })).toHaveLength(2);
  });
});

describe("runChecks", () => {
  const quiet = { delayMs: 0, log: () => {} };
  const checks = [{ url: "https://t/health", status: 200 }];

  it("GivenColdStartThenHealthy_WhenRun_ThenRetriesAndPasses", async () => {
    const replies = [503, 200];
    let calls = 0;
    const fetchImpl = async () => ({ status: replies[calls++] });
    await runChecks(checks, { ...quiet, fetchImpl, attempts: 3 });
    expect(calls).toBe(2);
  });

  it("GivenNetworkErrorThenHealthy_WhenRun_ThenPasses", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      if (calls++ === 0) throw new Error("ECONNRESET");
      return { status: 200 };
    };
    await expect(runChecks(checks, { ...quiet, fetchImpl, attempts: 2 })).resolves.toBeUndefined();
  });

  it("GivenWrongStatusEveryTime_WhenRun_ThenStopsAtTheCapAndThrows", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return { status: 500 };
    };
    await expect(runChecks(checks, { ...quiet, fetchImpl, attempts: 3 })).rejects.toThrow(
      "expected 200, got HTTP 500 (attempt 3/3)",
    );
    expect(calls).toBe(3);
  });
});

describe("job summary", () => {
  const args = { service: "svc", region: "us-central1", before: "old=100", candidate: "new" };

  it("GivenAFullSuccess_WhenRendered_ThenRecordsBothRevisionsAndRollback", () => {
    const text = renderSummary({ ...args, after: "new=100", outcomes: OK });
    expect(text).toContain("Deployed.");
    expect(text).toContain("| Serving before | `old=100` |");
    expect(text).toContain("| Serving after | `new=100` |");
    expect(text).toContain(
      "gcloud run services update-traffic svc --region us-central1 --to-revisions=old=100",
    );
  });

  it("GivenCandidateSmokeFails_WhenRendered_ThenSaysTrafficDidNotMoveAndNamesCandidate", () => {
    const text = renderSummary({ ...args, after: "old=100", outcomes: SKIPPED_AFTER_SMOKE });
    expect(text).toContain("**Traffic did not move**");
    expect(text).toContain("| Candidate | `new` |");
    expect(text).toContain("--to-revisions=old=100");
  });

  it("GivenSplitTrafficBefore_WhenRollbackCommand_ThenRestoresTheSplit", () => {
    expect(rollbackCommand({ service: "s", region: "r", serving: "a=90,b=10" })).toContain(
      "--to-revisions=a=90,b=10",
    );
  });

  it("GivenBeforeUnknown_WhenRendered_ThenOmitsTheRollbackCommand", () => {
    const text = renderSummary({
      ...args,
      before: "",
      candidate: "",
      after: "",
      outcomes: { ...OK, before: "failure" },
    });
    expect(text).toContain("Nothing was deployed");
    expect(text).not.toContain("update-traffic");
  });

  it.each([
    ["deploy", "Traffic did not move"],
    ["candidate", "Traffic did not move"],
    ["smoke", "Traffic did not move"],
    ["promote", "Traffic may have moved"],
    ["verify", "run the command below now"],
    ["publicSmoke", "run the command below now"],
  ])("GivenStepFails_%s_WhenVerdict_ThenSays_%s", (step, expected) => {
    expect(deployVerdict({ ...OK, [step]: "failure" })).toContain(expected);
  });
});

describe("cloud-run-safe-deploy action", () => {
  const action = readFileSync("platform/actions/cloud-run-safe-deploy/action.yml", "utf8");

  it("GivenPromotionDidNotSucceed_WhenRead_ThenTagRemovalRunsBeforeTheSummary", () => {
    const step = action.indexOf("Remove the candidate tag after a failed deploy");
    expect(step).toBeGreaterThan(action.indexOf("smoke-public"));
    expect(action.indexOf("Write the job summary")).toBeGreaterThan(step);
    expect(action).toContain("steps.promote.outcome != 'success'");
  });

  it("GivenTheAction_WhenRead_ThenNoTrafficDeployPrecedesSmokeTestPrecedesPromotion", () => {
    const order = [
      "id: before",
      'no_traffic: "true"',
      "smoke-candidate",
      "update-traffic",
      "smoke-public",
    ].map((text) => action.indexOf(text));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
