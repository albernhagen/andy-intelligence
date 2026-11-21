import {
  pushResultForStatus,
  type PushMessage,
  type PushSendResult,
  type PushSender,
  type PushTarget,
} from "../ports/push-sender";

/** Records sends; the push service's answer is `status` (default 201). */
export class InMemoryPushSender implements PushSender {
  readonly sent: { target: PushTarget; message: PushMessage }[] = [];

  constructor(
    public status = 201,
    readonly enabled = true,
  ) {}

  async send(target: PushTarget, message: PushMessage): Promise<PushSendResult> {
    if (!this.enabled) return { outcome: "off" };
    if (!URL.canParse(target.endpoint)) {
      return { outcome: "error", status: null, reason: "invalid subscription" };
    }
    this.sent.push({ target: structuredClone(target), message: { ...message } });
    return pushResultForStatus(this.status);
  }
}
