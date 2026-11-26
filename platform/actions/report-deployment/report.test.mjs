import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// AI-180: M6.4. The report step must never fail a deploy: every path exits 0, and a report that
// didn't land says so in the job summary. Runs report.sh against a stub OIDC issuer and control
// plane on localhost.

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "report.sh");
const DIGEST = `sha256:${"b".repeat(64)}`;

let server;
afterEach(() => server?.close());

/** A stub that answers the OIDC token request and the report with `answer(path)`. */
async function stub(answer) {
  const requests = [];
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://stub");
      if (url.pathname === "/oidc") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ value: "oidc-token" }));
        return;
      }
      requests.push({ path: url.pathname, body, auth: req.headers.authorization });
      const { status, text } = answer(url.pathname);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(text);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests };
}

/** Runs report.sh with `env`; returns its exit code, the summary and the step outputs. */
function report(env) {
  const dir = mkdtempSync(join(tmpdir(), "report-deployment-"));
  const summary = join(dir, "summary.md");
  const output = join(dir, "output");
  writeFileSync(summary, "");
  writeFileSync(output, "");
  return new Promise((resolve) => {
    const child = spawn("bash", [SCRIPT], {
      env: {
        PATH: process.env.PATH,
        GITHUB_STEP_SUMMARY: summary,
        GITHUB_OUTPUT: output,
        RUNNER_TEMP: dir,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.on("close", (code) =>
      resolve({
        code,
        summary: readFileSync(summary, "utf8"),
        output: readFileSync(output, "utf8"),
      }),
    );
  });
}

const withOidc = (origin) => ({
  ACTIONS_ID_TOKEN_REQUEST_URL: `${origin}/oidc?x=1`,
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-token",
  CONTROL_PLANE_URL: origin,
});

describe("report-deployment", () => {
  it("GivenTheControlPlaneRecordsTheStart_WhenReported_ThenTheIdIsAnOutputAndTheSummarySaysSo", async () => {
    const cp = await stub(() => ({
      status: 201,
      text: JSON.stringify({ deploymentId: "abc-123" }),
    }));
    const r = await report({ ...withOidc(cp.origin), PHASE: "start", IMAGE_DIGEST: DIGEST });
    expect(r.code).toBe(0);
    expect(r.output).toContain("deployment_id=abc-123");
    expect(r.summary).toContain("Deployment abc-123 recorded as started");
    expect(cp.requests).toEqual([
      {
        path: "/deployments",
        body: JSON.stringify({ imageDigest: DIGEST }),
        auth: "Bearer oidc-token",
      },
    ]);
  });

  it("GivenNoOidcToken_WhenReported_ThenExit0AndTheSummarySaysNotRecorded", async () => {
    const r = await report({
      PHASE: "start",
      IMAGE_DIGEST: DIGEST,
      CONTROL_PLANE_URL: "http://127.0.0.1:9",
    });
    expect(r.code).toBe(0);
    expect(r.summary).toContain(
      "Deployment not recorded in the control plane (start): no OIDC token",
    );
  });

  it("GivenNoInputsAtAll_WhenReported_ThenExit0AndNotRecorded", async () => {
    const r = await report({});
    expect(r.code).toBe(0);
    expect(r.summary).toContain("Deployment not recorded");
  });

  it("GivenAMissingDigest_WhenStarted_ThenExit0AndNoRequestIsSent", async () => {
    const cp = await stub(() => ({ status: 201, text: "{}" }));
    const r = await report({ ...withOidc(cp.origin), PHASE: "start", IMAGE_DIGEST: "" });
    expect(r.code).toBe(0);
    expect(r.summary).toContain("no image digest");
    expect(cp.requests).toEqual([]);
  });

  it("GivenTheControlPlaneAnswers500_WhenStarted_ThenExit0NotRecordedAndNoRetry", async () => {
    const cp = await stub(() => ({ status: 500, text: "{}" }));
    const r = await report({ ...withOidc(cp.origin), PHASE: "start", IMAGE_DIGEST: DIGEST });
    expect(r.code).toBe(0);
    expect(r.summary).toContain("answered HTTP 500");
    expect(r.output).toBe("");
    // A start isn't idempotent: one attempt only.
    expect(cp.requests).toHaveLength(1);
  });

  it("GivenAnUnparsableAnswer_WhenStarted_ThenExit0AndNotRecorded", async () => {
    const cp = await stub(() => ({ status: 201, text: "not json" }));
    const r = await report({ ...withOidc(cp.origin), PHASE: "start", IMAGE_DIGEST: DIGEST });
    expect(r.code).toBe(0);
    expect(r.summary).toContain("no deployment id in the answer");
    expect(r.output).toBe("");
  });

  it("GivenNoStartId_WhenFinished_ThenExit0AndNoRequestIsSent", async () => {
    const cp = await stub(() => ({ status: 200, text: "{}" }));
    const r = await report({ ...withOidc(cp.origin), PHASE: "finish", STATUS: "succeeded" });
    expect(r.code).toBe(0);
    expect(r.summary).toContain("the start report returned no deployment id");
    expect(cp.requests).toEqual([]);
  });

  it("GivenAFailedDeploy_WhenFinished_ThenNoRevisionIsSent", async () => {
    const cp = await stub(() => ({ status: 200, text: "{}" }));
    const r = await report({
      ...withOidc(cp.origin),
      PHASE: "finish",
      DEPLOYMENT_ID: "abc-123",
      STATUS: "failed",
      SERVICE: "control-plane",
      REGION: "us-central1",
    });
    expect(r.code).toBe(0);
    expect(cp.requests).toEqual([
      {
        path: "/deployments/abc-123/finish",
        body: JSON.stringify({ status: "failed" }),
        auth: "Bearer oidc-token",
      },
    ]);
    expect(r.summary).toContain("Deployment abc-123 recorded as failed");
  });

  it("GivenAFinishThatAlreadyLanded_WhenTheControlPlaneAnswers409_ThenItCountsAsRecorded", async () => {
    const cp = await stub(() => ({ status: 409, text: "{}" }));
    const r = await report({
      ...withOidc(cp.origin),
      PHASE: "finish",
      DEPLOYMENT_ID: "abc-123",
      STATUS: "succeeded",
    });
    expect(r.code).toBe(0);
    expect(r.summary).toContain("Deployment abc-123 recorded as succeeded");
    expect(r.summary).not.toContain("not recorded");
  });

  it("GivenAReleaseStart_WhenReported_ThenEnvironmentKindUrlAndRequestAreSent", async () => {
    const cp = await stub(() => ({ status: 201, text: JSON.stringify({ deploymentId: "r-1" }) }));
    const r = await report({
      ...withOidc(cp.origin),
      PHASE: "start",
      IMAGE_DIGEST: DIGEST,
      ENVIRONMENT: "prod",
      KIND: "rollback",
      URL: "https://ai.example.com",
      REQUEST: "req-1",
    });
    expect(r.code).toBe(0);
    expect(r.output).toContain("deployment_id=r-1");
    expect(JSON.parse(cp.requests[0].body)).toEqual({
      imageDigest: DIGEST,
      environment: "prod",
      kind: "rollback",
      url: "https://ai.example.com",
      request: "req-1",
    });
  });

  it("GivenABadOptionalStartField_WhenReported_ThenExit0AndNoRequestIsSent", async () => {
    const cp = await stub(() => ({ status: 201, text: "{}" }));
    for (const extra of [
      { ENVIRONMENT: "preview" },
      { KIND: "redeploy" },
      { URL: "http://ai.example.com" },
      { URL: "https://user@ai.example.com" },
      { REQUEST: "a b" },
    ]) {
      const r = await report({
        ...withOidc(cp.origin),
        PHASE: "start",
        IMAGE_DIGEST: DIGEST,
        ...extra,
      });
      expect(r.code, JSON.stringify(extra)).toBe(0);
      expect(r.summary, JSON.stringify(extra)).toContain("Deployment not recorded");
    }
    expect(cp.requests).toEqual([]);
  });

  it("GivenARollbackThatNamesItsRevision_WhenFinished_ThenThatRevisionIsSent", async () => {
    const cp = await stub(() => ({ status: 200, text: "{}" }));
    const r = await report({
      ...withOidc(cp.origin),
      PHASE: "finish",
      DEPLOYMENT_ID: "r-1",
      STATUS: "succeeded",
      REVISION: "control-plane-00041-old",
      // The named revision wins: the service is not described.
      SERVICE: "control-plane",
      REGION: "us-central1",
    });
    expect(r.code).toBe(0);
    expect(cp.requests[0].body).toBe(
      JSON.stringify({ status: "succeeded", revision: "control-plane-00041-old" }),
    );
  });

  it("GivenAMalformedRevision_WhenFinished_ThenTheStatusLandsWithoutIt", async () => {
    const cp = await stub(() => ({ status: 200, text: "{}" }));
    const r = await report({
      ...withOidc(cp.origin),
      PHASE: "finish",
      DEPLOYMENT_ID: "r-1",
      STATUS: "succeeded",
      REVISION: "Bad Revision; rm",
    });
    expect(r.code).toBe(0);
    expect(cp.requests[0].body).toBe(JSON.stringify({ status: "succeeded" }));
  });

  it("GivenARefusedStart_WhenTheControlPlaneAnswers422_ThenRefusedIsAnOutputAndExit0", async () => {
    const cp = await stub(() => ({ status: 422, text: "{}" }));
    const r = await report({ ...withOidc(cp.origin), PHASE: "start", IMAGE_DIGEST: DIGEST });
    expect(r.code).toBe(0);
    expect(r.output).toBe("refused=true\n");
    expect(r.summary).toContain("refused it (HTTP 422)");
  });

  it("GivenAnUnreachableControlPlane_WhenStarted_ThenItIsNotMarkedRefused", async () => {
    const r = await report({
      ACTIONS_ID_TOKEN_REQUEST_URL: "http://127.0.0.1:9/oidc?x=1",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "t",
      CONTROL_PLANE_URL: "http://127.0.0.1:9",
      PHASE: "start",
      IMAGE_DIGEST: DIGEST,
    });
    expect(r.code).toBe(0);
    expect(r.output).toBe("");
  });

  it("GivenTrafficMovedButACheckFailed_WhenFinishedAsFailedWithARevision_ThenTheRevisionIsSent", async () => {
    const cp = await stub(() => ({ status: 200, text: "{}" }));
    const r = await report({
      ...withOidc(cp.origin),
      PHASE: "finish",
      DEPLOYMENT_ID: "r-1",
      STATUS: "failed",
      REVISION: "control-plane-00041-old",
    });
    expect(r.code).toBe(0);
    expect(cp.requests[0].body).toBe(
      JSON.stringify({ status: "failed", revision: "control-plane-00041-old" }),
    );
  });
});
