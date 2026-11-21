import {
  DEFAULT_ROUTING,
  RoutingConfig,
  RoutingConfigInput,
  nextRoutingStamp,
  routingKey,
} from "../entities/routing";
import { WorkTrackerError } from "../ports";
import type { RoutingConfigStore } from "../ports/routing";

/**
 * In-memory RoutingConfigStore. Each method reads and writes without an await in between, so
 * concurrent puts are atomic in one process, like the real store's transaction.
 */
export class InMemoryRoutingConfigStore implements RoutingConfigStore {
  private readonly configs = new Map<string, RoutingConfig>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async getGlobal(): Promise<RoutingConfig> {
    return structuredClone(this.configs.get(routingKey(null)) ?? DEFAULT_ROUTING);
  }

  async getProject(projectId: string): Promise<RoutingConfig | null> {
    const found = this.configs.get(routingKey(projectId));
    return found ? structuredClone(found) : null;
  }

  async put(config: RoutingConfigInput, ifUpdatedAt: string | null): Promise<RoutingConfig> {
    const input = RoutingConfigInput.parse(config);
    const key = routingKey(input.projectId);
    const current = this.configs.get(key)?.updatedAt ?? null;
    if (current !== ifUpdatedAt) {
      throw new WorkTrackerError("conflict", `routing config ${key} changed since it was read`);
    }
    const next = RoutingConfig.parse({
      ...input,
      updatedAt: nextRoutingStamp(current, this.now()),
    });
    this.configs.set(key, next);
    return structuredClone(next);
  }
}
