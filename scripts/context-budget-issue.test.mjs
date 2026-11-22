import { describe, expect, it } from "vitest";
import { BOT, MARKER, TITLE, issueBody, plan, sync } from "./context-budget-issue.mjs";

const over = [{ path: "README.md", lines: 9, words: 2100, maxWords: 2000, over: true }];

/** A fake GitHub: answers the issue list with `issues`, records every call. */
function fakeGithub(issues = []) {
  const calls = [];
  const github = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === "GET") return issues;
    if (method === "POST") return { number: 42 };
    return {};
  };
  return { github, calls };
}

describe("issueBody", () => {
  it("GivenAFileOverBudget_WhenWritten_ThenItNamesTheFileItsCountAndItsBudget", () => {
    const body = issueBody(over);
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain("| `README.md` | 2100/2000 words |");
  });
});

describe("plan", () => {
  it.each([
    ["nothing over and no issue", [], null, "none"],
    ["nothing over and an open issue", [], { number: 1, body: "x" }, "close"],
    ["a file over and no issue", over, null, "create"],
    ["a file over and a stale issue", over, { number: 1, body: "old" }, "update"],
    ["a file over and the same issue", over, { number: 1, body: issueBody(over) }, "none"],
  ])("Given%s_WhenPlanned_ThenTheActionMatches", (_, files, existing, action) => {
    expect(plan(files, existing).action).toBe(action);
  });
});

describe("sync", () => {
  it("GivenMainOverBudgetAndNoIssue_WhenSynced_ThenOneIssueIsOpened", async () => {
    const { github, calls } = fakeGithub([]);
    expect(await sync({ github, repo: "o/r", over })).toBe("opened #42");
    const post = calls.find((c) => c.method === "POST");
    expect(post).toMatchObject({ path: "/repos/o/r/issues", body: { title: TITLE } });
  });

  it("GivenOurIssueIsOpen_WhenTheListChanges_ThenItIsEditedNotDuplicated", async () => {
    const { github, calls } = fakeGithub([
      { number: 7, body: `${MARKER}\nold`, user: { login: BOT } },
    ]);
    expect(await sync({ github, repo: "o/r", over })).toBe("updated #7");
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("GivenSomeoneElsesIssueWithTheMarker_WhenSynced_ThenItIsLeftAlone", async () => {
    const { github, calls } = fakeGithub([
      { number: 7, body: `${MARKER}\nold`, user: { login: "someone" } },
    ]);
    expect(await sync({ github, repo: "o/r", over })).toBe("opened #42");
    expect(calls.filter((c) => c.method === "PATCH")).toEqual([]);
  });

  // The REST `creator` filter may not match a `[bot]` login; ours is matched on each issue instead.
  it("GivenAnyOpenIssues_WhenSearched_ThenTheListIsNotFilteredByCreator", async () => {
    const { github, calls } = fakeGithub([]);
    await sync({ github, repo: "o/r", over });
    expect(calls[0].path).toBe("/repos/o/r/issues?state=open&per_page=100&page=1");
  });

  it("GivenOurIssueIsOpen_WhenNothingIsOver_ThenItIsClosed", async () => {
    const { github, calls } = fakeGithub([
      { number: 7, body: `${MARKER}\nold`, user: { login: BOT } },
    ]);
    expect(await sync({ github, repo: "o/r", over: [] })).toBe("closed #7");
    expect(calls.at(-1)).toMatchObject({ method: "PATCH", body: { state: "closed" } });
  });
});
