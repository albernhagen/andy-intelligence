// Logic for platform/actions/cloud-run-preview (AI-207: M6.18; ADR-0114 "PR previews"). gcloud
// stays in the action; this reads `gcloud run services describe --format=json` from stdin, picks
// the preview tags to remove (at most MAX_PREVIEWS per service, oldest first: ADR-0028) and keeps
// one comment per PR with the preview's URL.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import process from "node:process";
import { text } from "node:stream/consumers";
import { fileURLToPath } from "node:url";

export const MAX_PREVIEWS = 10;
export const COMMENT_MARKER = "<!-- andy-intelligence:cloud-run-preview -->";
const PREVIEW_TAG = /^pr-(\d+)$/;

/** The PR number as a tag-safe positive integer; throws otherwise (it names a Cloud Run tag). */
export function prNumber(raw) {
  const value = String(raw ?? "").trim();
  if (!/^[1-9]\d{0,9}$/.test(value)) throw new Error(`PR number must be a positive integer`);
  return Number(value);
}

export const previewTag = (pr) => `pr-${prNumber(pr)}`;

/**
 * Cloud Run names a deployed revision `<service>-<generation>-<suffix>`, generation counting up
 * per deploy. A name that doesn't parse (a custom `--revision-suffix`) counts as oldest.
 */
export function generationOf(revisionName) {
  const match = /-(\d+)-[a-z0-9]+$/.exec(revisionName ?? "");
  return match ? Number(match[1]) : -1;
}

/** Every `pr-<n>` tag on the service: `{ tag, revision, url, generation }`. */
export function previewTags(service) {
  return (service.status?.traffic ?? [])
    .filter((t) => PREVIEW_TAG.test(t.tag ?? ""))
    .map((t) => ({
      tag: t.tag,
      revision: t.revisionName,
      url: t.url ?? "",
      generation: generationOf(t.revisionName),
    }));
}

/**
 * Tags to remove so `keep` (this PR's tag) fits under `max`: the oldest other preview tags first.
 * Run before the deploy (room for this one) and after it (another PR may have deployed at once).
 */
export function tagsToRemove(service, { keep, max = MAX_PREVIEWS }) {
  if (!Number.isInteger(max) || max < 1 || max > MAX_PREVIEWS) {
    throw new Error(`max previews must be 1 to ${MAX_PREVIEWS}`);
  }
  const others = previewTags(service)
    .filter((t) => t.tag !== keep)
    .sort((a, b) => a.generation - b.generation || a.tag.localeCompare(b.tag));
  const excess = others.length - (max - 1);
  return excess > 0 ? others.slice(0, excess).map((t) => t.tag) : [];
}

/** The tagged URL and revision the deploy made for this PR; throws if the tag is missing. */
export function taggedPreview(service, tag) {
  const entry = previewTags(service).find((t) => t.tag === tag);
  if (!entry?.url) throw new Error(`no revision tagged ${tag} on the preview service`);
  return { url: entry.url, revision: entry.revision };
}

/** The one comment per PR (found again by COMMENT_MARKER), for a live or a removed preview. */
export function commentBody({ state, tag, url, service, region, project, sha }) {
  if (state === "removed") {
    return `${COMMENT_MARKER}\n**Preview removed.** Tag \`${tag}\` is gone from \`${service}\`.\n`;
  }
  if (state !== "live") throw new Error("state must be live or removed");
  return [
    COMMENT_MARKER,
    `**Preview** of ${sha.slice(0, 7)}: ${url}`,
    "",
    `A no-traffic revision of \`${service}\` tagged \`${tag}\`, with no access to prod data. Cloud Run IAM is on unless the project turned it off, so open it through a local proxy:`,
    "",
    "```bash",
    `gcloud run services proxy ${service} --tag ${tag} --region ${region} --project ${project}`,
    "```",
    "",
    `At most ${MAX_PREVIEWS} previews per service: the oldest is removed first. This one goes when the PR closes.`,
    "",
  ].join("\n");
}

/** The id of the comment this action wrote before, or null. */
export function findComment(comments) {
  const own = comments.find(
    (c) => c.user?.type === "Bot" && (c.body ?? "").startsWith(COMMENT_MARKER),
  );
  return own ? own.id : null;
}

function gh(args, input) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    ...(input === undefined ? {} : { input }),
  });
}

/** Creates or updates the PR's one preview comment through `gh api` (GH_TOKEN from the job). */
export function upsertComment({ repo, pr, body }, run = gh) {
  const pages = JSON.parse(
    run(["api", "--paginate", "--slurp", `repos/${repo}/issues/${pr}/comments`]) || "[]",
  );
  const id = findComment(pages.flat());
  const payload = JSON.stringify({ body });
  if (id)
    run(["api", "-X", "PATCH", `repos/${repo}/issues/comments/${id}`, "--input", "-"], payload);
  else run(["api", "-X", "POST", `repos/${repo}/issues/${pr}/comments`, "--input", "-"], payload);
  return id ? "updated" : "created";
}

function setOutputs(outputs) {
  const lines = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
  process.stdout.write(lines);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
}

async function main([command]) {
  const env = process.env;
  const tag = previewTag(env.PR);
  switch (command) {
    case "trim": {
      const service = JSON.parse(await text(process.stdin));
      const remove = tagsToRemove(service, { keep: tag, max: Number(env.MAX_PREVIEWS) });
      if (remove.length)
        process.stderr.write(`Removing the oldest previews: ${remove.join(", ")}\n`);
      return setOutputs({ remove: remove.join(",") });
    }
    case "tagged": {
      const service = JSON.parse(await text(process.stdin));
      return setOutputs(taggedPreview(service, tag));
    }
    case "has-tag": {
      const service = JSON.parse(await text(process.stdin));
      return setOutputs({ present: previewTags(service).some((t) => t.tag === tag) });
    }
    case "comment": {
      const body = commentBody({
        state: env.STATE,
        tag,
        url: env.URL,
        service: env.SERVICE,
        region: env.REGION,
        project: env.PROJECT,
        sha: env.SHA ?? "",
      });
      const done = upsertComment({ repo: env.REPO, pr: prNumber(env.PR), body });
      return process.stderr.write(`Preview comment ${done}.\n`);
    }
    default:
      throw new Error(`unknown command ${command}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`::error::${error.message}\n`);
    process.exit(1);
  });
}
