import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COMMENT_MARKER,
  commentBody,
  findComment,
  generationOf,
  prNumber,
  previewTags,
  taggedPreview,
  tagsToRemove,
  upsertComment,
} from "./cloud-run-preview.mjs";

// AI-207: M6.18: PR previews. The action's logic, and the template workflow that calls it.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/cloud-run-preview.mjs");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const PREVIEW = read("template/.github/workflows/preview.yml");
const ACTION = read("platform/actions/cloud-run-preview/action.yml");

const entry = (n, generation) => ({
  tag: `pr-${n}`,
  revisionName: `app-preview-${String(generation).padStart(5, "0")}-x${n}`,
  url: `https://pr-${n}---app-preview-abc-uc.a.run.app`,
  percent: 0,
});
/** A preview service with the placeholder revision serving and one tag per [pr, generation]. */
const service = (tags) => ({
  status: {
    traffic: [
      { revisionName: "app-preview-00001-aaa", percent: 100, latestRevision: true },
      ...tags.map(([n, g]) => entry(n, g)),
      { tag: "candidate", revisionName: "app-preview-00002-bbb", percent: 0, url: "https://c" },
    ],
  },
});
const tenTags = Array.from({ length: 10 }, (_, i) => [i + 1, i + 10]);

describe("prNumber", () => {
  it("GivenAPositiveInteger_WhenParsed_ThenReturnsIt", () => {
    expect(prNumber("42")).toBe(42);
  });

  it.each(["", "0", "-1", "4.2", "1;rm", "12345678901", undefined])(
    "GivenNotAPrNumber_%s_WhenParsed_ThenThrows",
    (raw) => {
      expect(() => prNumber(raw)).toThrow("positive integer");
    },
  );
});

describe("previewTags", () => {
  it("GivenMixedTraffic_WhenRead_ThenOnlyPrTagsWithTheirGeneration", () => {
    expect(previewTags(service([[7, 12]]))).toEqual([
      {
        tag: "pr-7",
        revision: "app-preview-00012-x7",
        url: "https://pr-7---app-preview-abc-uc.a.run.app",
        generation: 12,
      },
    ]);
  });

  it("GivenACustomRevisionName_WhenGenerationRead_ThenCountsAsOldest", () => {
    expect(generationOf("app-preview-00031-abc")).toBe(31);
    expect(generationOf("custom")).toBe(-1);
  });
});

describe("tagsToRemove: at most 10 previews, oldest first (ADR-0028)", () => {
  it("GivenFewerThanTheCap_WhenANewPrDeploys_ThenRemovesNothing", () => {
    expect(tagsToRemove(service(tenTags.slice(0, 9)), { keep: "pr-99" })).toEqual([]);
  });

  it("GivenTenPreviews_WhenANewPrDeploys_ThenRemovesTheOldestFirst", () => {
    expect(tagsToRemove(service(tenTags), { keep: "pr-99" })).toEqual(["pr-1"]);
  });

  it("GivenTenPreviewsIncludingThisPr_WhenItRedeploys_ThenRemovesNothing", () => {
    expect(tagsToRemove(service(tenTags), { keep: "pr-1" })).toEqual([]);
  });

  it("GivenElevenAfterARace_WhenTrimmedAgain_ThenKeepsThisPrAndDropsTheOldestOther", () => {
    const tags = [...tenTags, [99, 50]];
    expect(tagsToRemove(service(tags), { keep: "pr-99" })).toEqual(["pr-1"]);
  });

  it("GivenOldestByGenerationNotByPrNumber_WhenTrimmed_ThenTheLeastRecentDeployGoes", () => {
    const tags = tenTags.map(([n, g]) => (n === 1 ? [1, 40] : [n, g]));
    expect(tagsToRemove(service(tags), { keep: "pr-99" })).toEqual(["pr-2"]);
  });

  it("GivenALowerCap_WhenTrimmed_ThenRemovesDownToIt", () => {
    expect(tagsToRemove(service(tenTags), { keep: "pr-99", max: 3 })).toEqual([
      "pr-1",
      "pr-2",
      "pr-3",
      "pr-4",
      "pr-5",
      "pr-6",
      "pr-7",
      "pr-8",
    ]);
  });

  it.each([0, 11, Number.NaN])("GivenCap_%s_WhenTrimmed_ThenThrows", (max) => {
    expect(() => tagsToRemove(service([]), { keep: "pr-1", max })).toThrow("1 to 10");
  });
});

describe("taggedPreview", () => {
  it("GivenTheTag_WhenRead_ThenItsUrlAndRevision", () => {
    expect(taggedPreview(service([[7, 12]]), "pr-7")).toEqual({
      url: "https://pr-7---app-preview-abc-uc.a.run.app",
      revision: "app-preview-00012-x7",
    });
  });

  it("GivenNoSuchTag_WhenRead_ThenThrows", () => {
    expect(() => taggedPreview(service([]), "pr-7")).toThrow("no revision tagged pr-7");
  });
});

describe("the PR comment", () => {
  const live = {
    state: "live",
    tag: "pr-7",
    url: "https://pr-7---x.a.run.app",
    service: "app-preview",
    region: "us-central1",
    project: "app-prod",
    sha: "abcdef1234567890",
  };

  it("GivenALivePreview_WhenRendered_ThenUrlAndProxyCommandUnderTheMarker", () => {
    const body = commentBody(live);
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain("**Preview** of abcdef1: https://pr-7---x.a.run.app");
    expect(body).toContain(
      "gcloud run services proxy app-preview --tag pr-7 --region us-central1 --project app-prod",
    );
  });

  it("GivenARemovedPreview_WhenRendered_ThenSaysSoUnderTheMarker", () => {
    const body = commentBody({ state: "removed", tag: "pr-7", service: "app-preview" });
    expect(body).toBe(
      `${COMMENT_MARKER}\n**Preview removed.** Tag \`pr-7\` is gone from \`app-preview\`.\n`,
    );
  });

  it("GivenComments_WhenSearched_ThenOnlyABotCommentWithTheMarkerIsOurs", () => {
    const comments = [
      { id: 1, user: { type: "User" }, body: `${COMMENT_MARKER} copied by a person` },
      { id: 2, user: { type: "Bot" }, body: "another bot" },
      { id: 3, user: { type: "Bot" }, body: `${COMMENT_MARKER}\n**Preview**` },
    ];
    expect(findComment(comments)).toBe(3);
    expect(findComment(comments.slice(0, 2))).toBeNull();
  });

  const fakeGh = (pages) => {
    const calls = [];
    const run = (args, input) => {
      calls.push({ args, input });
      return args.includes("--paginate") ? JSON.stringify(pages) : "{}";
    };
    return { calls, run };
  };

  it("GivenNoPreviewComment_WhenUpserted_ThenCreatesOne", () => {
    const { calls, run } = fakeGh([[{ id: 1, user: { type: "User" }, body: "hi" }]]);
    expect(upsertComment({ repo: "o/r", pr: 7, body: "b" }, run)).toBe("created");
    expect(calls[1].args).toEqual([
      "api",
      "-X",
      "POST",
      "repos/o/r/issues/7/comments",
      "--input",
      "-",
    ]);
    expect(JSON.parse(calls[1].input)).toEqual({ body: "b" });
  });

  it("GivenAnEarlierPreviewComment_WhenUpserted_ThenUpdatesItInPlace", () => {
    const { calls, run } = fakeGh([[], [{ id: 9, user: { type: "Bot" }, body: COMMENT_MARKER }]]);
    expect(upsertComment({ repo: "o/r", pr: 7, body: "b" }, run)).toBe("updated");
    expect(calls[1].args).toEqual([
      "api",
      "-X",
      "PATCH",
      "repos/o/r/issues/comments/9",
      "--input",
      "-",
    ]);
  });
});

describe("the script", () => {
  const run = (command, input, extra) =>
    spawnSync(process.execPath, [SCRIPT, command], {
      encoding: "utf8",
      input: JSON.stringify(input),
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: "", ...extra },
    });

  it("GivenTenPreviews_WhenTrimRuns_ThenOutputsTheTagToRemove", () => {
    const r = run("trim", service(tenTags), { PR: "99", MAX_PREVIEWS: "10" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("remove=pr-1\n");
  });

  it("GivenABadPrNumber_WhenRun_ThenFailsBeforeReadingAnything", () => {
    const r = run("trim", service([]), { PR: "7 --all", MAX_PREVIEWS: "10" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("::error::PR number must be a positive integer");
  });

  it("GivenTheTag_WhenHasTagRuns_ThenPresentTrue", () => {
    expect(run("has-tag", service([[7, 12]]), { PR: "7" }).stdout).toBe("present=true\n");
    expect(run("has-tag", service([]), { PR: "7" }).stdout).toBe("present=false\n");
  });
});

describe("template preview.yml", () => {
  const job = (name) => {
    const start = PREVIEW.indexOf(`\n  ${name}:\n`);
    const next = PREVIEW.slice(start + 1).search(/\n {2}\w[\w-]*:\n/);
    return next < 0 ? PREVIEW.slice(start) : PREVIEW.slice(start, start + 1 + next);
  };

  it("GivenTheWorkflow_WhenRead_ThenItRunsOnlyOnPullRequestNeverPullRequestTarget", () => {
    const on = PREVIEW.slice(PREVIEW.indexOf("\non:"), PREVIEW.indexOf("\nconcurrency:"));
    expect([...on.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1])).toEqual(["pull_request"]);
    expect(on).toContain("types: [opened, synchronize, reopened, closed]");
    expect(PREVIEW).not.toMatch(/pull_request_target|workflow_run|issue_comment/);
    expect(PREVIEW).toMatch(/^permissions: \{\}$/m);
  });

  it.each(["deploy", "remove"])(
    "GivenThe%sJob_WhenRead_ThenForksAndDependabotGetNoJobAndSoNoCredential",
    (name) => {
      const text = job(name);
      expect(text).toContain("github.event.pull_request.head.repo.full_name == github.repository");
      expect(text).toContain("github.event.pull_request.user.login != 'dependabot[bot]'");
      expect(text.match(/id-token: write/g)).toHaveLength(1);
      // The guard is the job's `if`, so it holds before the first step runs.
      expect(text.indexOf("    if: >-")).toBeLessThan(text.indexOf("    steps:"));
    },
  );

  it("GivenTheDeployJob_WhenRead_ThenConfigFirstThenBuildToThePreviewRegistryThenDeploy", () => {
    const steps = job("deploy");
    const at = (s) => steps.indexOf(s);
    expect(at("cloud-run-caller-config")).toBeGreaterThan(0);
    expect(at("cloud-run-caller-config")).toBeLessThan(at("actions/checkout@"));
    expect(at("google-github-actions/auth@")).toBeLessThan(at("build-push-action@"));
    expect(steps).toContain("service_account: ${{ steps.config.outputs.preview-deployer-sa }}");
    expect(steps).toContain("tags: ${{ steps.config.outputs.preview-image }}:");
    expect(steps).toContain("mode: deploy");
    expect(steps).toContain("persist-credentials: false");
    expect(steps).not.toContain("outputs.deployer-sa }}");
  });

  it.each(["deploy", "remove"])(
    "GivenNoPreviewServiceVariable_WhenThe%sJobIsEvaluated_ThenItSkipsRatherThanFails",
    (name) => {
      expect(job(name)).toContain(
        "(vars.GCP_PREVIEW_SERVICE != '' || vars.GCP_DEV_PREVIEW_SERVICE != '')",
      );
    },
  );

  it("GivenTheRemoveJob_WhenRead_ThenItRunsOnlyOnCloseAndNeverChecksOutPrCode", () => {
    const text = job("remove");
    expect(text).toContain("github.event.action == 'closed'");
    expect(text).toContain("mode: remove");
    expect(text).not.toContain("actions/checkout@");
    expect(job("deploy")).toContain("github.event.action != 'closed'");
  });

  it("GivenTheWorkflow_WhenRead_ThenEveryThirdPartyActionIsPinnedToASha", () => {
    const uses = [...PREVIEW.matchAll(/uses:\s+(\S+)/g)].map((m) => m[1]);
    for (const u of uses.filter((u) => !u.startsWith("./"))) expect(u).toMatch(/@[0-9a-f]{40}$/);
  });
});

describe("cloud-run-preview action", () => {
  it("GivenTheAction_WhenRead_ThenInputsReachShellOnlyThroughEnv", () => {
    // An expression may sit only in an env value, an `if:` or an output's `value:`, never in `run:`.
    const lines = ACTION.split("\n").filter((l) => l.includes("${{"));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/^\s+(if|value|[A-Z_]+): /);
  });

  it("GivenARedeployOfTheSameImage_WhenDeployed_ThenTheLabelForcesANewRevisionForTheCapOrder", () => {
    expect(ACTION).toContain('--update-labels "preview-deployed-at=$(date +%s)"');
  });

  it("GivenARedeployedTagWithAnOldGeneration_WhenTrimmed_ThenItGoesFirst", () => {
    // Without the deploy label a rebuild of the same image kept its old revision: guard the order.
    const tags = tenTags.map(([n, g]) => (n === 10 ? [10, 1] : [n, g]));
    expect(tagsToRemove(service(tags), { keep: "pr-99" })).toEqual(["pr-10"]);
  });

  it("GivenTheAction_WhenRead_ThenItTrimsBeforeAndAfterTheNoTrafficDeploy", () => {
    const at = (s) => ACTION.indexOf(s);
    expect(at("Make room under the cap")).toBeLessThan(at("--no-traffic --tag"));
    expect(at("--no-traffic --tag")).toBeLessThan(at("Trim to the cap again"));
  });
});
