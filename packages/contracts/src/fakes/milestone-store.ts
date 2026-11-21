import {
  MILESTONES_PER_PROJECT_MAX,
  Milestone,
  MilestoneCapError,
  type MilestoneInput,
  byMilestoneOrder,
} from "../entities/milestone";
import type { MilestoneStore } from "../ports/milestone-store";

const key = (projectId: string, id: string) => `${projectId}\u0000${id}`;

/** In-memory MilestoneStore: synchronous updates, so atomic within one process. */
export class InMemoryMilestoneStore implements MilestoneStore {
  private readonly rows = new Map<string, Milestone>();

  async list(projectId: string): Promise<Milestone[]> {
    return [...this.rows.values()]
      .filter((m) => m.projectId === projectId)
      .map((m) => structuredClone(m))
      .sort(byMilestoneOrder);
  }

  async get(projectId: string, id: string): Promise<Milestone | null> {
    const m = this.rows.get(key(projectId, id));
    return m ? structuredClone(m) : null;
  }

  async create(milestone: MilestoneInput): Promise<Milestone> {
    const m = Milestone.parse(milestone);
    const k = key(m.projectId, m.id);
    if (this.rows.has(k)) throw new Error(`milestone ${m.id} already exists`);
    const inProject = [...this.rows.values()].filter((r) => r.projectId === m.projectId).length;
    if (inProject >= MILESTONES_PER_PROJECT_MAX) throw new MilestoneCapError();
    this.rows.set(k, m);
    return structuredClone(m);
  }

  async replace(milestone: MilestoneInput): Promise<Milestone | null> {
    const m = Milestone.parse(milestone);
    const k = key(m.projectId, m.id);
    if (!this.rows.has(k)) return null;
    this.rows.set(k, m);
    return structuredClone(m);
  }
}
