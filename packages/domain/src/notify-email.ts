import {
  NOTIFY_PENDING_MAX,
  type EmailNotifyState,
  type EventActor,
  type Notice,
  type Notifier,
  type NotifyFlushQueue,
  type NotifyLedger,
  type PendingNotice,
  type Question,
  type Ticket,
  type TicketChange,
  type WorkTracker,
} from "@andy/contracts";
import { isOwner } from "./permissions";

/**
 * Email for the Needs-you inbox (AI-77, ADR-0060). When a ticket starts to need Andy, it waits
 * in a batching window; when the window ends, everything in it goes out as one plain-text email
 * through the `Notifier` port. Caps (ADR-0028) bound the spend and the noise.
 */

/** Emails a UTC day, the one "more waiting" email excluded (ADR-0028). */
export const EMAIL_DAILY_CAP = 20;
/** Items that start to need Andy within this window go out in one email (ADR-0028). */
export const EMAIL_BATCH_WINDOW_MS = 10 * 60_000;
/** Longest question line or title an email quotes; agent text, so capped. */
const LINE_MAX = 200;

const log = (severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object = {}) =>
  console.log(JSON.stringify({ severity, message, component: "notify-email", ...fields }));

const utcDay = (now: Date) => now.toISOString().slice(0, 10);

const fresh = (now: Date): EmailNotifyState => ({
  day: utcDay(now),
  sent: 0,
  overflowSent: false,
  pending: [],
  pendingExtra: 0,
  windowEndsAt: null,
});

/** A new UTC day resets the count; the open window carries over. */
function rollDay(state: EmailNotifyState | null, now: Date): EmailNotifyState {
  if (!state) return fresh(now);
  if (state.day === utcDay(now)) return state;
  return { ...state, day: utcDay(now), sent: 0, overflowSent: false };
}

export type AddOutcome =
  | { kind: "opened"; flushAt: string }
  | { kind: "queued" }
  | { kind: "duplicate" }
  | { kind: "over_cap" }
  /** The window ended and nobody flushed it (a lost flush): flush now. */
  | { kind: "overdue" };

/** Puts an item in the window, opening one if none is open. Pure: runs inside a transaction. */
export function addPending(
  state: EmailNotifyState | null,
  item: PendingNotice,
  now: Date,
): { state: EmailNotifyState; result: AddOutcome } {
  const s = rollDay(state, now);
  if (s.overflowSent) return { state: s, result: { kind: "over_cap" } };
  // A window whose flush never came (queue down, lost task) goes out on the next item.
  const overdue = s.windowEndsAt !== null && Date.parse(s.windowEndsAt) <= now.getTime();
  const known = s.pending.some(
    (p) => p.projectId === item.projectId && p.ticketId === item.ticketId,
  );
  if (known) return { state: s, result: overdue ? { kind: "overdue" } : { kind: "duplicate" } };
  const full = s.pending.length >= NOTIFY_PENDING_MAX;
  const next: EmailNotifyState = {
    ...s,
    pending: full ? s.pending : [...s.pending, item],
    pendingExtra: full ? s.pendingExtra + 1 : s.pendingExtra,
  };
  if (s.windowEndsAt === null) {
    const flushAt = new Date(now.getTime() + EMAIL_BATCH_WINDOW_MS).toISOString();
    return { state: { ...next, windowEndsAt: flushAt }, result: { kind: "opened", flushAt } };
  }
  return { state: next, result: overdue ? { kind: "overdue" } : { kind: "queued" } };
}

export type Batch =
  | { kind: "items"; items: PendingNotice[]; extra: number }
  /** The cap is reached: one email saying more is waiting, then nothing until the next day. */
  | { kind: "more_waiting"; count: number }
  | { kind: "dropped"; count: number };

export type TakeOutcome = { kind: "none" } | { kind: "early" } | { kind: "batch"; batch: Batch };

/** Empties the window if it has ended, deciding under the caps what goes out. Pure. */
export function takeDue(
  state: EmailNotifyState | null,
  now: Date,
): { state: EmailNotifyState; result: TakeOutcome } {
  const s = rollDay(state, now);
  if (s.windowEndsAt === null) return { state: s, result: { kind: "none" } };
  if (Date.parse(s.windowEndsAt) > now.getTime()) return { state: s, result: { kind: "early" } };
  const emptied = { ...s, pending: [], pendingExtra: 0, windowEndsAt: null };
  const count = s.pending.length + s.pendingExtra;
  if (count === 0) return { state: emptied, result: { kind: "none" } };
  if (s.sent < EMAIL_DAILY_CAP) {
    const batch: Batch = { kind: "items", items: s.pending, extra: s.pendingExtra };
    return { state: { ...emptied, sent: s.sent + 1 }, result: { kind: "batch", batch } };
  }
  if (!s.overflowSent) {
    const batch: Batch = { kind: "more_waiting", count };
    return { state: { ...emptied, overflowSent: true }, result: { kind: "batch", batch } };
  }
  return { state: emptied, result: { kind: "batch", batch: { kind: "dropped", count } } };
}

/** Dots an email client reads as a domain's dot: ASCII, ideographic, fullwidth, halfwidth. */
const DOTS = /[.\u3002\uff0e\uff61]/g;
/** A host-like token: labels of letters, digits or hyphens, ending in a letter label (any script). */
const HOST =
  /(?<![\p{L}\p{N}-])(?:[\p{L}\p{N}-]+[.\u3002\uff0e\uff61])+\p{L}{2,}(?![\p{L}\p{N}-])/gu;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;

/**
 * Agent-written text made safe for a plain-text body: one line (no forged headers or extra
 * lines), no control characters, no links (the email's only link is the one we write), capped.
 * Scheme, `www.` and `mailto:` links are removed; bare hosts (`evil.example/login`, `README.md`,
 * an IP) are defanged to `evil[.]example/login`, so no client auto-links them but they still read.
 */
export function plainLine(text: string, max = LINE_MAX): string {
  const defang = (host: string) => host.replace(DOTS, "[.]");
  const line = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
    .replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.|mailto:)\S*/gi, "[link removed]")
    .replace(HOST, defang)
    .replace(IPV4, defang)
    .replace(/\s+/g, " ")
    .trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** The email for a batch. The subject holds no agent text: counts and fixed words only. */
export function composeEmail(batch: Batch, appUrl: string): Notice | null {
  if (batch.kind === "dropped") return null;
  if (batch.kind === "more_waiting") {
    return {
      title: "andy-intelligence: more items need you",
      body: [
        `${batch.count} more item${batch.count === 1 ? "" : "s"} need you.`,
        `That is past today's ${EMAIL_DAILY_CAP} emails, so no more email until tomorrow (UTC).`,
        "",
        `Inbox: ${appUrl}/all/inbox`,
      ].join("\n"),
      urgency: "normal",
      link: `${appUrl}/all/inbox`,
    };
  }
  const total = batch.items.length + batch.extra;
  const lines = batch.items.flatMap((item) => [
    `${item.key}: ${plainLine(item.title)}`,
    `  ${plainLine(item.line)}`,
    `  ${item.link}`,
    "",
  ]);
  if (batch.extra > 0) lines.push(`…and ${batch.extra} more.`, "");
  lines.push(`Inbox: ${appUrl}/all/inbox`);
  const only = batch.items.length === 1 && batch.extra === 0 ? batch.items[0] : null;
  return {
    title: only
      ? `andy-intelligence: ${only.key} needs you`
      : `andy-intelligence: ${total} items need you`,
    body: lines.join("\n"),
    urgency: "normal",
    link: only ? only.link : `${appUrl}/all/inbox`,
  };
}

/** The line an email shows for a ticket: its first open question, or why it waits. */
export function needsYouLine(open: readonly Question[]): string {
  const first = open[0];
  if (!first) return "Waiting for you: open the ticket to see why.";
  // The question line is `text`, also under AI-73's question format.
  const text = first.text;
  const more =
    open.length > 1 ? ` (+${open.length - 1} more question${open.length > 2 ? "s" : ""})` : "";
  return `Question: ${plainLine(text)}${more}`;
}

export type FlushOutcome = "none" | "early" | "sent" | "more_waiting" | "dropped" | "failed";

export interface EmailNotificationsDeps {
  tracker: WorkTracker;
  ledger: NotifyLedger;
  notifier: Notifier;
  /** Where the window's flush is delivered; null: an in-process timer (local dev). */
  flushQueue: NotifyFlushQueue | null;
  /** The app's public origin, for links. */
  appUrl: string;
  now?: () => Date;
}

/** The email notifier's rules: what goes in a window, when it flushes, what the caps allow. */
export class EmailNotifications {
  private readonly now: () => Date;

  constructor(private readonly deps: EmailNotificationsDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** A ticket started to need Andy. Never throws: email must not break the write that flagged it. */
  async ticketNeedsYou(ticket: Ticket): Promise<void> {
    try {
      const project = await this.deps.tracker.getProject(ticket.projectId);
      if (!project?.emailNotifications || ticket.archived) return;
      const open = await this.deps.tracker.listQuestions({
        projectId: ticket.projectId,
        ticketId: ticket.id,
        status: "open",
      });
      const item: PendingNotice = {
        projectId: ticket.projectId,
        ticketId: ticket.id,
        key: ticket.key,
        title: plainLine(ticket.title, 300),
        line: needsYouLine(open),
        link: `${this.deps.appUrl}/p/${encodeURIComponent(ticket.projectId)}/t/${ticket.key}`,
      };
      const now = this.now();
      const outcome = await this.deps.ledger.update((s) => addPending(s, item, now));
      log("INFO", "needs-you item queued for email", { key: ticket.key, outcome: outcome.kind });
      if (outcome.kind === "opened") await this.scheduleFlushOrTimer(outcome.flushAt);
      if (outcome.kind === "overdue") await this.flush();
    } catch (err) {
      log("ERROR", "email notification failed", { key: ticket.key, error: String(err) });
    }
  }

  /** Sends the window's batch if it has ended. Idempotent: a second call finds it empty. */
  async flush(): Promise<FlushOutcome> {
    const now = this.now();
    const taken = await this.deps.ledger.update((s) => takeDue(s, now));
    if (taken.kind !== "batch") return taken.kind;
    const { batch } = taken;
    const notice = composeEmail(batch, this.deps.appUrl);
    if (!notice) {
      log("WARNING", "email cap reached: items not emailed", {
        count: batch.kind === "dropped" ? batch.count : 0,
      });
      return "dropped";
    }
    try {
      await this.deps.notifier.notify(notice);
    } catch (err) {
      // Not retried: the items stay in the Needs-you inbox, only the email is lost.
      const keys = batch.kind === "items" ? batch.items.map((i) => i.key) : [];
      log("ERROR", "email send failed", { keys, error: String(err) });
      if (batch.kind === "items") await this.release(now);
      return "failed";
    }
    log("INFO", "email sent", {
      kind: batch.kind,
      count: batch.kind === "items" ? batch.items.length + batch.extra : batch.count,
    });
    return batch.kind === "items" ? "sent" : "more_waiting";
  }

  /**
   * A test email from the settings page. A slot of the daily cap is held while it sends and
   * given back if the provider refuses (bad key, unverified domain), so only a sent test counts.
   */
  async sendTest(): Promise<
    { result: "sent" } | { result: "cap_reached" } | { result: "failed"; error: string }
  > {
    const now = this.now();
    const allowed = await this.deps.ledger.update((state) => {
      const s = rollDay(state, now);
      if (s.sent >= EMAIL_DAILY_CAP) return { state: s, result: false };
      return { state: { ...s, sent: s.sent + 1 }, result: true };
    });
    if (!allowed) return { result: "cap_reached" };
    try {
      await this.deps.notifier.notify({
        title: "andy-intelligence: test email",
        body: `Email notifications work. Needs-you items will arrive like this.\n\nInbox: ${this.deps.appUrl}/all/inbox`,
        urgency: "low",
        link: `${this.deps.appUrl}/all/inbox`,
      });
    } catch (err) {
      await this.release(now);
      log("ERROR", "test email failed", { error: String(err) });
      return { result: "failed", error: String(err instanceof Error ? err.message : err) };
    }
    log("INFO", "test email sent");
    return { result: "sent" };
  }

  /** Gives back a slot taken today for a send that failed. */
  private async release(at: Date): Promise<void> {
    await this.deps.ledger.update((state) => {
      const s = rollDay(state, this.now());
      const sameDay = s.day === utcDay(at);
      return { state: sameDay ? { ...s, sent: Math.max(0, s.sent - 1) } : s, result: null };
    });
  }

  /** Today's count, for the settings page. */
  async sentToday(): Promise<number> {
    const state = await this.deps.ledger.get();
    return state && state.day === utcDay(this.now()) ? state.sent : 0;
  }

  /**
   * Queues the window's flush. If the queue refuses, an in-process timer tries instead (best
   * effort: Cloud Run may throttle or stop the instance), and the next item after the window's
   * end flushes it regardless (`overdue`), so a lost flush delays email but never stalls it.
   */
  private async scheduleFlushOrTimer(at: string): Promise<void> {
    if (this.deps.flushQueue) {
      try {
        return await this.deps.flushQueue.schedule(at);
      } catch (err) {
        log("ERROR", "email flush not queued: timer instead; the next item flushes it too", {
          at,
          error: String(err),
        });
      }
    }
    const ms = Math.max(0, Date.parse(at) - this.now().getTime());
    setTimeout(() => void this.flush().catch(() => {}), ms).unref();
  }
}

/**
 * The WorkTracker with one change: when `updateTicket` turns `needsAttention` on, `onNeedsYou`
 * gets the ticket. Every Needs-you path (refine questions, plan approval, sync conflicts, held
 * tickets) flags through `updateTicket`, so this one hook sees them all. Andy's own writes are
 * skipped: he knows already. A Proxy forwards the other methods unchanged.
 */
export function notifyOnNeedsYou(
  tracker: WorkTracker,
  onNeedsYou: (ticket: Ticket) => Promise<void>,
): WorkTracker {
  const updateTicket: WorkTracker["updateTicket"] = async (
    projectId: string,
    ticketId: string,
    change: TicketChange,
    actor: EventActor,
  ) => {
    const flags = change.fields?.needsAttention === true && !isOwner(actor);
    const before = flags ? await tracker.getTicket(projectId, ticketId) : null;
    const after = await tracker.updateTicket(projectId, ticketId, change, actor);
    if (before && !before.needsAttention && after.needsAttention) await onNeedsYou(after);
    return after;
  };
  return new Proxy(tracker, {
    get(target, prop, receiver) {
      if (prop === "updateTicket") return updateTicket;
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
