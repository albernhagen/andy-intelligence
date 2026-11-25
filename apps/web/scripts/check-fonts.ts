import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * AI-367 (ADR-0151): the built app serves its own fonts. Fails the build when any built file
 * names a third-party font host, or a stylesheet loads a font (`@font-face` src, `@import`) from
 * an absolute http(s) URL. Run after `vite build` by the `build` script.
 */

const FONT_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "use.typekit.net",
  "fonts.bunny.net",
  "rsms.me",
  "cdn.jsdelivr.net",
  "unpkg.com",
];

/** Problems in one built file's text, as `<file>: <why>` lines. */
export function externalFontProblems(file: string, text: string): string[] {
  const problems = FONT_HOSTS.filter((h) => text.includes(h)).map(
    (h) => `${file}: names font host ${h}`,
  );
  if (file.endsWith(".css")) {
    for (const block of text.match(/@font-face\s*{[^}]*}/g) ?? []) {
      if (/url\(\s*["']?(https?:)?\/\//.test(block)) {
        problems.push(`${file}: @font-face loads from another host`);
      }
    }
    if (/@import\s+(url\()?\s*["']?(https?:)?\/\//.test(text)) {
      problems.push(`${file}: @import from another host`);
    }
  }
  return problems;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** Every problem in a built app directory. */
export function checkBuiltFonts(dist: string): string[] {
  return files(dist)
    .filter((f) => /\.(css|html|js)$/.test(f))
    .flatMap((f) => externalFontProblems(f, readFileSync(f, "utf8")));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = fileURLToPath(new URL("../dist", import.meta.url));
  const problems = checkBuiltFonts(dist);
  if (problems.length > 0) {
    console.error(`Fonts must be served from the app (ADR-0151):\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log("check-fonts: no third-party font host in the built app");
}
