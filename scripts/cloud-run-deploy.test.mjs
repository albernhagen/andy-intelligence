import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertLatest,
  assertPromoted,
  candidateChecks,
  deployVerdict,
  keepTag,
  parseSmokeChecks,
  publicChecks,
  readCandidate,
  renderSummary,
  rollbackCommand,
  runChecks,
  servingRevisions,
  smokeChecks,
} from "./cloud-run-deploy.mjs";

const OK = {
  inputs: "success",
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

/** The `key: |` block literal under the step that uses `action`, as the action receives it. */
function blockInput(workflow, action, key) {
  const step = workflow.slice(workflow.indexOf(`uses: ${action}`));
  const match = new RegExp(`\\n(\\s+)${key}: \\|\\n((?:\\1  .*\\n)+)`).exec(step);
  if (!match) throw new Error(`no ${key} block`);
  return match[2].replace(new RegExp(`^${match[1]}  `, "gm"), "");
}

describe("smoke check inputs", () => {
  it.each([
    ["/health 200", [{ path: "/health", status: 200 }]],
    ["/ 200,301", [{ path: "/", status: [200, 301] }]],
    ["# comment\n\n  /a 204  # trailing\n", [{ path: "/a", status: 204 }]],
  ])("GivenInput_%j_WhenParsed_ThenChecks", (text, expected) => {
    expect(parseSmokeChecks(text, "smoke-checks")).toEqual(expected);
  });

  it.each(["health 200", "/health", "/health ok", "/health 200,", "/health 999", "/a b 200"])(
    "GivenMalformedLine_%j_WhenParsed_ThenThrowsNamingTheInput",
    (text) => {
      expect(() => parseSmokeChecks(text, "smoke-checks")).toThrow("smoke-checks:");
    },
  );

  it("GivenNoPublicHostChecks_WhenSmokeChecks_ThenThrows", () => {
    expect(() => smokeChecks({ publicHost: "# none\n", otherHosts: "/ 200" })).toThrow(
      "at least one",
    );
  });

  it("GivenNoOtherHostChecks_WhenSmokeChecks_ThenOtherHostsMatchPublic", () => {
    const checks = smokeChecks({ publicHost: "/ 200", otherHosts: "" });
    expect(checks.otherHosts).toEqual(checks.publicHost);
  });

  it("GivenAppWithoutHostGuard_WhenCustomDomain_ThenEveryHostGetsTheSameChecks", () => {
    const checks = smokeChecks({ publicHost: "/ 200", otherHosts: "" });
    expect(candidateChecks({ taggedUrl: "https://t", publicUrl: "https://d" }, checks)).toEqual([
      { url: "https://t/", status: 200 },
    ]);
    expect(publicChecks({ publicUrl: "https://d", runUrl: "https://r" }, checks)).toEqual([
      { url: "https://d/", status: 200 },
      { url: "https://r/", status: 200 },
    ]);
  });
});

// AI-206: M6.17 moved these checks out of the script into the control plane's workflows. The lists
// below are what the script hard-coded before; the workflows' inputs must still produce them.
describe.each([".github/workflows/deploy.yml", ".github/workflows/release.yml"])(
  "the control plane's smoke checks in %s",
  (file) => {
    const workflow = readFileSync(file, "utf8");
    const action = "./platform/actions/cloud-run-safe-deploy";
    const checks = smokeChecks({
      publicHost: blockInput(workflow, action, "smoke-checks"),
      otherHosts: blockInput(workflow, action, "smoke-checks-other-hosts"),
    });

    it("GivenPublicUrlSet_WhenCandidateChecks_ThenApiMeIsRefusedByHostGuard", () => {
      expect(candidateChecks({ taggedUrl: "https://t", publicUrl: "https://ai" }, checks)).toEqual([
        { url: "https://t/health", status: 200 },
        { url: "https://t/api/me", status: 404 },
      ]);
    });

    it("GivenNoPublicUrl_WhenCandidateChecks_ThenApiMeReachesAuth", () => {
      expect(candidateChecks({ taggedUrl: "https://t", publicUrl: "" }, checks)).toEqual([
        { url: "https://t/health", status: 200 },
        { url: "https://t/api/me", status: 401 },
      ]);
    });

    it("GivenCustomDomain_WhenPublicChecks_ThenChecksBothHosts", () => {
      expect(publicChecks({ publicUrl: "https://ai", runUrl: "https://r" }, checks)).toEqual([
        { url: "https://ai/health", status: 200 },
        { url: "https://ai/api/me", status: 401 },
        { url: "https://r/health", status: 200 },
        { url: "https://r/api/me", status: 404 },
      ]);
    });

    it("GivenNoCustomDomain_WhenPublicChecks_ThenChecksRunUrlOnce", () => {
      expect(publicChecks({ publicUrl: "", runUrl: "https://r" }, checks)).toEqual([
        { url: "https://r/health", status: 200 },
        { url: "https://r/api/me", status: 401 },
      ]);
    });
  },
);

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

  it("GivenAcceptedStatusList_WhenOneMatches_ThenPasses", async () => {
    const fetchImpl = async () => ({ status: 301 });
    const list = [{ url: "https://t/", status: [200, 301] }];
    await expect(runChecks(list, { ...quiet, fetchImpl, attempts: 1 })).resolves.toBeUndefined();
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

describe("keepTag (AI-389: M6.23)", () => {
  const HEX = "a".repeat(64);
  const REPO = "us-central1-docker.pkg.dev/app-dev/app/app";

  it("GivenAnImageByDigest_WhenKeepTag_ThenTagsThatDigestWithPrefixAndHex", () => {
    expect(keepTag({ image: `${REPO}@sha256:${HEX}`, prefix: "release-" })).toEqual({
      source: `${REPO}@sha256:${HEX}`,
      target: `${REPO}:release-${HEX}`,
    });
  });

  it("GivenTheSameDigestTwice_WhenKeepTag_ThenTheTagIsTheSame", () => {
    const image = `${REPO}@sha256:${HEX}`;
    expect(keepTag({ image, prefix: "release-" })).toEqual(keepTag({ image, prefix: "release-" }));
  });

  it("GivenARegistryWithAPort_WhenKeepTag_ThenKeepsThePortInTheName", () => {
    const { target } = keepTag({ image: `localhost:5000/app@sha256:${HEX}`, prefix: "release-" });
    expect(target).toBe(`localhost:5000/app:release-${HEX}`);
  });

  it.each([
    [`${REPO}:abc123`, "by digest"],
    [`${REPO}:abc123@sha256:${HEX}`, "both a tag and a digest"],
    [`${REPO}@sha256:short`, "by digest"],
    ["", "by digest"],
  ])("GivenImage %s_WhenKeepTag_ThenThrows", (image, message) => {
    expect(() => keepTag({ image, prefix: "release-" })).toThrow(message);
  });

  it.each(["", "Release-", "release prod", "-release"])(
    "GivenPrefix '%s'_WhenKeepTag_ThenThrows",
    (prefix) => {
      expect(() => keepTag({ image: `${REPO}@sha256:${HEX}`, prefix })).toThrow("keep-tag-prefix");
    },
  );
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

  it("GivenTheKeepTagFails_WhenRendered_ThenSaysTrafficDidNotMove", () => {
    const outcomes = { ...OK, keepTag: "failure", promote: "skipped", verify: "skipped" };
    const text = renderSummary({ ...args, after: "old=100", outcomes });
    expect(text).toContain("Could not tag the image");
    expect(text).toContain("**Traffic did not move.**");
  });

  it("GivenTheKeepTagSucceeds_WhenRendered_ThenNamesTheTag", () => {
    const keep = "repo/app:release-abc";
    const text = renderSummary({
      ...args,
      after: "new=100",
      keepTag: keep,
      outcomes: { ...OK, keepTag: "success" },
    });
    expect(text).toContain(`tagged \`${keep}\``);
  });

  it("GivenNoKeepTag_WhenRendered_ThenSaysNothingAboutCleanup", () => {
    const text = renderSummary({ ...args, after: "new=100", outcomes: OK });
    expect(text).not.toContain("Registry cleanup");
  });

  it("GivenSplitTrafficBefore_WhenRollbackCommand_ThenRestoresTheSplit", () => {
    expect(rollbackCommand({ service: "s", region: "r", serving: "a=90,b=10" })).toContain(
      "--to-revisions=a=90,b=10",
    );
  });

  it("GivenTagRemovalFails_WhenRendered_ThenWarnsWithTheCommand", () => {
    const outcomes = { ...SKIPPED_AFTER_SMOKE, untag: "failure" };
    const text = renderSummary({ ...args, after: "old=100", outcomes });
    expect(text).toContain("**Warning:**");
    expect(text).toContain("--remove-tags=candidate");
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
    ["inputs", "are missing or malformed"],
    ["keepTag", "Could not tag the image"],
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

describe("the script reading gcloud's output from stdin", () => {
  const script = fileURLToPath(new URL("./cloud-run-deploy.mjs", import.meta.url));
  const promoted = service([{ revisionName: "new", percent: 100 }]);

  // Runs the real script. Its stdin stays open and empty for 200 ms, then the input arrives in
  // two parts split inside a token, as a slow gcloud would send it. GITHUB_OUTPUT is cleared so a
  // CI run of this test cannot write to the job's real outputs.
  async function runScript(args, input) {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, GITHUB_OUTPUT: "" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const closed = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve(code));
    });
    await sleep(200);
    const middle = Math.floor(input.length / 2);
    child.stdin.write(input.slice(0, middle));
    await sleep(50);
    child.stdin.end(input.slice(middle));
    return { code: await closed, stdout, stderr };
  }

  it.each([
    ["serving", [], promoted, "serving=new=100\n"],
    ["after", [], promoted, "serving=new=100\n"],
    ["candidate", [], service(afterDeploy), "revision=new\n"],
    ["assert-latest", ["new"], service(afterDeploy), ""],
    ["assert-promoted", ["new"], promoted, ""],
  ])("GivenLateStdin_When_%s_ThenParsesAllOfIt", async (command, args, json, expected) => {
    const { code, stdout, stderr } = await runScript([command, ...args], JSON.stringify(json));
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain(expected);
  });

  it("GivenLateStdinAndAFailedAssertion_WhenAssertPromoted_ThenExitsNonZero", async () => {
    const input = JSON.stringify(service(afterDeploy));
    const { code, stderr } = await runScript(["assert-promoted", "new"], input);
    expect(code).toBe(1);
    expect(stderr).toContain("serving old=100");
  });

  it.each([
    ["", "::error::serving: expected the service JSON on stdin, got nothing"],
    ['{"private-value', "::error::serving: expected the service JSON on stdin, got 15 unparsable"],
  ])("GivenBadStdin_%j_WhenServing_ThenExitsNonZeroNamingTheCommand", async (input, message) => {
    const { code, stderr } = await runScript(["serving"], input);
    expect(code).toBe(1);
    expect(stderr).toContain(message);
    expect(stderr).not.toContain("private-value");
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
      "check-smoke-inputs",
      "id: before",
      'no_traffic: "true"',
      "smoke-candidate",
      "gcloud artifacts docker tags add",
      "update-traffic",
      "smoke-public",
    ].map((text) => action.indexOf(text));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("GivenNoKeepTagPrefix_WhenRead_ThenTheTagStepIsSkipped", () => {
    const step = action.slice(action.indexOf("id: keep-tag"), action.indexOf("Move traffic"));
    expect(step).toContain("if: inputs.keep-tag-prefix != ''");
    expect(action).toContain("OUTCOME_KEEP_TAG: ${{ steps.keep-tag.outcome }}");
  });
});
