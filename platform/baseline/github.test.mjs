import { describe, expect, it } from "vitest";
import {
  applySections,
  checkSections,
  diffValues,
  normalizeRuleset,
  UNREADABLE,
} from "./github.mjs";
import { loadConfig } from "./baseline.mjs";

const REPO = "albernhagen/scratch";
const config = loadConfig();

/** In-memory GitHub: GET routes answer from `state`; writes are recorded and update `state`. */
function fakeGitHub(state) {
  const writes = [];
  const gh = async (method, path, body) => {
    if (method !== "GET") {
      writes.push({ method, path, body });
      const handler = state.onWrite?.[`${method} ${path}`];
      if (handler) handler(body);
      return { status: method === "POST" ? 201 : 200, data: {} };
    }
    const route = state.routes[path];
    if (route === undefined) return { status: 404, data: { message: "Not Found" } };
    return typeof route === "function" ? route() : route;
  };
  return { gh, writes };
}

/** Live state that matches the baseline exactly. */
function compliant() {
  const ruleset = {
    id: 7,
    name: "protect-main",
    ...config.ruleset,
    rules: [...config.ruleset.rules].reverse(),
  };
  return {
    routes: {
      [`repos/${REPO}`]: {
        status: 200,
        data: {
          ...config.repo,
          security_and_analysis: {
            secret_scanning: { status: "enabled" },
            secret_scanning_push_protection: { status: "enabled" },
          },
        },
      },
      [`repos/${REPO}/vulnerability-alerts`]: { status: 204, data: null },
      [`repos/${REPO}/automated-security-fixes`]: {
        status: 200,
        data: { enabled: true, paused: false },
      },
      [`repos/${REPO}/private-vulnerability-reporting`]: { status: 200, data: { enabled: true } },
      [`repos/${REPO}/code-scanning/default-setup`]: {
        status: 200,
        data: { state: "not-configured" },
      },
      [`repos/${REPO}/actions/permissions`]: { status: 200, data: config.actions.permissions },
      [`repos/${REPO}/actions/permissions/workflow`]: {
        status: 200,
        data: config.actions.workflow,
      },
      [`repos/${REPO}/labels/security-accepted`]: {
        status: 200,
        data: { ...config.labels[0], color: "b60205" },
      },
      [`repos/${REPO}/labels/review-accepted`]: { status: 200, data: config.labels[1] },
      [`repos/${REPO}/rulesets?includes_parents=false`]: {
        status: 200,
        data: [{ id: 7, name: "protect-main" }],
      },
      [`repos/${REPO}/rulesets/7`]: { status: 200, data: ruleset },
    },
  };
}

const ALL = ["repo", "security", "actions", "labels", "ruleset"];

describe("diffValues", () => {
  it("GivenExtraLiveFields_WhenDiffed_ThenIgnored", () => {
    expect(diffValues({ a: 1 }, { a: 1, b: 2 })).toEqual([]);
  });

  it("GivenADifferentLeaf_WhenDiffed_ThenPathReported", () => {
    expect(diffValues({ a: { b: [1, 2] } }, { a: { b: [1, 3] } })).toEqual([
      { setting: "a.b[1]", want: 2, have: 3 },
    ]);
  });

  it("GivenAMissingLiveField_WhenDiffed_ThenUnreadable", () => {
    expect(diffValues({ a: 1 }, {})).toEqual([{ setting: "a", want: 1, have: UNREADABLE }]);
  });
});

describe("normalizeRuleset", () => {
  it("GivenChecksInAnyOrder_WhenNormalized_ThenSameResult", () => {
    const shuffled = {
      ...config.ruleset,
      rules: config.ruleset.rules
        .map((r) =>
          r.type === "required_status_checks"
            ? {
                ...r,
                parameters: {
                  ...r.parameters,
                  required_status_checks: [...r.parameters.required_status_checks].reverse(),
                },
              }
            : r,
        )
        .reverse(),
    };
    expect(normalizeRuleset(shuffled)).toEqual(normalizeRuleset(config.ruleset));
  });
});

describe("checkSections", () => {
  it("GivenACompliantRepo_WhenChecked_ThenEverySectionOk", async () => {
    const { gh } = fakeGitHub(compliant());
    const results = await checkSections(gh, REPO, config, ALL);
    expect(results.map((r) => [r.section, r.status])).toEqual(ALL.map((s) => [s, "ok"]));
  });

  it("GivenASettingChangedByHand_WhenChecked_ThenDriftNamesIt", async () => {
    const state = compliant();
    state.routes[`repos/${REPO}/actions/permissions/workflow`] = {
      status: 200,
      data: { ...config.actions.workflow, default_workflow_permissions: "write" },
    };
    const results = await checkSections(gh(state), REPO, config, ["actions"]);
    expect(results[0].status).toBe("drift");
    expect(results[0].diffs).toEqual([
      { setting: "workflow.default_workflow_permissions", want: "read", have: "write" },
    ]);
  });

  it("GivenARemovedRequiredCheck_WhenChecked_ThenRulesetDrift", async () => {
    const state = compliant();
    const live = JSON.parse(JSON.stringify(state.routes[`repos/${REPO}/rulesets/7`].data));
    const rsc = live.rules.find((r) => r.type === "required_status_checks");
    rsc.parameters.required_status_checks = rsc.parameters.required_status_checks.filter(
      (c) => c.context !== "security-review",
    );
    state.routes[`repos/${REPO}/rulesets/7`] = { status: 200, data: live };
    const [result] = await checkSections(gh(state), REPO, config, ["ruleset"]);
    expect(result.status).toBe("drift");
  });

  it("GivenNoRuleset_WhenChecked_ThenMissing", async () => {
    const state = compliant();
    state.routes[`repos/${REPO}/rulesets?includes_parents=false`] = { status: 200, data: [] };
    const [result] = await checkSections(gh(state), REPO, config, ["ruleset"]);
    expect(result.diffs).toEqual([{ setting: "", want: "present", have: "missing" }]);
  });

  it("GivenANonAdminToken_WhenSecurityChecked_ThenUnreadableNotDrift", async () => {
    const state = compliant();
    state.routes[`repos/${REPO}/vulnerability-alerts`] = { status: 403, data: {} };
    const [result] = await checkSections(gh(state), REPO, config, ["security"]);
    expect(result.status).toBe("unreadable");
  });
});

describe("applySections", () => {
  it("GivenACompliantRepo_WhenApplied_ThenNoWrites", async () => {
    const { gh, writes } = fakeGitHub(compliant());
    await applySections(gh, REPO, config, ALL);
    expect(writes).toEqual([]);
  });

  it("GivenAMissingLabelAndRuleset_WhenApplied_ThenCreated", async () => {
    const state = compliant();
    delete state.routes[`repos/${REPO}/labels/review-accepted`];
    state.routes[`repos/${REPO}/rulesets?includes_parents=false`] = { status: 200, data: [] };
    const { gh, writes } = fakeGitHub(state);
    await applySections(gh, REPO, config, ["labels", "ruleset"]);
    expect(writes.map((w) => `${w.method} ${w.path}`)).toEqual([
      `POST repos/${REPO}/labels`,
      `POST repos/${REPO}/rulesets`,
    ]);
    expect(writes[0].body.name).toBe("review-accepted");
  });

  it("GivenAlertsOffAndFixesOff_WhenApplied_ThenAlertsEnabledFirst", async () => {
    const state = compliant();
    state.routes[`repos/${REPO}/vulnerability-alerts`] = { status: 404, data: {} };
    state.routes[`repos/${REPO}/automated-security-fixes`] = {
      status: 200,
      data: { enabled: false },
    };
    const { gh, writes } = fakeGitHub(state);
    await applySections(gh, REPO, config, ["security"]);
    expect(writes.map((w) => `${w.method} ${w.path}`)).toEqual([
      `PUT repos/${REPO}/vulnerability-alerts`,
      `PUT repos/${REPO}/automated-security-fixes`,
    ]);
  });
});

function gh(state) {
  return fakeGitHub(state).gh;
}
