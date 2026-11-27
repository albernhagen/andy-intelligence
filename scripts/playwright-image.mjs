#!/usr/bin/env node
// Playwright image check (AI-394): the screenshot job runs in mcr.microsoft.com/playwright:v<X>,
// pinned by digest in a workflow, while `@playwright/test` comes from the lockfile. The browsers
// live in the image, so the two versions must match or every test fails at launch. Dependabot
// bumps the package in a PR of its own (.github/dependabot.yml); this check fails that PR fast
// and names the fix.
//
// CLI: `node scripts/playwright-image.mjs [repo-root]` reads <root>/pnpm-lock.yaml and
// <root>/.github/workflows/*.yml; exits 1 with a `::error` line on a mismatch. No image
// reference means nothing to compare, so it passes.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const IMAGE = /mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)/g;
// pnpm-lock v9 package keys: `'@playwright/test@1.65.1':`
const LOCKED = /^\s+'?@playwright\/test@(\d+\.\d+\.\d+)'?:/gm;

/** Versions of `@playwright/test` resolved in a pnpm lockfile. */
export function lockedVersions(lockText) {
  return [...new Set([...lockText.matchAll(LOCKED)].map((m) => m[1]))];
}

/** Playwright image versions referenced by workflow files: [{ path, version }]. */
export function imageVersions(files) {
  return files.flatMap(({ path, text }) =>
    [...text.matchAll(IMAGE)].map((m) => ({ path, version: m[1] })),
  );
}

/** `{ ok, message }`: ok when every Playwright image matches the one locked package version. */
export function checkPlaywrightImage({ lockText, workflows }) {
  const images = imageVersions(workflows);
  if (images.length === 0) return { ok: true, message: "no Playwright image in workflows" };
  const locked = lockedVersions(lockText);
  if (locked.length !== 1) {
    return {
      ok: false,
      message: `expected one @playwright/test version in pnpm-lock.yaml, found ${locked.length === 0 ? "none" : locked.join(", ")}`,
    };
  }
  const [version] = locked;
  const wrong = images.filter((i) => i.version !== version);
  if (wrong.length === 0)
    return { ok: true, message: `Playwright ${version}: image and package match` };
  const where = [...new Set(wrong.map((i) => `${i.path} (v${i.version})`))].join(", ");
  return {
    ok: false,
    message:
      `@playwright/test is ${version} but the Playwright image in ${where} is not, so the browsers won't launch. ` +
      `Fix in the same PR: set the image to mcr.microsoft.com/playwright:v${version}-noble@sha256:<digest> ` +
      `(digest: docker buildx imagetools inspect mcr.microsoft.com/playwright:v${version}-noble), ` +
      `then re-render screenshots if they changed (apps/web: pnpm screenshots:update).`,
  };
}

function readWorkflows(root) {
  const dir = join(root, ".github", "workflows");
  let names;
  try {
    names = readdirSync(dir).filter((n) => /\.ya?ml$/.test(n));
  } catch {
    return [];
  }
  return names.map((n) => ({
    path: `.github/workflows/${n}`,
    text: readFileSync(join(dir, n), "utf8"),
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? ".";
  const workflows = readWorkflows(root);
  let lockText = "";
  try {
    lockText = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
  } catch {
    // No lockfile: checkPlaywrightImage reports it if an image needs a version.
  }
  const { ok, message } = checkPlaywrightImage({ lockText, workflows });
  if (ok) {
    process.stdout.write(`${message}\n`);
  } else {
    process.stdout.write(`::error title=playwright-image::${message}\n`);
    process.exit(1);
  }
}
