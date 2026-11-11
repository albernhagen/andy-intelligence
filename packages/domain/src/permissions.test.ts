import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { EventActor } from "@andy/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  OWNER_ACTIONS,
  OWNER_LABEL,
  actorLabel,
  can,
  isOwner,
  requireCan,
  userActor,
  type OwnerAction,
} from "./permissions";

const actions = Object.keys(OWNER_ACTIONS) as OwnerAction[];

describe("permissions", () => {
  it.each(["andy", "user:uid-1"])(
    "GivenTheOwnerAs%s_WhenAskingForEveryOwnerAction_ThenAllowed",
    (actor) => {
      for (const action of actions) expect(can(actor, action, "ai")).toBe(true);
      expect(() => requireCan(actor, "cancel_ticket", "ai")).not.toThrow();
    },
  );

  it.each(["system", "agent:run-1"])(
    "GivenTheActor%s_WhenAskingForEveryOwnerAction_ThenRefused",
    (actor) => {
      for (const action of actions) expect(can(actor, action, "ai")).toBe(false);
    },
  );

  it("GivenAnAgent_WhenRequireCan_ThenForbiddenWithTheOwnerWordingAndAWarningLog", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(() => requireCan("agent:run-1", "archive_ticket", "ai")).toThrowError(
      expect.objectContaining({
        name: "DomainError",
        code: "forbidden",
        message: "only the owner can archive a ticket",
      }),
    );
    const entry = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(entry).toMatchObject({
      severity: "WARNING",
      action: "archive_ticket",
      actor: "agent:run-1",
    });
    log.mockRestore();
  });

  it("GivenAUid_WhenMadeAnActor_ThenItIsAValidStoredActorThatIsTheOwner", () => {
    const actor = userActor("uid-1");
    expect(actor).toBe("user:uid-1");
    expect(EventActor.parse(actor)).toBe(actor);
    expect(isOwner(actor)).toBe(true);
    expect(() => userActor("")).toThrow();
  });

  it("GivenStoredActors_WhenLabelled_ThenTheOwnerReadsAsTheLabelAndOthersAsStored", () => {
    expect(actorLabel("andy")).toBe(OWNER_LABEL);
    expect(actorLabel("user:uid-1")).toBe(OWNER_LABEL);
    expect(actorLabel("system")).toBe("system");
    expect(actorLabel("agent:run-1")).toBe("agent:run-1");
  });

  it("GivenTheStoredActorSchema_WhenParsingOldAndNewForms_ThenBothAreValidAndOthersAreNot", () => {
    for (const ok of ["andy", "system", "agent:r1", "user:uid-1"]) {
      expect(EventActor.safeParse(ok).success).toBe(true);
    }
    for (const bad of ["Andy", "user:", "andy@example.com", ""]) {
      expect(EventActor.safeParse(bad).success).toBe(false);
    }
  });

  // `isOwner` trusts the `user:` prefix, so only `userActor` may build one, and only the auth
  // adapter (after the allow-list) may call it (AI-19 review). This scan keeps it that way.
  it("GivenTheSource_WhenScanned_ThenOnlyTheAuthAdapterMakesUserActors", () => {
    const root = fileURLToPath(new URL("../../..", import.meta.url));
    const files = ["packages", "apps"].flatMap((top) =>
      readdirSync(join(root, top), { recursive: true, encoding: "utf8" })
        .filter((f) => /\/src\/.*\.tsx?$/.test(f) && !/\.test\.tsx?$|node_modules|\.gen\./.test(f))
        .map((f) => join(root, top, f)),
    );
    const code = (file: string) =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
    const literal = files.filter(
      (f) => !f.endsWith("permissions.ts") && code(f).some((l) => /["'`]user:/.test(l)),
    );
    const callers = files.filter(
      (f) => !f.endsWith("permissions.ts") && code(f).some((l) => /\buserActor\(/.test(l)),
    );
    expect(files.length).toBeGreaterThan(50);
    expect(literal.map((f) => relative(root, f))).toEqual([]);
    expect(callers.map((f) => relative(root, f))).toEqual(["apps/api/src/auth.ts"]);
  });
});
