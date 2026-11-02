// Project baseline GitHub config (ADR-0031, ADR-0038): read, diff and apply each section of
// platform/baseline/github/*.json. `gh(method, path, body?)` returns { status, data }; it is the
// only I/O, so tests pass a fake.

/** A live value the token can't see (the API leaves it out without admin access). */
export const UNREADABLE = "unreadable (needs admin)";

/** Thrown when a read is refused (needs admin) rather than answered. */
export class Unreadable extends Error {}

function ok(res, what) {
  if (res.status === 401 || res.status === 403) throw new Unreadable(`${what}: HTTP ${res.status}`);
  if (res.status >= 400) throw new Error(`${what}: HTTP ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
}

/**
 * Leaf-level differences where `want` isn't matched by `have`. Objects compare as subsets (extra
 * live fields are ignored); arrays compare element by element and must have the same length.
 */
export function diffValues(want, have, path = "") {
  if (have === undefined) return [{ setting: path, want, have: UNREADABLE }];
  if (Array.isArray(want)) {
    if (!Array.isArray(have) || have.length !== want.length) return [{ setting: path, want, have }];
    return want.flatMap((w, i) => diffValues(w, have[i], `${path}[${i}]`));
  }
  if (want !== null && typeof want === "object") {
    if (have === null || typeof have !== "object") return [{ setting: path, want, have }];
    return Object.keys(want).flatMap((k) =>
      diffValues(want[k], have[k], path ? `${path}.${k}` : k),
    );
  }
  return want === have ? [] : [{ setting: path, want, have }];
}

/** Sorts rules and their lists so a ruleset compares regardless of API ordering. */
export function normalizeRuleset(r) {
  const byKey = (k) => (a, b) => String(a[k]).localeCompare(String(b[k]));
  const rules = [...(r.rules ?? [])]
    .map((rule) => {
      const p = rule.parameters;
      if (rule.type === "required_status_checks" && p) {
        const checks = [...p.required_status_checks].sort(byKey("context"));
        return { ...rule, parameters: { ...p, required_status_checks: checks } };
      }
      if (rule.type === "code_scanning" && p) {
        const tools = [...p.code_scanning_tools].sort(byKey("tool"));
        return { ...rule, parameters: { ...p, code_scanning_tools: tools } };
      }
      return rule;
    })
    .sort(byKey("type"));
  return { ...r, rules };
}

const repoSection = {
  name: "repo",
  async read(gh, repo, want) {
    const data = ok(await gh("GET", `repos/${repo}`), "repo");
    return Object.fromEntries(Object.keys(want).map((k) => [k, data[k]]));
  },
  async write(gh, repo, want) {
    ok(await gh("PATCH", `repos/${repo}`, want), "repo");
  },
};

// Toggle endpoints: GET answers 204/200 {enabled} when on and 404 or {enabled:false} when off.
const TOGGLES = {
  vulnerability_alerts: "vulnerability-alerts",
  automated_security_fixes: "automated-security-fixes",
  private_vulnerability_reporting: "private-vulnerability-reporting",
};

const securitySection = {
  name: "security",
  async read(gh, repo) {
    const live = {};
    for (const [key, endpoint] of Object.entries(TOGGLES)) {
      const res = await gh("GET", `repos/${repo}/${endpoint}`);
      if (res.status === 404) live[key] = false;
      else live[key] = res.status === 204 ? true : ok(res, key).enabled;
    }
    const sa = ok(await gh("GET", `repos/${repo}`), "repo").security_and_analysis;
    if (!sa) throw new Unreadable("security_and_analysis: not returned (needs admin)");
    live.secret_scanning = sa.secret_scanning?.status;
    live.secret_scanning_push_protection = sa.secret_scanning_push_protection?.status;
    live.code_scanning_default_setup = ok(
      await gh("GET", `repos/${repo}/code-scanning/default-setup`),
      "code scanning default setup",
    ).state;
    return live;
  },
  async write(gh, repo, want, live) {
    // Only what drifts. Vulnerability alerts first: automated security fixes need them.
    for (const [key, endpoint] of Object.entries(TOGGLES)) {
      if (want[key] !== live[key]) {
        ok(await gh(want[key] ? "PUT" : "DELETE", `repos/${repo}/${endpoint}`), key);
      }
    }
    const scanning = ["secret_scanning", "secret_scanning_push_protection"];
    if (scanning.some((k) => want[k] !== live[k])) {
      const security_and_analysis = Object.fromEntries(
        scanning.map((k) => [k, { status: want[k] }]),
      );
      ok(await gh("PATCH", `repos/${repo}`, { security_and_analysis }), "security_and_analysis");
    }
    if (want.code_scanning_default_setup !== live.code_scanning_default_setup) {
      ok(
        await gh("PATCH", `repos/${repo}/code-scanning/default-setup`, {
          state: want.code_scanning_default_setup,
        }),
        "code scanning default setup",
      );
    }
  },
};

const actionsSection = {
  name: "actions",
  async read(gh, repo) {
    return {
      permissions: ok(await gh("GET", `repos/${repo}/actions/permissions`), "actions permissions"),
      workflow: ok(
        await gh("GET", `repos/${repo}/actions/permissions/workflow`),
        "workflow permissions",
      ),
    };
  },
  async write(gh, repo, want) {
    ok(
      await gh("PUT", `repos/${repo}/actions/permissions`, want.permissions),
      "actions permissions",
    );
    ok(
      await gh("PUT", `repos/${repo}/actions/permissions/workflow`, want.workflow),
      "workflow permissions",
    );
  },
};

const labelsSection = {
  name: "labels",
  async read(gh, repo, want) {
    const live = [];
    for (const label of want) {
      const res = await gh("GET", `repos/${repo}/labels/${encodeURIComponent(label.name)}`);
      if (res.status === 404) {
        live.push(null);
        continue;
      }
      const d = ok(res, `label ${label.name}`);
      live.push({ name: d.name, color: d.color.toUpperCase(), description: d.description ?? "" });
    }
    return live;
  },
  async write(gh, repo, want, live) {
    for (const [i, label] of want.entries()) {
      if (live[i] === null) {
        ok(await gh("POST", `repos/${repo}/labels`, label), `label ${label.name}`);
      } else if (diffValues(label, live[i]).length > 0) {
        const url = `repos/${repo}/labels/${encodeURIComponent(label.name)}`;
        ok(await gh("PATCH", url, label), `label ${label.name}`);
      }
    }
  },
};

async function findRuleset(gh, repo, name) {
  const list = ok(await gh("GET", `repos/${repo}/rulesets?includes_parents=false`), "rulesets");
  return list.find((r) => r.name === name) ?? null;
}

const rulesetSection = {
  name: "ruleset",
  async read(gh, repo, want) {
    const found = await findRuleset(gh, repo, want.name);
    if (!found) return null;
    return normalizeRuleset(ok(await gh("GET", `repos/${repo}/rulesets/${found.id}`), "ruleset"));
  },
  async write(gh, repo, want) {
    const found = await findRuleset(gh, repo, want.name);
    if (found) ok(await gh("PUT", `repos/${repo}/rulesets/${found.id}`, want), "ruleset");
    else ok(await gh("POST", `repos/${repo}/rulesets`, want), "ruleset");
  },
};

export const SECTIONS = [
  repoSection,
  securitySection,
  actionsSection,
  labelsSection,
  rulesetSection,
];

/** Desired value for a section, from the parsed github/*.json files. */
export function desiredFor(name, config) {
  return name === "ruleset" ? normalizeRuleset(config.ruleset) : config[name];
}

/**
 * Diffs each named section. Returns [{ section, status: "ok" | "drift" | "unreadable", diffs, error }].
 */
export async function checkSections(gh, repo, config, names) {
  const results = [];
  for (const section of SECTIONS.filter((s) => names.includes(s.name))) {
    const want = desiredFor(section.name, config);
    try {
      const live = await section.read(gh, repo, want);
      const diffs =
        live === null
          ? [{ setting: "", want: "present", have: "missing" }]
          : diffValues(want, live);
      const status = diffs.some((d) => d.have !== UNREADABLE)
        ? "drift"
        : diffs.length > 0
          ? "unreadable"
          : "ok";
      results.push({ section: section.name, status, diffs, live });
    } catch (e) {
      if (!(e instanceof Unreadable)) throw e;
      results.push({ section: section.name, status: "unreadable", diffs: [], error: e.message });
    }
  }
  return results;
}

/** Writes every drifting section, then re-checks. Returns the re-check results. */
export async function applySections(gh, repo, config, names) {
  const before = await checkSections(gh, repo, config, names);
  for (const r of before.filter((x) => x.status === "drift")) {
    const section = SECTIONS.find((s) => s.name === r.section);
    await section.write(gh, repo, desiredFor(r.section, config), r.live);
  }
  return checkSections(gh, repo, config, names);
}
