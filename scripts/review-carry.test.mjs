import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decide, gitRunner, outputLines, passingVerdict, reviewedSha } from "./review-carry.mjs";

const BOT = { name: "andy-intelligence-control[bot]", email: "bot@users.noreply.github.com" };
const DEV = { name: "dev", email: "dev@example.com" };

/** A throwaway repo: main with a file, a PR branch that edits it, then main moves on. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "review-carry-"));
  const raw = gitRunner(dir);
  const as = (who) => (args, input) =>
    raw(["-c", `user.name=${who.name}`, "-c", `user.email=${who.email}`, ...args], input);
  const dev = as(DEV);
  const bot = as(BOT);
  const write = (file, text) => writeFileSync(join(dir, file), text);
  const commit = (git, msg) => {
    git(["add", "-A"]);
    git(["commit", "-q", "-m", msg]);
    return git(["rev-parse", "HEAD"]);
  };
  dev(["init", "-q", "-b", "main"]);
  write("app.js", "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n");
  write("other.js", "a\n");
  commit(dev, "base");
  dev(["checkout", "-q", "-b", "pr"]);
  write("app.js", "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight changed by the PR\n");
  const reviewed = commit(dev, "pr change");
  dev(["checkout", "-q", "main"]);
  write("other.js", "a\nb from main\n");
  const mainTip = commit(dev, "main moves on");
  dev(["update-ref", "refs/remotes/origin/main", mainTip]);
  dev(["checkout", "-q", "pr"]);
  return { dir, raw, dev, bot, write, commit, reviewed, mainTip };
}

const verdict = (sha, heading = "✅ Adversarial review: no blocker findings") =>
  `<!-- adversarial-review -->\n<!-- reviewed-sha: ${sha} -->\n### ${heading}\n\nblocker 0`;

/** The re-sync bot merges main into the PR, as GitHub's update-branch does. */
function botMerge(r, { extraEdit } = {}) {
  r.bot(["merge", "-q", "--no-ff", "--no-commit", "main"]);
  if (extraEdit) r.write("app.js", extraEdit);
  return r.commit(r.bot, "Merge branch 'main' into pr");
}

describe("reviewedSha and passingVerdict", () => {
  const sha = "c".repeat(40);

  it("GivenAVerdictComment_WhenRead_ThenItsShaIsReturned", () => {
    expect(reviewedSha(verdict(sha))).toBe(sha);
  });

  it("GivenANotReviewedComment_WhenRead_ThenThereIsNoSha", () => {
    expect(
      reviewedSha("<!-- adversarial-review -->\n### ⚠️ Adversarial review: not reviewed"),
    ).toBe(null);
  });

  it("GivenAPassOnTheSameSha_WhenChecked_ThenItPasses", () => {
    expect(passingVerdict(verdict(sha), sha)).toBe(true);
  });

  it("GivenABlockedOrLabelAcceptedVerdict_WhenChecked_ThenItDoesNotPass", () => {
    expect(passingVerdict(verdict(sha, "❌ Adversarial review: 1 blocker"), sha)).toBe(false);
    expect(passingVerdict(verdict(sha, "⚠️ Adversarial review: 1 blocker, accepted"), sha)).toBe(
      false,
    );
  });

  it("GivenAPassOnAnotherSha_WhenChecked_ThenItDoesNotPass", () => {
    expect(passingVerdict(verdict(sha), "d".repeat(40))).toBe(false);
  });
});

describe("decide", () => {
  it("GivenABotAuthoredMergeOfMainThatLeavesThePrDiffUnchanged_WhenDecided_ThenTheVerdictCarries", () => {
    const r = repo();
    const head = botMerge(r);
    expect(r.raw(["log", "-1", "--format=%an", head])).toBe(BOT.name);
    const result = decide({ git: r.raw, previous: verdict(r.reviewed), head, baseRef: "main" });
    expect(result).toEqual({ carry: true, from: r.reviewed });
    expect(outputLines(result)).toEqual(["mode=carried", `carried-from=${r.reviewed}`]);
  });

  it("GivenABotAuthoredMergeThatAlsoChangesThePrDiff_WhenDecided_ThenNothingCarries", () => {
    const r = repo();
    const head = botMerge(r, {
      extraEdit: "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight changed by the PR\nsneaked in\n",
    });
    const result = decide({ git: r.raw, previous: verdict(r.reviewed), head, baseRef: "main" });
    expect(result).toEqual({ carry: false, reason: "its merge changed the PR's own diff" });
    expect(outputLines(result)[0]).toBe("mode=unavailable");
  });

  it("GivenAWhitespaceOnlyChangeInTheMerge_WhenDecided_ThenNothingCarries", () => {
    const r = repo();
    const head = botMerge(r, {
      extraEdit: "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight changed by the PR \n",
    });
    expect(decide({ git: r.raw, previous: verdict(r.reviewed), head, baseRef: "main" }).carry).toBe(
      false,
    );
  });

  it("GivenABotCommitThatIsNotAMerge_WhenDecided_ThenNothingCarries", () => {
    const r = repo();
    r.write("app.js", "rewritten\n");
    const head = r.commit(r.bot, "not a merge");
    expect(decide({ git: r.raw, previous: verdict(r.reviewed), head, baseRef: "main" })).toEqual({
      carry: false,
      reason: "its commit is not a merge of the base branch",
    });
  });

  it("GivenAnUnreviewedCommitBeforeTheBotMerge_WhenDecided_ThenNothingCarries", () => {
    const r = repo();
    r.write("app.js", "unreviewed\n");
    r.commit(r.dev, "pushed but never reviewed");
    const head = botMerge(r);
    expect(decide({ git: r.raw, previous: verdict(r.reviewed), head, baseRef: "main" })).toEqual({
      carry: false,
      reason: "its merge does not sit on the reviewed commit",
    });
  });

  it("GivenAMergeOfABranchThatIsNotOnMain_WhenDecided_ThenNothingCarries", () => {
    const r = repo();
    r.dev(["checkout", "-q", "-b", "side", "main"]);
    r.write("other.js", "side\n");
    r.commit(r.dev, "side change");
    r.dev(["checkout", "-q", "pr"]);
    r.bot(["merge", "-q", "--no-ff", "--no-commit", "side"]);
    const head = r.commit(r.bot, "Merge side");
    expect(decide({ git: r.raw, previous: verdict(r.reviewed), head, baseRef: "main" })).toEqual({
      carry: false,
      reason: "it merged a commit that is not on main",
    });
  });

  it("GivenAFailedEarlierVerdict_WhenDecided_ThenNothingCarries", () => {
    const r = repo();
    const head = botMerge(r);
    const previous = verdict(r.reviewed, "❌ Adversarial review: 1 blocker");
    expect(decide({ git: r.raw, previous, head, baseRef: "main" })).toEqual({
      carry: false,
      reason: "the earlier verdict did not pass",
    });
  });

  it("GivenNoEarlierReview_WhenDecided_ThenNothingCarries", () => {
    const r = repo();
    const head = botMerge(r);
    expect(decide({ git: r.raw, previous: "", head, baseRef: "main" }).carry).toBe(false);
  });
});
