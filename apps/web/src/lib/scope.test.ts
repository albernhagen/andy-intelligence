import { afterEach, describe, expect, it } from "vitest";
import { loadScope, saveScope, scopeFromPath, scopePath, sectionFromPath } from "./scope";

afterEach(() => window.localStorage.clear());

describe("scope", () => {
  it.each([
    ["/all/inbox", { kind: "all" }],
    ["/all", { kind: "all" }],
    ["/p/ai", { kind: "project", projectId: "ai" }],
    ["/p/ai/t/AI-2", { kind: "project", projectId: "ai" }],
    ["/settings/github", null],
    ["/allotment", null],
    ["/p/%zz/inbox", { kind: "project", projectId: "%zz" }],
  ])("GivenPath%s_WhenParsed_ThenScopeIsNamed", (path, scope) => {
    expect(scopeFromPath(path)).toEqual(scope);
  });

  it.each([
    ["/p/ai", "board"],
    ["/p/ai/t/AI-2", "board"],
    ["/all/board", "board"],
    ["/p/ai/inbox", "inbox"],
    ["/all/inbox", "inbox"],
    ["/p/ai/dashboards", "dashboards"],
    ["/all/dashboards", "dashboards"],
    ["/p/ai/digest", null],
    ["/settings/github", null],
  ])("GivenPath%s_WhenParsed_ThenSectionIs%s", (path, section) => {
    expect(sectionFromPath(path)).toBe(section);
  });

  it("GivenAScopeAndSection_WhenLinked_ThenPathsMatchTheRoutes", () => {
    const ai = { kind: "project", projectId: "ai" } as const;
    expect(scopePath(ai, "board")).toBe("/p/ai");
    expect(scopePath(ai, "inbox")).toBe("/p/ai/inbox");
    expect(scopePath({ kind: "all" }, "board")).toBe("/all/board");
    expect(scopePath({ kind: "all" }, "inbox")).toBe("/all/inbox");
    expect(scopePath(ai, "dashboards")).toBe("/p/ai/dashboards");
    expect(scopePath({ kind: "all" }, "dashboards")).toBe("/all/dashboards");
  });

  it("GivenNothingStored_WhenLoaded_ThenAllProjects", () => {
    expect(loadScope()).toEqual({ kind: "all" });
  });

  it("GivenAProjectSaved_WhenLoaded_ThenThatProject", () => {
    saveScope({ kind: "project", projectId: "ai" });
    expect(loadScope()).toEqual({ kind: "project", projectId: "ai" });
    saveScope({ kind: "all" });
    expect(loadScope()).toEqual({ kind: "all" });
  });

  it("GivenAMalformedProjectId_WhenSavedOrLoaded_ThenItIsIgnored", () => {
    saveScope({ kind: "project", projectId: "ai" });
    saveScope({ kind: "project", projectId: "../evil" });
    expect(loadScope()).toEqual({ kind: "project", projectId: "ai" });
    window.localStorage.setItem("andy.scope", "p:<script>");
    expect(loadScope()).toEqual({ kind: "all" });
  });
});
