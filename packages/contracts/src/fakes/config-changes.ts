import { ConfigChange } from "../entities";
import { WorkTrackerError } from "../ports";
import { CONFIG_CHANGE_LIST_MAX, type ConfigChangeStore } from "../ports/config-changes";

/** In-memory ConfigChangeStore; each method runs without an await, so it is atomic here. */
export class InMemoryConfigChangeStore implements ConfigChangeStore {
  private readonly changes = new Map<string, ConfigChange>();

  async append(change: ConfigChange): Promise<ConfigChange> {
    const parsed = ConfigChange.parse(change);
    if (this.changes.has(parsed.id)) {
      throw new WorkTrackerError("conflict", `config change ${parsed.id} exists`);
    }
    this.changes.set(parsed.id, parsed);
    return structuredClone(parsed);
  }

  async get(id: string): Promise<ConfigChange | null> {
    const found = this.changes.get(id);
    return found ? structuredClone(found) : null;
  }

  async listForProject(projectId: string, limit = CONFIG_CHANGE_LIST_MAX): Promise<ConfigChange[]> {
    return [...this.changes.values()]
      .filter((c) => c.entity === "project" && c.entityId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
      .slice(0, Math.min(limit, CONFIG_CHANGE_LIST_MAX))
      .map((c) => structuredClone(c));
  }
}
