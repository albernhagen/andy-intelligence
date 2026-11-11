import { EmailNotifyState } from "../entities/notify-email";
import type { NotifyFlushQueue, NotifyLedger } from "../ports/notify-email";

/** In-memory NotifyLedger: one state, updated synchronously (so atomically) in one process. */
export class InMemoryNotifyLedger implements NotifyLedger {
  private state: EmailNotifyState | null = null;

  async get(): Promise<EmailNotifyState | null> {
    return this.state ? structuredClone(this.state) : null;
  }

  async update<T>(
    change: (state: EmailNotifyState | null) => { state: EmailNotifyState; result: T },
  ): Promise<T> {
    const { state, result } = change(this.state ? structuredClone(this.state) : null);
    this.state = EmailNotifyState.parse(state);
    return result;
  }
}

/** In-memory NotifyFlushQueue: holds flush times until a test delivers them. */
export class InMemoryNotifyFlushQueue implements NotifyFlushQueue {
  readonly scheduled = new Set<string>();

  async schedule(at: string): Promise<void> {
    if (Number.isNaN(Date.parse(at))) throw new Error(`invalid flush time ${at}`);
    this.scheduled.add(at);
  }
}
