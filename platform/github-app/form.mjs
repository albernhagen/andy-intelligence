#!/usr/bin/env node
// Prints an HTML page that starts GitHub's App manifest flow (ADR-0040). Andy opens it locally
// and clicks Create; GitHub then redirects to http://localhost:1/?code=… (a dead page, so the
// one-hour code never reaches a server). Runbook: docs/runbooks/github-app.md.
//
//   node platform/github-app/form.mjs control-plane > /tmp/app.html && open /tmp/app.html
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APPS = ["control-plane", "review-bot"];

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function manifestForm(manifest, state = randomUUID()) {
  const action = `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`;
  return `<!doctype html>
<meta charset="utf-8">
<title>Create ${escapeHtml(manifest.name)}</title>
<form action="${action}" method="post">
  <input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
  <p>Creates the GitHub App <b>${escapeHtml(manifest.name)}</b> on your account.</p>
  <button type="submit">Create GitHub App</button>
</form>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = process.argv[2];
  if (!APPS.includes(app)) {
    console.error(`usage: form.mjs <${APPS.join("|")}>`);
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(path.join(HERE, `${app}.json`), "utf8"));
  process.stdout.write(manifestForm(manifest));
}
