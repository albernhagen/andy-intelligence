import { describe, expect, it } from "vitest";
import { Deployment, DeploymentStartReport } from "./deployment";

const DIGEST = `sha256:${"b".repeat(64)}`;
const stored = {
  id: "d1",
  projectId: "ai",
  environment: "prod",
  imageDigest: DIGEST,
  gitSha: "a".repeat(40),
  kind: "deploy",
  status: "started",
  startedAt: "2026-11-25T10:00:00.000Z",
  actor: "system",
};

describe("Deployment url and request (AI-190: M6.11)", () => {
  it("GivenARecordFromBeforeM611_WhenParsed_ThenUrlAndRequestAreNull", () => {
    expect(Deployment.parse(stored)).toMatchObject({ url: null, request: null });
  });

  it("GivenAnHttpsUrlAndARequestId_WhenParsed_ThenKept", () => {
    expect(
      Deployment.parse({ ...stored, url: "https://ai.example.com", request: "req_1-a" }),
    ).toMatchObject({ url: "https://ai.example.com", request: "req_1-a" });
  });

  it("GivenAPlainHttpOrCredentialedUrl_WhenParsed_ThenRefused", () => {
    for (const url of ["http://ai.example.com", "https://user:pw@ai.example.com", "not a url"]) {
      expect(Deployment.safeParse({ ...stored, url }).success, url).toBe(false);
    }
  });
});

describe("DeploymentStartReport (AI-190: M6.11)", () => {
  it("GivenOnlyADigest_WhenParsed_ThenAccepted", () => {
    expect(DeploymentStartReport.parse({ imageDigest: DIGEST })).toEqual({ imageDigest: DIGEST });
  });

  it("GivenEveryField_WhenParsed_ThenAccepted", () => {
    const report = {
      imageDigest: DIGEST,
      environment: "dev",
      kind: "rollback",
      url: "https://dev.example.com",
      request: "r1",
    };
    expect(DeploymentStartReport.parse(report)).toEqual(report);
  });

  it("GivenAPreviewEnvironmentAnUnknownFieldOrABadRequest_WhenParsed_ThenRefused", () => {
    for (const extra of [
      { environment: "preview" },
      { gitSha: "a".repeat(40) },
      { request: "has space" },
      { request: "x".repeat(81) },
    ]) {
      expect(
        DeploymentStartReport.safeParse({ imageDigest: DIGEST, ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });
});
