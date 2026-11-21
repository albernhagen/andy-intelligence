import type { Firestore, Transaction } from "@google-cloud/firestore";
import {
  NightLaunch,
  NightStoppedStory,
  WorkTrackerError,
  nightLaunchIsActive,
  withStoppedStory,
  type NightLaunchStatus,
  type NightLaunchStore,
  type NightLaunchTransition,
} from "@andy/contracts";
import { collections, zodConverter } from "./index";

/**
 * NightLaunchStore on Firestore (ADR-0049): `nightLaunches/{id}`, server-only (the rules deny
 * every client read and write). The one-active-launch-per-project rule is checked inside the
 * write's transaction, so two concurrent launches can't both start. Queries use an equality
 * filter on `projectId` only and sort in memory (no composite index).
 */
export class FirestoreNightLaunchStore implements NightLaunchStore {
  constructor(private readonly db: Firestore) {}

  private launches() {
    return this.db
      .collection(collections.nightLaunches.path())
      .withConverter(zodConverter(NightLaunch));
  }

  private ofProject(projectId: string) {
    return this.launches().where("projectId", "==", projectId);
  }

  async create(launch: NightLaunch): Promise<NightLaunch> {
    const parsed = NightLaunch.parse(launch);
    return this.db.runTransaction(async (tx) => {
      if (nightLaunchIsActive(parsed)) await this.refuseIfActive(tx, parsed.projectId, parsed.id);
      const ref = this.launches().doc(parsed.id);
      if ((await tx.get(ref)).exists) {
        throw new WorkTrackerError("conflict", `night launch ${parsed.id} exists`);
      }
      tx.create(ref, parsed);
      return parsed;
    });
  }

  async get(launchId: string): Promise<NightLaunch | null> {
    return (await this.launches().doc(launchId).get()).data() ?? null;
  }

  async listForProject(projectId: string): Promise<NightLaunch[]> {
    const snap = await this.ofProject(projectId).get();
    return snap.docs
      .map((d) => d.data())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }

  async findActive(projectId: string): Promise<NightLaunch | null> {
    const snap = await this.ofProject(projectId).get();
    return snap.docs.map((d) => d.data()).find(nightLaunchIsActive) ?? null;
  }

  async transition(
    launchId: string,
    from: readonly NightLaunchStatus[],
    change: NightLaunchTransition,
  ): Promise<NightLaunch> {
    const ref = this.launches().doc(launchId);
    return this.db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data();
      if (!current) throw new WorkTrackerError("not_found", `night launch ${launchId} not found`);
      if (!from.includes(current.status)) {
        throw new WorkTrackerError("conflict", `night launch ${launchId} is ${current.status}`);
      }
      const next = NightLaunch.parse({ ...current, ...change });
      if (nightLaunchIsActive(next)) await this.refuseIfActive(tx, next.projectId, next.id);
      tx.set(ref, next);
      return next;
    });
  }

  async stopStory(launchId: string, story: NightStoppedStory): Promise<NightLaunch> {
    const parsed = NightStoppedStory.parse(story);
    const ref = this.launches().doc(launchId);
    return this.db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data();
      if (!current) throw new WorkTrackerError("not_found", `night launch ${launchId} not found`);
      const next = withStoppedStory(current, parsed);
      if (next !== current) tx.set(ref, next);
      return next;
    });
  }

  /** Reads go first in a Firestore transaction, so callers check before any write. */
  private async refuseIfActive(tx: Transaction, projectId: string, exceptId: string) {
    const snap = await tx.get(this.ofProject(projectId));
    const other = snap.docs
      .map((d) => d.data())
      .find((l) => l.id !== exceptId && nightLaunchIsActive(l));
    if (other) {
      throw new WorkTrackerError("conflict", `night launch ${other.id} is ${other.status}`);
    }
  }
}
