import { describe, expect, it } from "vitest";
import { expectations, failures, parseFacts, SECRET_VARS } from "./expectations.mjs";

const report = [
  ...SECRET_VARS.map((v) => `env.${v}=unset`),
  "pid1=/proc/self/fd/3",
  "sudo=1",
  "curl.example=56",
  "curl.registry=0",
  "git.update-index=0",
  "write.root=0",
  "write.scripts=1",
  "write.review-script=1",
  "write.github=1",
  "write.git-config=1",
  "write.git-hooks=1",
  "pnpm.lint=0",
  "pnpm.typecheck=0",
  "pnpm.test=0",
  "pnpm.build=0",
  "done=yes",
].join("\n");

const good = {
  report,
  hostPid1: "/sbin/init",
  verify: "",
  checkTampered: "",
  checkDirty: "",
  tampered: "",
  collected: "A\tsandbox-lab-change.txt",
  expectedChange: "A\tsandbox-lab-change.txt",
  labChecks: "all",
};
const failedNames = (input) => failures(expectations(input)).map((e) => e.name);
const replace = (from, to) => report.replace(from, to);

describe("expectations", () => {
  it("GivenEveryFactHolds_WhenEvaluated_ThenNothingFails", () => {
    expect(failedNames(good)).toEqual([]);
  });

  it.each([
    ["env.GITHUB_TOKEN=unset", "env.GITHUB_TOKEN=set", "env GITHUB_TOKEN"],
    ["env.ACTIONS_ID_TOKEN_REQUEST_TOKEN=unset", "", "env ACTIONS_ID_TOKEN_REQUEST_TOKEN"],
    ["sudo=1", "sudo=0", "sudo fails"],
    ["curl.example=56", "curl.example=0", "example.com blocked"],
    ["curl.registry=0", "curl.registry=7", "registry reachable"],
    ["write.git-config=1", "write.git-config=0", ".git/config denied"],
    ["pnpm.test=0", "pnpm.test=1", "pnpm test"],
    ["done=yes", "", "probe ran"],
  ])("GivenFact %s changedTo %s_WhenEvaluated_ThenNamesIt", (from, to, name) => {
    expect(failedNames({ ...good, report: replace(from, to) })).toEqual([name]);
  });

  it("GivenPidOneIsTheHosts_WhenEvaluated_ThenNamesIt", () => {
    expect(failedNames({ ...good, hostPid1: "/proc/self/fd/3" })).toEqual(["own PID namespace"]);
  });

  it("GivenNoReport_WhenEvaluated_ThenTheProbeAndChecksFail", () => {
    const names = failedNames({ ...good, report: "" });
    expect(names).toContain("probe ran");
    expect(names).toContain("sudo fails");
  });

  it.each([
    ["verify", "Sandbox check failed: x.", "check command verified"],
    ["checkTampered", "config", "check left .git alone"],
    ["checkDirty", "?? .npmrc", "check left checkout clean"],
    ["tampered", "hooks (x)", ".git unchanged"],
    ["collected", "A\tsandbox-lab-change.txt A\t.npmrc", "collect finds one change"],
  ])("GivenBad %s_WhenEvaluated_ThenNamesIt", (key, value, name) => {
    expect(failedNames({ ...good, [key]: value })).toEqual([name]);
  });

  it("GivenFastChecks_WhenTestsDidNotRun_ThenTheyAreNotExpected", () => {
    const fast = report.replace("pnpm.test=0\npnpm.build=0\n", "");
    expect(failedNames({ ...good, report: fast, labChecks: "fast" })).toEqual([]);
  });
});

describe("parseFacts", () => {
  it("GivenRepeatedKey_WhenParsed_ThenFirstValueWins", () => {
    expect(parseFacts("a=1\na=2\nb=x=y").get("a")).toBe("1");
    expect(parseFacts("b=x=y").get("b")).toBe("x=y");
  });
});
