import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publishChange, type PublishInput } from "../src/publish";
import { noConfinement } from "../src/seatbelt";
import { PROJECT_REPO, WORKSPACE, makeRemote } from "./fixtures";

const TOKEN = "ghs_pushtokenFORTHETEST0123456789";
const RUN_ID = "run-42";
const BRANCH = `agent/AI-7/${RUN_ID}`;

const gitEnv = {
  PATH: process.env.PATH,
  HOME: tmpdir(),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
const gitIn = (cwd: string, args: string[]) =>
  execFileSync("git", args, {
    cwd,
    env: gitEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/** A fake GitHub API: records the PR request and its auth header. */
async function fakeGitHub() {
  const pulls: { auth: string | undefined; body: Record<string, unknown> }[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (req.method === "POST" && req.url === `/repos/${PROJECT_REPO}/pulls`) {
        pulls.push({
          auth: req.headers.authorization,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
        });
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ html_url: `https://github.com/${PROJECT_REPO}/pull/9` }));
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { origin, pulls, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** The platform files the publish child imports, copied from this workspace. */
function platformDir(root: string) {
  const dir = join(root, "platform");
  for (const f of [
    "scripts/executor-publish.mjs",
    "scripts/executor-profile.mjs",
    "platform/executor/profile.json",
  ]) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), readFileSync(join(WORKSPACE, f)));
  }
  return dir;
}

/** A remote, a checkout of it at base, and a patch made by editing a second checkout. */
function setup(edit: Record<string, string>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lr-publish-")));
  const remotes = join(root, "remotes");
  makeRemote(remotes, PROJECT_REPO, { "README.md": "# Project\n" });
  const remote = join(remotes, `${PROJECT_REPO}.git`);
  const publishDir = join(root, "publish");
  gitIn(root, ["clone", "--quiet", remote, publishDir]);
  const agentDir = join(root, "agent");
  gitIn(root, ["clone", "--quiet", remote, agentDir]);
  for (const [path, text] of Object.entries(edit)) {
    mkdirSync(dirname(join(agentDir, path)), { recursive: true });
    writeFileSync(join(agentDir, path), text);
  }
  gitIn(agentDir, ["add", "-A"]);
  const patchPath = join(root, "change.patch");
  writeFileSync(patchPath, `${gitIn(agentDir, ["diff", "--cached", "--binary"])}\n`);
  return { root, remote, remotes, publishDir, patchPath, platform: platformDir(root) };
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

async function publishWith(s: ReturnType<typeof setup>, over: Partial<PublishInput> = {}) {
  const github = await fakeGitHub();
  closers.push(github.close);
  const outcome = await publishChange({
    platformDir: s.platform,
    publishDir: s.publishDir,
    patchPath: s.patchPath,
    runId: RUN_ID,
    branch: BRANCH,
    repo: PROJECT_REPO,
    base: "main",
    projectId: "ai",
    ticketKey: "AI-7",
    ticketTitle: "Show the board",
    model: "claude-opus-5-5",
    report: { status: "succeeded", summary: "**Ask**: a board", output: null },
    controlPlaneOrigin: "https://cp.example",
    pushToken: TOKEN,
    gitBase: s.remotes,
    githubApi: github.origin,
    confinement: noConfinement,
    profilePath: join(s.root, "unused.sb"),
    ...over,
  });
  return { outcome, github };
}

describe("local publish (AI-133)", () => {
  it("GivenAChange_WhenPublished_ThenTheRunBranchIsPushedAndThePrOpensWithThePushTokenThatNoLineHolds", async () => {
    const s = setup({ "src/board.ts": "export const board = 1;\n" });
    const { outcome, github } = await publishWith(s);

    expect(outcome.result).toEqual({
      kind: "published",
      branch: BRANCH,
      pullRequest: `https://github.com/${PROJECT_REPO}/pull/9`,
      tooling: [],
    });
    const pushed = gitIn(s.remote, ["log", "-1", "--format=%an%n%s%n%b", BRANCH]);
    expect(pushed).toContain("andy-intelligence-control[bot]");
    expect(pushed).toContain("AI-7: Show the board");
    expect(pushed).toContain(`Agent-Run: ${RUN_ID}`);
    expect(github.pulls).toHaveLength(1);
    expect(github.pulls[0]).toMatchObject({
      auth: `Bearer ${TOKEN}`,
      body: { head: BRANCH, base: "main", title: "AI-7: Show the board" },
    });
    expect(String(github.pulls[0]!.body.body)).toMatch(/^https:\/\/cp\.example\/p\/ai\/t\/AI-7/);
    const text = JSON.stringify(outcome);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("add-mask");
  });

  it("GivenAChangeToAProtectedPath_WhenPublished_ThenItIsRefusedAndNothingIsPushed", async () => {
    const s = setup({ ".github/workflows/x.yml": "on: push\n" });
    const { outcome, github } = await publishWith(s);

    expect(outcome.result.kind).toBe("refused");
    expect(outcome.result.kind === "refused" && outcome.result.reasons.join()).toContain(
      ".github/workflows/x.yml: protected",
    );
    expect(() => gitIn(s.remote, ["rev-parse", "--verify", BRANCH])).toThrow();
    expect(github.pulls).toEqual([]);
  });

  it("GivenAFailedAgent_WhenPublished_ThenTheBranchIsKeptAndNoPrOpens", async () => {
    const s = setup({ "src/board.ts": "export const board = 1;\n" });
    const { outcome, github } = await publishWith(s, {
      report: { status: "failed", summary: "ran out of turns" },
    });

    expect(outcome.result).toMatchObject({ kind: "published", branch: BRANCH, pullRequest: null });
    expect(gitIn(s.remote, ["rev-parse", "--verify", BRANCH])).toMatch(/^[0-9a-f]{40}$/);
    expect(github.pulls).toEqual([]);
  });

  it("GivenNoUsablePushToken_WhenPublished_ThenNothingRuns", async () => {
    const s = setup({ "src/board.ts": "x\n" });
    const { outcome } = await publishWith(s, { pushToken: "" });
    expect(outcome.result).toEqual({
      kind: "error",
      reason: "the push token has an unexpected shape",
    });
  });
});
