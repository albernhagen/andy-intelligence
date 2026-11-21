// Test double for `run(cmd, args)`: answers gh calls from a small model of one repo's PRs.
// Used by the coordinator tools' tests only.

const ok = (value) => ({
  status: 0,
  stdout: typeof value === "string" ? value : JSON.stringify(value),
  stderr: "",
});
const fail = (stderr, status = 1) => ({ status, stdout: "", stderr });

export const HEAD = "a".repeat(40);

export function reviewBody(role, { sha = HEAD, counts, rows = [] } = {}) {
  const defaults =
    role === "security"
      ? "critical 0 · high 0 · medium 0 · low 0 · info 0"
      : "blocker 0 · should-fix 0 · question 0";
  const table = rows.length
    ? `\n\n| Severity | Finding | Where | Why | Fix |\n|---|---|---|---|---|\n${rows.map(([s, t]) => `| ${s} | ${t} | | | |`).join("\n")}`
    : "";
  return `<!-- ${role}-review -->\n${sha ? `<!-- reviewed-sha: ${sha} -->\n` : ""}### ✅ ${role} verdict\n\n${counts ?? defaults}${table}\n\n<sub>Commit ${sha}.</sub>`;
}

/** A PR that passes every mechanical rule; override fields per test. */
export function cleanPr(number, overrides = {}) {
  return {
    view: {
      number,
      title: `PR ${number}`,
      state: "OPEN",
      isDraft: false,
      baseRefName: "main",
      headRefName: `branch-${number}`,
      headRefOid: HEAD,
      mergeStateStatus: "CLEAN",
      labels: [],
      isCrossRepository: false,
      url: `https://github.com/o/r/pull/${number}`,
    },
    behindBy: 0,
    checks: [
      { name: "ci", bucket: "pass" },
      { name: "plan", bucket: "skipping" },
    ],
    comments: [
      {
        login: "github-actions[bot]",
        body: reviewBody("security"),
        updated_at: "2026-11-20T01:00:00Z",
      },
      {
        login: "github-actions[bot]",
        body: reviewBody("adversarial"),
        updated_at: "2026-11-20T01:00:00Z",
      },
    ],
    files: ["apps/web/src/a.ts"],
    ...overrides,
  };
}

/**
 * @param {Record<number, ReturnType<typeof cleanPr>>} prs
 * @param {{ runs?: () => object[], mainSha?: string, mergeFails?: boolean }} opts
 */
export function fakeGh(prs, opts = {}) {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    if (cmd !== "gh") return fail(`unexpected ${cmd}`);
    const [a, b, c] = args;
    const pr = prs[Number(c)] ?? prs[Number(String(b).match(/\/(\d+)\//)?.[1])];
    if (a === "pr" && b === "view") {
      if (!prs[Number(c)]) return fail("no pull requests found");
      const p = prs[Number(c)];
      if (args.includes("state,mergeCommit")) {
        return ok(
          p.merged
            ? { state: "MERGED", mergeCommit: { oid: `m${c}`.padEnd(40, "0") } }
            : { state: "OPEN", mergeCommit: null },
        );
      }
      return ok(p.view);
    }
    if (a === "pr" && b === "checks") {
      const p = prs[Number(c)];
      if (p.checksError) return fail("no checks reported on the 'x' branch");
      const failing = p.checks.some((x) => x.bucket === "fail");
      return { status: failing ? 1 : 0, stdout: JSON.stringify(p.checks), stderr: "" };
    }
    if (a === "pr" && b === "merge") {
      const p = prs[Number(c)];
      if (opts.mergeFails) return fail("merge refused");
      p.merged = true;
      return ok("");
    }
    if (a === "pr" && b === "list") return ok(Object.keys(prs).map((n) => ({ number: Number(n) })));
    if (a === "run" && b === "list")
      return ok(
        opts.runs
          ? opts.runs(args[args.indexOf("--commit") + 1])
          : [{ name: "ci", status: "completed", conclusion: "success", url: "u" }],
      );
    if (a === "api") {
      const path = args.find((x) => x.startsWith("repos/"));
      if (args.includes("DELETE")) return ok("");
      if (path.endsWith("/commits/main")) return ok({ sha: opts.mainSha ?? "f".repeat(40) });
      const compare = /compare\/main\.\.\.(\w+)/.exec(path);
      if (compare) {
        const p = Object.values(prs).find((x) => x.view.headRefOid === compare[1]);
        if (!p || p.compareError) return fail("HTTP 502");
        return ok({ status: p.behindBy ? "diverged" : "ahead", behind_by: p.behindBy });
      }
      const n = Number(/\/(\d+)\//.exec(path)?.[1]);
      const p = prs[n] ?? pr;
      if (path.includes("/issues/")) return ok(p.comments.map((x) => JSON.stringify(x)).join("\n"));
      if (path.includes("/pulls/")) return ok(p.files.join("\n"));
    }
    return fail(`unhandled: ${args.join(" ")}`);
  };
  return { run, calls };
}
