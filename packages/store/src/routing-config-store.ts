import type { Firestore } from "@google-cloud/firestore";
import {
  DEFAULT_ROUTING,
  RoutingConfig,
  RoutingConfigInput,
  RoutingProjectId,
  WorkTrackerError,
  nextRoutingStamp,
  routingKey,
  type RoutingConfigStore,
} from "@andy/contracts";
import { zodConverter } from "./index";

/**
 * `routingConfigs/{global | project-<id>}`: server-only, like every collection (the rules deny
 * all client access). A new collection: nothing to migrate, no SCHEMA_VERSION bump.
 */
export const ROUTING_CONFIGS_COLLECTION = "routingConfigs";

/** RoutingConfigStore on Firestore (AI-230: M9.3). Every read is one document. */
export class FirestoreRoutingConfigStore implements RoutingConfigStore {
  constructor(
    private readonly db: Firestore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private doc(projectId: string | null) {
    return this.db
      .collection(ROUTING_CONFIGS_COLLECTION)
      .withConverter(zodConverter(RoutingConfig))
      .doc(routingKey(projectId));
  }

  async getGlobal(): Promise<RoutingConfig> {
    return (await this.doc(null).get()).data() ?? structuredClone(DEFAULT_ROUTING);
  }

  async getProject(projectId: string): Promise<RoutingConfig | null> {
    // Not a project key: no project has it, and a "/" would split the document path.
    if (!RoutingProjectId.safeParse(projectId).success) return null;
    return (await this.doc(projectId).get()).data() ?? null;
  }

  async put(config: RoutingConfigInput, ifUpdatedAt: string | null): Promise<RoutingConfig> {
    const input = RoutingConfigInput.parse(config);
    const ref = this.doc(input.projectId);
    return this.db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data()?.updatedAt ?? null;
      if (current !== ifUpdatedAt) {
        throw new WorkTrackerError(
          "conflict",
          `routing config ${ref.id} changed since it was read`,
        );
      }
      const next = RoutingConfig.parse({
        ...input,
        updatedAt: nextRoutingStamp(current, this.now()),
      });
      tx.set(ref, next);
      return next;
    });
  }
}
