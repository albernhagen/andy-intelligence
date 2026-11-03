import type { Firestore } from "@google-cloud/firestore";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { CodeHostConnection, type CodeHostConnectionStore } from "@andy/contracts";
import { SCHEMA_VERSION, collections } from "./index";

/** Secret Manager secret IDs (Terraform `google_secret_manager_secret.github`). */
export const CODE_HOST_SECRETS = {
  privateKey: "github-app-private-key",
  webhookSecret: "github-webhook-secret",
} as const;

/** The two Secret Manager calls the store needs; a seam so tests run without GCP. */
export interface SecretVersions {
  /** Latest enabled version's value, or null when the secret has no version. */
  latest(secretId: string): Promise<string | null>;
  add(secretId: string, value: string): Promise<void>;
}

/** gRPC codes Secret Manager and Firestore return. */
const NOT_FOUND = 5;
const ALREADY_EXISTS = 6;

export class SecretManagerVersions implements SecretVersions {
  private readonly client = new SecretManagerServiceClient();
  constructor(private readonly projectId: string) {}

  async latest(secretId: string): Promise<string | null> {
    try {
      const [version] = await this.client.accessSecretVersion({
        name: `projects/${this.projectId}/secrets/${secretId}/versions/latest`,
      });
      return version.payload?.data ? Buffer.from(version.payload.data).toString("utf8") : null;
    } catch (err) {
      if ((err as { code?: number }).code === NOT_FOUND) return null;
      throw err;
    }
  }

  async add(secretId: string, value: string): Promise<void> {
    await this.client.addSecretVersion({
      parent: `projects/${this.projectId}/secrets/${secretId}`,
      payload: { data: Buffer.from(value, "utf8") },
    });
  }
}

/**
 * CodeHostConnectionStore on GCP (ADR-0043): identifiers in Firestore `config/{docId}`,
 * secrets as new Secret Manager versions. The secrets are written first and the document
 * last, with `create()`, so a half-finished save reads as "not connected" and a second
 * connection can't replace the first.
 */
export class GcpCodeHostConnectionStore implements CodeHostConnectionStore {
  constructor(
    private readonly db: Firestore,
    private readonly secrets: SecretVersions,
    private readonly docId = "codeHost",
  ) {}

  private doc() {
    return this.db.collection(collections.config.path()).doc(this.docId);
  }

  async get(): Promise<CodeHostConnection | null> {
    const data = (await this.doc().get()).data();
    if (!data) return null;
    const [privateKey, webhookSecret] = await Promise.all([
      this.secrets.latest(CODE_HOST_SECRETS.privateKey),
      this.secrets.latest(CODE_HOST_SECRETS.webhookSecret),
    ]);
    if (!privateKey || !webhookSecret) {
      console.log(
        JSON.stringify({
          severity: "ERROR",
          message: "code host connection saved but a secret has no version",
          component: "code-host-connection",
        }),
      );
      return null;
    }
    return CodeHostConnection.parse({ ...data, privateKey, webhookSecret });
  }

  async save(connection: CodeHostConnection): Promise<"saved" | "exists"> {
    const { privateKey, webhookSecret, ...ids } = CodeHostConnection.parse(connection);
    if ((await this.doc().get()).exists) return "exists";
    await this.secrets.add(CODE_HOST_SECRETS.privateKey, privateKey);
    await this.secrets.add(CODE_HOST_SECRETS.webhookSecret, webhookSecret);
    try {
      await this.doc().create({ ...ids, _v: SCHEMA_VERSION });
      return "saved";
    } catch (err) {
      if ((err as { code?: number }).code === ALREADY_EXISTS) return "exists";
      throw err;
    }
  }
}
