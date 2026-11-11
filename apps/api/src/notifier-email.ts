import type { Notice, Notifier } from "@andy/contracts";
import { Resend } from "resend";

/**
 * The `Notifier` port's email adapter (AI-77, ADR-0060) on Resend's HTTP API. It only sends:
 * what goes in an email, and when, is decided in `@andy/domain` (`EmailNotifications`).
 */

/** One send may take this long; the flush request it runs in has 60 s (Cloud Run timeout). */
export const EMAIL_SEND_TIMEOUT_MS = 10_000;

export interface EmailConfig {
  apiKey: string;
  from: string;
  to: string;
  /** Test seam: a fake Resend server. */
  baseUrl?: string;
}

/**
 * The email config from the environment, or null when any part is missing: then email is off,
 * logged once here at start. `RESEND_API_KEY` comes from Secret Manager; `EMAIL_FROM` and
 * `EMAIL_TO` from Terraform variables (infra/control-plane).
 */
export function emailConfigFromEnv(env: NodeJS.ProcessEnv): EmailConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  const to = env.EMAIL_TO?.trim();
  if (apiKey && from && to) return { apiKey, from, to };
  const missing = [!apiKey && "RESEND_API_KEY", !from && "EMAIL_FROM", !to && "EMAIL_TO"].filter(
    Boolean,
  );
  console.log(
    JSON.stringify({
      severity: "WARNING",
      message: "email not configured: Needs-you emails are off",
      component: "notify-email",
      missing,
    }),
  );
  return null;
}

export class ResendNotifier implements Notifier {
  private readonly client: Resend;

  constructor(private readonly config: EmailConfig) {
    this.client = new Resend(config.apiKey, config.baseUrl ? { baseUrl: config.baseUrl } : {});
  }

  /** Plain text only: no HTML, so nothing in a notice can render as markup or a hidden link. */
  async notify(notice: Notice): Promise<void> {
    const { error } = await this.client.emails.send(
      {
        from: this.config.from,
        to: [this.config.to],
        subject: notice.title,
        text: notice.body,
      },
      { signal: AbortSignal.timeout(EMAIL_SEND_TIMEOUT_MS) },
    );
    // The provider's error names the failure only; the key never appears in it.
    if (error) throw new Error(`email provider refused the send: ${error.name}: ${error.message}`);
  }
}
