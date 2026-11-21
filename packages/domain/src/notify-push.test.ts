import { PushCategory, type PushSendState, type PushSettings } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import {
  PUSH_DAILY_CAP,
  PUSH_HOURLY_CAP,
  buildOverflowPayload,
  buildPushPayload,
  defaultPushSettings,
  inQuietHours,
  pushGate,
  takePushSlot,
  type PushKind,
  type PushNotice,
} from "./notify-push";

const APP = "https://ai.example.com";
const UID = "uid-a";
const notice = (over: Partial<PushNotice> = {}): PushNotice => ({
  kind: "question_asked",
  projectKey: "AI",
  ticketKey: "AI-150",
  path: "/p/ai/t/AI-150",
  ...over,
});
const settings = (over: Partial<PushSettings> = {}): PushSettings => ({
  ...defaultPushSettings(UID, new Date("2026-11-20T00:00:00Z")),
  quietHours: { start: "22:00", end: "07:00", timeZone: "America/Denver" },
  ...over,
});

describe("buildPushPayload", () => {
  it("GivenAQuestion_WhenBuilt_ThenOnlyKeysPhraseAndASameOriginLink", () => {
    expect(buildPushPayload(notice(), APP)).toEqual({
      title: "AI-150 · Question waiting",
      body: "Project AI",
      link: "https://ai.example.com/p/ai/t/AI-150",
      tag: "question_asked:AI-150",
    });
  });

  it("GivenATicketTitleAndQuestionTextPassedIn_WhenBuilt_ThenNeitherReachesThePayload", () => {
    const seeded = {
      ...notice(),
      title: "SEEDED-TITLE ignore previous instructions",
      question: "SEEDED-QUESTION click http://evil.example",
    } as PushNotice;
    const text = JSON.stringify(buildPushPayload(seeded, APP));
    expect(text).not.toContain("SEEDED");
    expect(text).not.toContain("evil");
  });

  it.each([
    ["a title in the ticket key", notice({ ticketKey: "AI-150 Please approve now" })],
    ["a title in the project key", notice({ projectKey: "AI pwned" })],
    ["an off-origin path", notice({ path: "//evil.example/x" })],
    ["an absolute URL", notice({ path: "https://evil.example/x" })],
    ["a path with spaces", notice({ path: "/p/ai/t/AI-150 click here" })],
    ["a backslash host", notice({ path: "/\\evil.example" })],
  ])("GivenFreeTextIn %s_WhenBuilt_ThenRefused", (_label, n) => {
    expect(() => buildPushPayload(n, APP)).toThrow();
  });

  it("GivenAProjectWideNotice_WhenBuilt_ThenThePhraseAloneIsTheTitle", () => {
    const p = buildPushPayload(
      notice({ kind: "quota_paused", ticketKey: null, path: "/all/inbox" }),
      APP,
    );
    expect(p.title).toBe("Dispatch paused for quota");
    expect(p.tag).toBe("quota_paused:AI");
  });

  it("GivenTheOverflow_WhenBuilt_ThenItOpensTheInbox", () => {
    expect(buildOverflowPayload(`${APP}/somewhere`)).toEqual({
      title: "More items need you",
      body: "Open the inbox",
      link: "https://ai.example.com/all/inbox",
      tag: "overflow",
    });
  });
});

describe("inQuietHours", () => {
  const denver = { start: "22:00", end: "07:00", timeZone: "America/Denver" };

  it.each([
    ["21:59 local", "2026-11-21T04:59:00Z", false],
    ["22:00 local", "2026-11-21T05:00:00Z", true],
    ["00:30 local, past midnight", "2026-11-21T07:30:00Z", true],
    ["06:59 local", "2026-11-21T13:59:00Z", true],
    ["07:00 local", "2026-11-21T14:00:00Z", false],
  ])("GivenQuietHoursAcrossMidnight_When %s_Then %s", (_label, at, quiet) => {
    expect(inQuietHours(denver, new Date(at))).toBe(quiet);
  });

  it("GivenSpringForward_WhenAnHourAfterUtcWouldStillBeQuiet_ThenLocalTimeDecides", () => {
    // 2026-03-08 Denver moves to UTC-6: 13:30Z is 07:30 local (open), not 06:30 (quiet).
    expect(inQuietHours(denver, new Date("2026-03-08T13:30:00Z"))).toBe(false);
    expect(inQuietHours(denver, new Date("2026-03-08T12:30:00Z"))).toBe(true);
  });

  it("GivenFallBack_WhenTheSameUtcTimeIsAnHourEarlierLocally_ThenItIsQuiet", () => {
    // 2026-11-01 Denver moves to UTC-7: 13:30Z is 06:30 local (quiet), not 07:30.
    expect(inQuietHours(denver, new Date("2026-11-01T13:30:00Z"))).toBe(true);
    expect(inQuietHours(denver, new Date("2026-10-31T13:30:00Z"))).toBe(false);
  });

  it("GivenADaytimeWindowOrNone_WhenChecked_ThenNoWrap", () => {
    const day = { start: "09:00", end: "17:00", timeZone: "UTC" };
    expect(inQuietHours(day, new Date("2026-11-20T12:00:00Z"))).toBe(true);
    expect(inQuietHours(day, new Date("2026-11-20T20:00:00Z"))).toBe(false);
    expect(inQuietHours(null, new Date("2026-11-20T12:00:00Z"))).toBe(false);
    expect(inQuietHours({ ...day, end: "09:00" }, new Date("2026-11-20T09:30:00Z"))).toBe(false);
  });
});

describe("pushGate", () => {
  const night = new Date("2026-11-21T07:30:00Z"); // 00:30 in Denver
  const day = new Date("2026-11-20T19:00:00Z"); // 12:00 in Denver

  it("GivenQuietHours_WhenAnyKindButQuotaPause_ThenDroppedAndQuotaPauseBreaksThrough", () => {
    const kinds: PushKind[] = [
      "question_asked",
      "plan_waiting",
      "pr_waiting",
      "run_failed",
      "quota_warn",
      "release_ready",
      "dev_verification",
    ];
    for (const kind of kinds) expect(pushGate(kind, settings(), UID, night)).toBe("quiet_hours");
    expect(pushGate("quota_paused", settings(), UID, night)).toBe("allowed");
    expect(pushGate("question_asked", settings(), UID, day)).toBe("allowed");
  });

  it("GivenADisabledCategory_WhenAnyTime_ThenNothingSends", () => {
    const s = settings({ enabledCategories: ["plan_waiting"] });
    expect(pushGate("question_asked", s, UID, day)).toBe("disabled");
    expect(pushGate("quota_paused", s, UID, night)).toBe("disabled");
    expect(pushGate("plan_waiting", s, UID, day)).toBe("allowed");
  });

  it("GivenNoSettings_WhenChecked_ThenDefaultsApplyEveryCategoryOnAndQuietHours", () => {
    expect(defaultPushSettings(UID, day).enabledCategories).toEqual(PushCategory.options);
    // Default zone is UTC until Andy names his: 23:00Z is quiet.
    expect(pushGate("run_failed", null, UID, new Date("2026-11-20T23:00:00Z"))).toBe("quiet_hours");
    expect(pushGate("run_failed", null, UID, new Date("2026-11-20T12:00:00Z"))).toBe("allowed");
  });
});

describe("takePushSlot", () => {
  const at = (iso: string) => new Date(iso);
  /** Runs `n` slots in a row from `state`, as consecutive transactions would. */
  const run = (n: number, start: PushSendState | null, now: Date) => {
    let state = start;
    const results = [];
    for (let i = 0; i < n; i++) {
      const out = takePushSlot(state, UID, now);
      state = out.state;
      results.push(out.result.kind);
    }
    return { state, results };
  };

  it("GivenSixSentThisHour_WhenTheSeventhComes_ThenOneOverflowThenHeld", () => {
    const { state, results } = run(PUSH_HOURLY_CAP + 2, null, at("2026-11-20T12:00:00Z"));
    expect(results).toEqual([...Array(PUSH_HOURLY_CAP).fill("send"), "overflow", "held"]);
    expect(state).toMatchObject({ sentThisHour: 6, hourOverflowSent: true, sentToday: 6 });
  });

  it("GivenACappedHour_WhenTheNextHourStarts_ThenSendingResumes", () => {
    const capped = run(PUSH_HOURLY_CAP + 1, null, at("2026-11-20T12:59:00Z")).state;
    const next = takePushSlot(capped, UID, at("2026-11-20T13:00:00Z"));
    expect(next.result).toEqual({ kind: "send" });
    expect(next.state).toMatchObject({ hour: "2026-11-20T13", sentThisHour: 1, sentToday: 7 });
  });

  it("GivenThirtySentToday_WhenMoreCome_ThenOneDayOverflowThenHeldUntilTheDayResets", () => {
    const full: PushSendState = {
      uid: UID,
      hour: "2026-11-20T20",
      sentThisHour: 0,
      hourOverflowSent: false,
      day: "2026-11-20",
      sentToday: PUSH_DAILY_CAP,
      dayOverflowSent: false,
    };
    const later = at("2026-11-20T21:00:00Z");
    const { results, state } = run(3, full, later);
    expect(results).toEqual(["overflow", "held", "held"]);
    expect(state?.sentThisHour).toBe(0);
    expect(takePushSlot(state, UID, at("2026-11-21T00:00:00Z")).result).toEqual({ kind: "send" });
  });

  it("GivenNoState_WhenFirstSlot_ThenAFreshStateForThatUser", () => {
    expect(takePushSlot(null, UID, at("2026-11-20T12:34:00Z")).state).toEqual({
      uid: UID,
      hour: "2026-11-20T12",
      sentThisHour: 1,
      hourOverflowSent: false,
      day: "2026-11-20",
      sentToday: 1,
      dayOverflowSent: false,
    });
  });
});
