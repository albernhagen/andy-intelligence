import { describe, expect, it } from "vitest";
import { PACKAGE_LIMITS, PackageName, PackageWorkspace, PlanPackages } from "./packages";
import { BuildPlan } from "./index";

const pkg = (name: string, workspace = ".") => ({
  name,
  kind: "runtime" as const,
  workspace,
  why: "The ticket needs it.",
});

describe("PackageName (AI-386)", () => {
  it("GivenPlainAndScopedNames_WhenParsed_ThenTheyAreAccepted", () => {
    for (const name of ["zod", "date-fns", "@scope/pkg", "lodash.merge", "a_b"]) {
      expect(PackageName.safeParse(name).success).toBe(true);
    }
  });

  it("GivenAVersionUrlOrAlias_WhenParsed_ThenItIsRejected", () => {
    for (const name of [
      "zod@3",
      "zod@latest",
      "npm:zod",
      "git+https://github.com/x/y",
      "file:../x",
      "https://x.test/y.tgz",
      "../x",
      "Zod",
      "-rf",
      "--registry=https://evil.test",
      "@scope",
      "",
      "a b",
    ]) {
      expect(PackageName.safeParse(name).success, name).toBe(false);
    }
  });

  it("GivenANameLongerThanNpmAllows_WhenParsed_ThenItIsRejected", () => {
    expect(PackageName.safeParse("a".repeat(PACKAGE_LIMITS.name + 1)).success).toBe(false);
  });
});

describe("PackageWorkspace (AI-386)", () => {
  it("GivenTheRootOrARepoRelativeDir_WhenParsed_ThenItIsAccepted", () => {
    for (const w of [".", "apps/web", "packages/domain"]) {
      expect(PackageWorkspace.safeParse(w).success, w).toBe(true);
    }
  });

  it("GivenAnEscapeOrAbsolutePath_WhenParsed_ThenItIsRejected", () => {
    for (const w of ["..", "../x", "apps/../..", "/etc", "./apps/web", "apps/web/", "", "-w"]) {
      expect(PackageWorkspace.safeParse(w).success, w).toBe(false);
    }
  });
});

describe("PlanPackages (AI-386)", () => {
  it("GivenMorePackagesThanTheCap_WhenParsed_ThenThePlanIsRejected", () => {
    const many = Array.from({ length: PACKAGE_LIMITS.maxPackages + 1 }, (_, i) => pkg(`p${i}`));
    expect(PlanPackages.safeParse(many).success).toBe(false);
    expect(PlanPackages.safeParse(many.slice(0, PACKAGE_LIMITS.maxPackages)).success).toBe(true);
  });

  it("GivenTheSamePackageTwice_WhenParsed_ThenThePlanIsRejected", () => {
    expect(PlanPackages.safeParse([pkg("zod"), pkg("zod", "apps/web")]).success).toBe(false);
  });

  it("GivenAPlanWithoutPackages_WhenParsed_ThenPackagesAreEmpty", () => {
    const plan = BuildPlan.parse({
      files: ["a.ts"],
      steps: ["do it"],
      tests: [],
      riskiestStep: "none",
      rejectedAlternatives: [],
    });
    expect(plan.packages).toEqual([]);
  });
});
