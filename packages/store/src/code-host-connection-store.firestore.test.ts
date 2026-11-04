import { codeHostConnectionStoreContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { GcpCodeHostConnectionStore, type SecretVersions } from "./code-host-connection-store";
import { createFirestore } from "./index";

/** Secret Manager stand-in: the emulator covers Firestore only. */
class MemorySecrets implements SecretVersions {
  private readonly versions = new Map<string, string[]>();
  async latest(id: string) {
    return this.versions.get(id)?.at(-1) ?? null;
  }
  async add(id: string, value: string) {
    this.versions.set(id, [...(this.versions.get(id) ?? []), value]);
  }
}

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  codeHostConnectionStoreContract(
    "gcp (emulator + in-memory secrets)",
    async () => new GcpCodeHostConnectionStore(db, new MemorySecrets(), crypto.randomUUID()),
  );
} else {
  describe("CodeHostConnectionStore contract: gcp", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
