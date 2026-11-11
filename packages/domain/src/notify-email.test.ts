import {
  InMemoryNotifyFlushQueue,
  InMemoryNotifyLedger,
  InMemoryWorkTracker,
  type Notice,
  type PendingNotice,
  type Question,
} from "@andy/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  EMAIL_BATCH_WINDOW_MS,
  EMAIL_DAILY_CAP,
  EmailNotifications,
  addPending,
  composeEmail,
  needsYouLine,
  notifyOnNeedsYou,
  plainLine,
  takeDue,
} from "./notify-email";

const T0 = new Date("2026-11-10T12:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const APP = "https://ai.example.test";

const item = (n: number, projectId = "ai"): PendingNotice => ({
  projectId,
  ticketId: `t${n}`,
  key: `AI-${n}`,
  title: `Ticket ${n}`,
  line: `Question: what about ${n}?`,
  link: `${APP}/p/ai/t/AI-${n}`,
});

describe("addPending / takeDue", () => {
  it("GivenNoWindow_WhenAnItemArrives_ThenAWindowOpensForTenMinutes", () => {
    const { state, result } = addPending(null, item(1), T0);
    expect(result).toEqual({ kind: "opened", flushAt: at(EMAIL_BATCH_WINDOW_MS).toISOString() });
    expect(state.pending).toHaveLength(1);
  });

  it("GivenAnOpenWindow_WhenTheSameTicketArrivesAgain_ThenDuplicate", () => {
    const s = addPending(null, item(1), T0).state;
    expect(addPending(s, item(1), at(1000)).result).toEqual({ kind: "duplicate" });
  });

  it("GivenAWindowNotYetEnded_WhenTaken_ThenEarlyAndUnchanged", () => {
    const s = addPending(null, item(1), T0).state;
    const { state, result } = takeDue(s, at(EMAIL_BATCH_WINDOW_MS - 1));
    expect(result).toEqual({ kind: "early" });
    expect(state).toEqual(s);
  });

  it("GivenThreeItemsInAWindow_WhenItEnds_ThenOneBatchHoldsAllThree", () => {
    let s = addPending(null, item(1), T0).state;
    s = addPending(s, item(2), at(60_000)).state;
    s = addPending(s, item(3), at(120_000)).state;
    const { state, result } = takeDue(s, at(EMAIL_BATCH_WINDOW_MS));
    expect(result).toMatchObject({ kind: "batch", batch: { kind: "items", extra: 0 } });
    expect(
      result.kind === "batch" && result.batch.kind === "items" && result.batch.items,
    ).toHaveLength(3);
    expect(state).toMatchObject({ sent: 1, pending: [], windowEndsAt: null });
  });

  it("GivenTheCapIsReached_WhenTheNextWindowEnds_ThenMoreWaitingOnceThenNothing", () => {
    let s = { ...addPending(null, item(1), T0).state, sent: EMAIL_DAILY_CAP };
    const first = takeDue(s, at(EMAIL_BATCH_WINDOW_MS));
    expect(first.result).toEqual({ kind: "batch", batch: { kind: "more_waiting", count: 1 } });
    s = first.state;
    expect(s.overflowSent).toBe(true);
    expect(addPending(s, item(2), at(EMAIL_BATCH_WINDOW_MS + 1)).result).toEqual({
      kind: "over_cap",
    });
  });

  it("GivenYesterdaysCapWasReached_WhenANewUtcDayStarts_ThenTheCountResets", () => {
    const s = {
      ...addPending(null, item(1), T0).state,
      sent: EMAIL_DAILY_CAP,
      overflowSent: true,
      pending: [],
      windowEndsAt: null,
    };
    const next = addPending(s, item(2), new Date("2026-11-11T00:01:00.000Z"));
    expect(next.result.kind).toBe("opened");
    expect(next.state).toMatchObject({ day: "2026-11-11", sent: 0, overflowSent: false });
  });

  it("GivenAWindowThatWasNeverFlushed_WhenAnItemArrivesAfterItEnds_ThenOverdue", () => {
    const s = addPending(null, item(1), T0).state;
    expect(addPending(s, item(2), at(EMAIL_BATCH_WINDOW_MS + 5)).result).toEqual({
      kind: "overdue",
    });
  });
});

describe("plainLine / composeEmail", () => {
  it("GivenAgentTextWithNewlinesAndLinks_WhenMadePlain_ThenOneLineWithoutLinks", () => {
    const text = "Pick one\r\nSubject: hi see https://evil.example/x or www.evil.example";
    expect(plainLine(text)).toBe("Pick one Subject: hi see [link removed] or [link removed]");
  });

  it("GivenLongText_WhenMadePlain_ThenCapped", () => {
    expect(plainLine("x".repeat(500))).toHaveLength(200);
  });

  it("GivenOneItem_WhenComposed_ThenTheSubjectNamesTheKeyAndNoAgentText", () => {
    const evil = {
      ...item(7),
      title: "URGENT reset your password",
      line: "Question: click http://x.example",
    };
    const notice = composeEmail({ kind: "items", items: [evil], extra: 0 }, APP) as Notice;
    expect(notice.title).toBe("andy-intelligence: AI-7 needs you");
    expect(notice.body).toContain("AI-7: URGENT reset your password");
    expect(notice.body).toContain("Question: click [link removed]");
    expect(notice.body).toContain(`${APP}/p/ai/t/AI-7`);
  });

  it("GivenADroppedBatch_WhenComposed_ThenNoEmail", () => {
    expect(composeEmail({ kind: "dropped", count: 2 }, APP)).toBeNull();
  });
});

describe("needsYouLine", () => {
  const q = (text: string, extra: object = {}) => ({ text, ...extra }) as Question;

  it("GivenNoOpenQuestion_WhenLined_ThenAGenericReason", () => {
    expect(needsYouLine([])).toMatch(/^Waiting for you/);
  });

  it("GivenAPlainQuestionLine_WhenLined_ThenItIsPreferredOverText", () => {
    expect(needsYouLine([q("long text", { question: "Short?" }), q("b")])).toBe(
      "Question: Short? (+1 more question)",
    );
  });
});

async function setup() {
  const tracker = new InMemoryWorkTracker();
  await tracker.createProject({ key: "AI", name: "AI", repos: ["o/r"], autonomy: "gated" });
  const ledger = new InMemoryNotifyLedger();
  const queue = new InMemoryNotifyFlushQueue();
  const sent: Notice[] = [];
  let now = T0;
  const notifications = new EmailNotifications({
    tracker,
    ledger,
    notifier: { notify: async (n) => void sent.push(n) },
    flushQueue: queue,
    appUrl: APP,
    now: () => now,
  });
  const flagged = notifyOnNeedsYou(tracker, (t) => notifications.ticketNeedsYou(t));
  const ticket = await tracker.createTicket("ai", { type: "feature", title: "One" }, "andy");
  return {
    tracker,
    flagged,
    notifications,
    ledger,
    queue,
    sent,
    ticket,
    setNow: (d: Date) => (now = d),
  };
}

describe("EmailNotifications", () => {
  it("GivenAnAgentFlagsATicket_WhenTheWindowFlushes_ThenOneEmailWithItsQuestion", async () => {
    const { tracker, flagged, notifications, queue, sent, ticket, setNow } = await setup();
    await tracker.askQuestion("ai", ticket.id, { text: "Which one?", options: [] }, "agent:r1");
    await flagged.updateTicket("ai", ticket.id, { fields: { needsAttention: true } }, "agent:r1");
    expect([...queue.scheduled]).toEqual([at(EMAIL_BATCH_WINDOW_MS).toISOString()]);
    expect(await notifications.flush()).toBe("early");
    setNow(at(EMAIL_BATCH_WINDOW_MS));
    expect(await notifications.flush()).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toContain("Question: Which one?");
    expect(await notifications.flush()).toBe("none");
  });

  it("GivenAndyFlagsATicketHimself_WhenUpdated_ThenNoEmailIsQueued", async () => {
    const { flagged, ledger, ticket } = await setup();
    await flagged.updateTicket("ai", ticket.id, { fields: { needsAttention: true } }, "andy");
    expect(await ledger.get()).toBeNull();
  });

  it("GivenATicketAlreadyFlagged_WhenFlaggedAgain_ThenNothingNewIsQueued", async () => {
    const { flagged, ledger, ticket } = await setup();
    await flagged.updateTicket("ai", ticket.id, { fields: { needsAttention: true } }, "system");
    await flagged.updateTicket("ai", ticket.id, { fields: { needsAttention: true } }, "system");
    expect((await ledger.get())?.pending).toHaveLength(1);
  });

  it("GivenTheProjectTurnedEmailOff_WhenFlagged_ThenNothingIsQueued", async () => {
    const { tracker, flagged, ledger, ticket } = await setup();
    await tracker.updateProject("ai", { emailNotifications: false });
    await flagged.updateTicket("ai", ticket.id, { fields: { needsAttention: true } }, "system");
    expect(await ledger.get()).toBeNull();
  });

  it("GivenTheSenderFails_WhenFlushed_ThenFailedIsLoggedAndTheWriteStillWorked", async () => {
    const tracker = new InMemoryWorkTracker();
    await tracker.createProject({ key: "AI", name: "AI", repos: ["o/r"], autonomy: "gated" });
    let now = T0;
    const n = new EmailNotifications({
      tracker,
      ledger: new InMemoryNotifyLedger(),
      notifier: { notify: async () => Promise.reject(new Error("503")) },
      flushQueue: new InMemoryNotifyFlushQueue(),
      appUrl: APP,
      now: () => now,
    });
    const t = await tracker.createTicket("ai", { type: "feature", title: "x" }, "andy");
    const flagged = notifyOnNeedsYou(tracker, (x) => n.ticketNeedsYou(x));
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const after = await flagged.updateTicket(
      "ai",
      t.id,
      { fields: { needsAttention: true } },
      "system",
    );
    expect(after.needsAttention).toBe(true);
    now = at(EMAIL_BATCH_WINDOW_MS);
    expect(await n.flush()).toBe("failed");
    expect(spy.mock.calls.some(([line]) => String(line).includes("email send failed"))).toBe(true);
    spy.mockRestore();
  });

  it("GivenTheCapIsReached_WhenATestIsSent_ThenRefused", async () => {
    const { notifications, ledger, sent } = await setup();
    await ledger.update(() => ({
      state: {
        day: "2026-11-10",
        sent: EMAIL_DAILY_CAP,
        overflowSent: false,
        pending: [],
        pendingExtra: 0,
        windowEndsAt: null,
      },
      result: null,
    }));
    expect(await notifications.sendTest()).toBe("cap_reached");
    expect(sent).toHaveLength(0);
  });
});
