import {
  NightLaunch,
  NightStoppedStory,
  nightLaunchIsActive,
  type NightLaunchStatus,
} from "../entities/night";
import { WorkTrackerError } from "../ports";
import {
  withStoppedStory,
  type NightLaunchStore,
  type NightLaunchTransition,
} from "../ports/night";

/**
 * In-memory NightLaunchStore. Every method reads and writes without an await in between, so
 * concurrent calls are atomic in one process, like the real store's transactions.
 */
export class InMemoryNightLaunchStore implements NightLaunchStore {
  private readonly launches = new Map<string, NightLaunch>();

  async create(launch: NightLaunch): Promise<NightLaunch> {
    const parsed = NightLaunch.parse(launch);
    if (this.launches.has(parsed.id)) {
      throw new WorkTrackerError("conflict", `night launch ${parsed.id} exists`);
    }
    if (nightLaunchIsActive(parsed)) this.refuseIfActive(parsed.projectId, parsed.id);
    this.launches.set(parsed.id, parsed);
    return structuredClone(parsed);
  }

  async get(launchId: string): Promise<NightLaunch | null> {
    const found = this.launches.get(launchId);
    return found ? structuredClone(found) : null;
  }

  async listForProject(projectId: string): Promise<NightLaunch[]> {
    return [...this.launches.values()]
      .filter((l) => l.projectId === projectId)
      .map((l) => structuredClone(l))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }

  async findActive(projectId: string): Promise<NightLaunch | null> {
    const found = [...this.launches.values()].find(
      (l) => l.projectId === projectId && nightLaunchIsActive(l),
    );
    return found ? structuredClone(found) : null;
  }

  async transition(
    launchId: string,
    from: readonly NightLaunchStatus[],
    change: NightLaunchTransition,
  ): Promise<NightLaunch> {
    const current = this.launches.get(launchId);
    if (!current) throw new WorkTrackerError("not_found", `night launch ${launchId} not found`);
    if (!from.includes(current.status)) {
      throw new WorkTrackerError("conflict", `night launch ${launchId} is ${current.status}`);
    }
    const next = NightLaunch.parse({ ...current, ...change });
    if (nightLaunchIsActive(next)) this.refuseIfActive(next.projectId, next.id);
    this.launches.set(launchId, next);
    return structuredClone(next);
  }

  async stopStory(launchId: string, story: NightStoppedStory): Promise<NightLaunch> {
    const current = this.launches.get(launchId);
    if (!current) throw new WorkTrackerError("not_found", `night launch ${launchId} not found`);
    const next = withStoppedStory(current, NightStoppedStory.parse(story));
    this.launches.set(launchId, next);
    return structuredClone(next);
  }

  private refuseIfActive(projectId: string, exceptId: string): void {
    const other = [...this.launches.values()].find(
      (l) => l.projectId === projectId && l.id !== exceptId && nightLaunchIsActive(l),
    );
    if (other) {
      throw new WorkTrackerError("conflict", `night launch ${other.id} is ${other.status}`);
    }
  }
}
