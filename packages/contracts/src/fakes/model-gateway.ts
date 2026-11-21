import {
  modelRequestRefusal,
  type ModelGateway,
  type ModelRequest,
  type ModelResult,
  type ModelUsage,
} from "../ports/model-gateway";

/** What the fake model answers: a reply with usage, or a provider status. */
export type FakeModelAnswer =
  { text: string; usage: ModelUsage | null } | { status: number; reason?: string };

/** Records calls and answers with `answer`; `enabled: false` behaves as no key configured. */
export class InMemoryModelGateway implements ModelGateway {
  readonly calls: ModelRequest[] = [];

  constructor(
    public answer: FakeModelAnswer = {
      text: "ok",
      usage: { inputTokens: 10, outputTokens: 2, cachedTokens: 0, costUsd: 0.0001 },
    },
    public enabled = true,
  ) {}

  async complete(request: ModelRequest): Promise<ModelResult> {
    if (!this.enabled) return { outcome: "off" };
    const refused = modelRequestRefusal(request);
    if (refused) return { outcome: "error", status: null, reason: refused };
    this.calls.push(structuredClone(request));
    if ("status" in this.answer) {
      const { status, reason } = this.answer;
      return { outcome: "error", status, reason: reason ?? `provider answered ${status}` };
    }
    return { outcome: "ok", text: this.answer.text, usage: this.answer.usage };
  }
}
