import { InMemoryMergeQueueStore, MERGE_QUEUE_MAX_ENTRIES } from "@andy/contracts";
import type { MergeQueueEntry } from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_HEAD_HOLD_MS,
  MAX_MAIN_RED_HOLD_MS,
  MAX_SYNCS_PER_PR,
  MERGE_QUEUE_LEASE_MS,
  MergeQueue,
  queueStateOf,
  type QueueJudge,
  type QueueJudgement,
} from "./merge-queue";

const REPO = "owner/repo";
const MAIN_TIP = "d".repeat(40);
const sha = (n: number) => n.toString(16).padStart(40, "0");

interface FakePr {
  head: string;
  /** The default-branch tip the head contains. */
  contains: string;
  checks: "green" | "pending" | "failed";
  open: boolean;
  ineligible?: string;
}

/** A repo and its PRs as the judges see them; merging moves the default branch. */
class World implements QueueJudge {
  tip = sha(1);
  private next = 100;
  readonly prs = new Map<number, FakePr>();
  readonly merges: number[] = [];
  readonly syncs: { number: number; head: string }[] = [];
  readonly notes: { number: number; reason: string; flag: boolean; note?: string }[] = [];
  /** Repos whose default branch is red, with the failing checks (AI-382). */
  readonly red = new Map<string, string[]>();
  /** Test seam: runs once, after the judge's verdict and before the merge call. */
  beforeMerge: (() => void | Promise<void>) | null = null;

  add(number: number, pr: Partial<FakePr> = {}): void {
    this.prs.set(number, {
      head: sha(this.next++),
      contains: this.tip,
      checks: "green",
      open: true,
      ...pr,
    });
  }

  /** The existing sync path ran: a new head that contains the tip, checks pending. */
  synced(number: number, checks: FakePr["checks"] = "pending"): void {
    const pr = this.prs.get(number)!;
    Object.assign(pr, { head: sha(this.next++), contains: this.tip, checks });
  }

  async judge(repo: string, entry: MergeQueueEntry): Promise<QueueJudgement> {
    const pr = this.prs.get(entry.number);
    if (!pr?.open) return { state: "gone", detail: "closed" };
    if (pr.ineligible) return { state: "ineligible", headSha: pr.head, reasons: [pr.ineligible] };
    const red = this.red.get(repo);
    if (red) return { state: "held", headSha: pr.head, checks: red, mainSha: MAIN_TIP };
    if (pr.checks === "failed")
      return { state: "failed", headSha: pr.head, reasons: ["checks_failed"] };
    if (pr.checks === "pending")
      return { state: "pending", headSha: pr.head, reasons: ["checks_pending"] };
    if (pr.contains !== this.tip) return { state: "behind", headSha: pr.head };
    const judged: QueueJudgement = {
      state: "merge",
      headSha: pr.head,
      baseRef: "main",
      baseSha: this.tip,
    };
    const hook = this.beforeMerge;
    this.beforeMerge = null;
    await hook?.();
    return judged;
  }

  async merge(_repo: string, entry: MergeQueueEntry, headSha: string) {
    const pr = this.prs.get(entry.number)!;
    if (!pr.open || pr.head !== headSha) return { merged: false as const, error: "head moved" };
    pr.open = false;
    this.merges.push(entry.number);
    this.tip = sha(this.next++);
    return { merged: true as const, sha: this.tip };
  }

  /** Test seam: PRs whose sync conflicts with the default branch (AI-388). */
  readonly conflicting = new Set<number>();

  async requestSync(_repo: string, entry: MergeQueueEntry, headSha: string) {
    if (this.conflicting.has(entry.number)) return "conflict" as const;
    this.syncs.push({ number: entry.number, head: headSha });
  }

  async needsYou(
    _repo: string,
    entry: MergeQueueEntry,
    reason: string,
    flag: boolean,
    note?: "dropped" | "held",
  ) {
    this.notes.push({ number: entry.number, reason, flag, ...(note === "held" ? { note } : {}) });
  }

  async branchSha() {
    return this.tip;
  }
}

describe("queueStateOf", () => {
  const wait = (...reasons: string[]) => ({
    verdict: "wait" as const,
    reasons: reasons as never[],
  });

  it("GivenAMergeVerdict_WhenRead_ThenMerge", () => {
    expect(queueStateOf({ verdict: "merge", reasons: [] }, [])).toBe("merge");
  });

  it("GivenOnlyBehind_WhenRead_ThenBehind", () => {
    expect(queueStateOf(wait("behind_default_branch"), [])).toBe("behind");
  });

  it("GivenPendingChecksOrUnknownFacts_WhenRead_ThenPending", () => {
    expect(queueStateOf(wait("gate_not_clean", "behind_default_branch"), ["checks_pending"])).toBe(
      "pending",
    );
    expect(queueStateOf(wait("gate_not_clean"), ["sync_pending"])).toBe("pending");
    expect(queueStateOf(wait("review_findings_unknown"), [])).toBe("pending");
  });

  it("GivenAFailedCheck_WhenRead_ThenFailed", () => {
    expect(queueStateOf(wait("gate_not_clean"), ["checks_failed", "checks_pending"])).toBe(
      "failed",
    );
  });

  it("GivenNotCleanWithNoGateReasonOrNoKnownReason_WhenRead_ThenIneligibleNeverBehind", () => {
    expect(queueStateOf(wait("gate_not_clean"), [])).toBe("ineligible");
    expect(queueStateOf(wait("gate_not_clean", "behind_default_branch"), [])).toBe("ineligible");
    expect(queueStateOf(wait(), [])).toBe("ineligible");
  });

  it("GivenMainRed_WhenRead_ThenHeldEvenWhenBehindPendingOrFailed", () => {
    expect(queueStateOf(wait("main_red"), [])).toBe("held");
    expect(queueStateOf(wait("main_red", "behind_default_branch"), [])).toBe("held");
    expect(queueStateOf(wait("main_red", "gate_not_clean"), ["checks_failed"])).toBe("held");
  });

  it("GivenMainRedAndAReasonItDoesNotKnow_WhenRead_ThenIneligible", () => {
    expect(queueStateOf(wait("main_red", "mode_manual"), [])).toBe("ineligible");
  });

  it("GivenMainChecksUnknown_WhenRead_ThenPending", () => {
    expect(queueStateOf(wait("main_checks_unknown"), [])).toBe("pending");
  });

  it("GivenAnyOtherReason_WhenRead_ThenIneligibleEvenWithAFailedCheck", () => {
    expect(queueStateOf(wait("mode_manual"), [])).toBe("ineligible");
    expect(queueStateOf(wait("gate_not_clean"), ["checks_failed", "draft"])).toBe("ineligible");
    expect(queueStateOf(wait("open_review_findings"), [])).toBe("ineligible");
  });
});

describe("MergeQueue", () => {
  let clock: Date;
  let store: InMemoryMergeQueueStore;
  let world: World;
  let holders: number;
  const queue = () => {
    const q = new MergeQueue(
      store,
      world,
      () => clock,
      () => `holder-${++holders}`,
    );
    q.register("gate", world);
    q.register("merge_pr", world);
    return q;
  };
  const offer = (q: MergeQueue, number: number) =>
    q.offer(REPO, {
      projectId: "ai",
      number,
      kind: "gate",
      actor: "system",
      headSha: world.prs.get(number)!.head,
    });
  const queued = async () => (await store.get(REPO)).entries.map((e) => e.number);

  beforeEach(() => {
    clock = new Date("2026-11-23T10:00:00.000Z");
    store = new InMemoryMergeQueueStore();
    world = new World();
    holders = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenACleanUpToDatePr_WhenOffered_ThenItMergesWithNoSyncRound", async () => {
    world.add(1);
    expect(await offer(queue(), 1)).toEqual({
      result: "merged",
      sha: world.tip,
      headSha: world.prs.get(1)!.head,
    });
    expect(world.merges).toEqual([1]);
    expect(world.syncs).toEqual([]);
    expect(await store.get(REPO)).toMatchObject({ entries: [], lease: null });
  });

  it("GivenAnOwnerApprovedOffer_WhenQueued_ThenTheEntryKeepsTheApprovalAndTheDiffItCovers", async () => {
    world.add(1, { checks: "pending" });
    await queue().offer(REPO, {
      projectId: "ai",
      number: 1,
      kind: "merge_pr",
      actor: "user:andy",
      headSha: world.prs.get(1)!.head,
      approval: { by: "owner", diff: "diff-1" },
    });
    expect((await store.get(REPO)).entries[0]).toMatchObject({
      approval: "owner",
      approvedDiff: "diff-1",
      lastNote: "pending: checks_pending",
    });
  });

  it("GivenAQueuedPrWithoutApproval_WhenOfferedAgainWithIt_ThenTheApprovalIsAddedAndItKeepsItsPlace", async () => {
    const q = queue();
    world.add(1, { checks: "pending" });
    world.add(2, { checks: "pending" });
    await offer(q, 1);
    await offer(q, 2);
    await q.offer(REPO, {
      projectId: "ai",
      number: 2,
      kind: "merge_pr",
      actor: "user:andy",
      headSha: world.prs.get(2)!.head,
      approval: { by: "owner", diff: "diff-2" },
    });
    const entries = (await store.get(REPO)).entries;
    expect(entries.map((e) => [e.number, e.approval])).toEqual([
      [1, null],
      [2, "owner"],
    ]);
  });

  it("GivenABehindHeadWhoseSyncConflicts_WhenAdvanced_ThenDroppedAndPutInNeedsYouNamingTheConflict", async () => {
    world.add(1, { contains: sha(0) });
    world.conflicting.add(1);
    expect(await offer(queue(), 1)).toMatchObject({ result: "dropped" });
    expect(world.notes).toEqual([
      expect.objectContaining({
        number: 1,
        flag: true,
        reason: expect.stringContaining("conflicts with the default branch"),
      }),
    ]);
    expect(await queued()).toEqual([]);
  });

  it("GivenThreeOfferedPrs_WhenTheHeadWaits_ThenTheyKeepOldestFirstAndOnlyTheHeadIsJudgedForMerge", async () => {
    const q = queue();
    world.add(5, { checks: "pending" });
    world.add(3);
    world.add(4);
    await offer(q, 5);
    clock = new Date(clock.getTime() + 1000);
    expect(await offer(q, 3)).toMatchObject({ result: "queued", position: 2 });
    expect(await offer(q, 4)).toMatchObject({ result: "queued", position: 3 });
    // Offering again keeps the place.
    expect(await offer(q, 3)).toMatchObject({ result: "queued", position: 2 });
    expect(await queued()).toEqual([5, 3, 4]);
    expect(world.merges).toEqual([]);
  });

  it("GivenTwoInstancesRacingOnTheSameMain_WhenBothOffer_ThenExactlyOneMergesAndTheOtherSyncsThenMergesAfterGreenChecks", async () => {
    world.add(1);
    world.add(2);
    const [a, b] = [queue(), queue()];
    const results = await Promise.all([offer(a, 1), offer(b, 2)]);

    expect(world.merges).toHaveLength(1);
    const first = world.merges[0]!;
    const second = first === 1 ? 2 : 1;
    expect(results.filter((r) => r.result === "merged")).toHaveLength(1);
    // The second was judged on the new main: behind, so one sync, no merge.
    expect(world.syncs).toEqual([{ number: second, head: world.prs.get(second)!.head }]);
    expect(await queued()).toEqual([second]);

    world.synced(second, "pending");
    await b.advance(REPO, [second]);
    expect(world.merges).toEqual([first]);
    world.prs.get(second)!.checks = "green";
    await a.advance(REPO);
    expect(world.merges).toEqual([first, second]);
    expect(await queued()).toEqual([]);
  });

  it("GivenABehindHead_WhenAdvancedRepeatedly_ThenOneSyncPerHeadThenWaitThenMergePinnedToTheSyncedHead", async () => {
    const q = queue();
    world.add(1, { contains: sha(0) });
    expect(await offer(q, 1)).toMatchObject({
      result: "queued",
      position: 1,
      reason: "sync requested",
    });
    await q.advance(REPO);
    expect(world.syncs).toHaveLength(1);

    world.synced(1, "pending");
    await q.advance(REPO, [1]);
    expect(world.merges).toEqual([]);
    world.prs.get(1)!.checks = "green";
    const [outcome] = await q.advance(REPO, [1]);
    expect(outcome).toMatchObject({ number: 1, outcome: "merged" });
    expect(world.syncs).toHaveLength(1);
  });

  it("GivenASyncedHeadWhoseChecksFail_WhenAdvanced_ThenDroppedAndPutInNeedsYouAndTheNextHeadMovesUp", async () => {
    const q = queue();
    world.add(1, { contains: sha(0) });
    world.add(2, { contains: sha(0) });
    await offer(q, 1);
    await offer(q, 2);
    world.synced(1, "failed");
    const outcomes = await q.advance(REPO, [1]);
    expect(outcomes[0]).toMatchObject({ number: 1, outcome: "dropped" });
    expect(world.notes).toEqual([
      { number: 1, reason: expect.stringContaining("checks failed"), flag: true },
    ]);
    expect(world.syncs.map((s) => s.number)).toEqual([1, 2]);
    expect(await queued()).toEqual([2]);
  });

  it("GivenAPushBetweenJudgingAndMerging_WhenTheMergeIsRefused_ThenNotMergedAndTheNewHeadWaits", async () => {
    world.add(1);
    world.beforeMerge = () => world.synced(1, "pending");
    const result = await offer(queue(), 1);
    expect(result).toMatchObject({ result: "queued", reason: "head moved" });
    expect(world.merges).toEqual([]);
    expect((await store.get(REPO)).entries[0]?.headSha).toBe(world.prs.get(1)!.head);
  });

  it("GivenAHandMergeMovingMainAfterTheVerdict_WhenMerging_ThenNotMergedAndJudgedAgainAsBehind", async () => {
    world.add(1);
    world.beforeMerge = () => {
      world.tip = sha(9999);
    };
    expect(await offer(queue(), 1)).toMatchObject({ result: "queued", reason: "sync requested" });
    expect(world.merges).toEqual([]);
  });

  it("GivenAFullQueue_WhenAnotherPrIsOffered_ThenDroppedWithANeedsYouNote", async () => {
    const q = queue();
    for (let n = 1; n <= MERGE_QUEUE_MAX_ENTRIES; n++) {
      world.add(n, { checks: "pending" });
      await offer(q, n);
    }
    world.add(99);
    expect(await offer(q, 99)).toMatchObject({ result: "dropped" });
    expect(world.notes).toEqual([
      { number: 99, reason: expect.stringContaining("full"), flag: true },
    ]);
    expect(world.merges).toEqual([]);
  });

  it("GivenAHeadThatKeepsFallingBehind_WhenPastTheSyncCap_ThenDroppedWithANeedsYouNote", async () => {
    const q = queue();
    world.add(1, { contains: sha(0) });
    await offer(q, 1);
    for (let i = 1; i < MAX_SYNCS_PER_PR; i++) {
      world.synced(1, "green");
      world.tip = sha(5000 + i);
      await q.advance(REPO, [1]);
    }
    expect(world.syncs).toHaveLength(MAX_SYNCS_PER_PR);
    world.synced(1, "green");
    world.tip = sha(6000);
    const [outcome] = await q.advance(REPO, [1]);
    expect(outcome).toMatchObject({ outcome: "dropped" });
    expect(world.notes[0]?.reason).toContain(`${MAX_SYNCS_PER_PR} syncs`);
  });

  it("GivenAHeadHeldPastTheHoldCap_WhenAdvanced_ThenDroppedWithANeedsYouNote", async () => {
    const q = queue();
    world.add(1, { checks: "pending" });
    await offer(q, 1);
    clock = new Date(clock.getTime() + MAX_HEAD_HOLD_MS + 1);
    const [outcome] = await q.advance(REPO);
    expect(outcome).toMatchObject({ outcome: "dropped" });
    expect(world.notes[0]).toMatchObject({ flag: true });
    expect(world.notes[0]?.reason).toContain("in the merge queue for over");
  });

  it("GivenALiveLeaseHeldByACrashedInstance_WhenAdvanced_ThenWaitsUntilItExpiresThenTakesOverAndMerges", async () => {
    world.add(1);
    const q = queue();
    const until = new Date(clock.getTime() + MERGE_QUEUE_LEASE_MS).toISOString();
    await store.put(
      {
        repo: REPO,
        entries: [
          {
            projectId: "ai",
            number: 1,
            kind: "gate",
            enqueuedAt: clock.toISOString(),
            enqueuedBy: "system",
            headSha: world.prs.get(1)!.head,
            syncs: 0,
            syncRequestedSha: null,
            judgedSince: clock.toISOString(),
            approval: null,
            approvedDiff: null,
            lastNote: null,
          },
        ],
        lease: { holder: "crashed", until },
        mainRed: null,
        version: 0,
      },
      0,
    );
    expect(await q.advance(REPO)).toEqual([]);
    expect(world.merges).toEqual([]);

    clock = new Date(Date.parse(until) + 1);
    const logs = vi.mocked(console.log);
    expect(await q.advance(REPO)).toEqual([
      { number: 1, outcome: "merged", sha: world.tip, headSha: world.prs.get(1)!.head },
    ]);
    expect(logs.mock.calls.some(([line]) => String(line).includes("lease takeover"))).toBe(true);
  });

  it("GivenAClosedOrNoLongerCleanHead_WhenAdvanced_ThenDroppedAndOnlyTheNoLongerCleanOneGetsAComment", async () => {
    const q = queue();
    world.add(1, { checks: "pending" });
    world.add(2, { checks: "pending" });
    await offer(q, 1);
    await offer(q, 2);
    world.prs.get(1)!.open = false;
    world.prs.get(2)!.ineligible = "mode_manual";
    const outcomes = await q.advance(REPO);
    expect(outcomes.map((o) => o.outcome)).toEqual(["dropped", "dropped"]);
    expect(world.notes).toEqual([
      { number: 2, reason: expect.stringContaining("mode_manual"), flag: false },
    ]);
    expect(await queued()).toEqual([]);
  });

  it("GivenAHeadParkedOnASyncThatNeverComes_WhenACleanPrIsQueuedBehindIt_ThenTheCleanOneMergesAndTheParkedOneKeepsItsPlace", async () => {
    const q = queue();
    world.add(1, { contains: sha(0) });
    world.add(2);
    expect(await offer(q, 1)).toMatchObject({ result: "queued", reason: "sync requested" });
    expect(await offer(q, 2)).toMatchObject({ result: "merged" });
    expect(world.merges).toEqual([2]);
    expect(await queued()).toEqual([1]);

    // Its sync lands: the event about it wakes it, and it merges once green.
    world.synced(1, "green");
    expect(await q.advanceFor(REPO, [1], false)).toEqual([
      expect.objectContaining({ number: 1, outcome: "merged" }),
    ]);
  });

  it("GivenAParkedHeadPastTheHoldCap_WhenAnyEventArrives_ThenItIsDroppedWithANeedsYouNote", async () => {
    const q = queue();
    world.add(1, { contains: sha(0) });
    await offer(q, 1);
    clock = new Date(clock.getTime() + MAX_HEAD_HOLD_MS + 1);
    const [outcome] = await q.advanceFor(REPO, [77], false);
    expect(outcome).toMatchObject({ number: 1, outcome: "dropped" });
    expect(world.notes[0]).toMatchObject({ number: 1, flag: true });
  });

  it("GivenAnEventAboutNoQueuedPr_WhenAdvancedFor_ThenNothingIsJudged", async () => {
    const q = queue();
    world.add(1, { checks: "pending" });
    await offer(q, 1);
    const judge = vi.spyOn(world, "judge");
    expect(await q.advanceFor(REPO, [42], false)).toEqual([]);
    expect(judge).not.toHaveBeenCalled();
  });

  it("GivenTheLeaseTakenOverWhileJudging_WhenAboutToMerge_ThenItDoesNotMerge", async () => {
    world.add(1);
    world.beforeMerge = async () => {
      const q = await store.get(REPO);
      const until = new Date(clock.getTime() + MERGE_QUEUE_LEASE_MS).toISOString();
      await store.put({ ...q, lease: { holder: "other", until } }, q.version);
    };
    expect(await offer(queue(), 1)).toMatchObject({ result: "queued", reason: "lease lost" });
    expect(world.merges).toEqual([]);
    // The other holder's lease is left alone.
    expect((await store.get(REPO)).lease?.holder).toBe("other");
  });
});

describe("MergeQueue while main is red (AI-382)", () => {
  const OTHER = "owner/other";
  let clock: Date;
  let store: InMemoryMergeQueueStore;
  let world: World;
  const queue = () => {
    const q = new MergeQueue(store, world, () => clock);
    q.register("gate", world);
    q.register("merge_pr", world);
    return q;
  };
  const offer = (q: MergeQueue, number: number, repo = REPO) =>
    q.offer(repo, {
      projectId: "ai",
      number,
      kind: "merge_pr",
      actor: "andy",
      headSha: world.prs.get(number)!.head,
    });
  const later = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };

  beforeEach(() => {
    clock = new Date("2026-11-25T10:00:00.000Z");
    store = new InMemoryMergeQueueStore();
    world = new World();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenARedMain_WhenACleanPrIsOffered_ThenItIsQueuedWithMainRedAndNeitherMergedNorSynced", async () => {
    world.red.set(REPO, ["ci"]);
    world.add(1);
    world.add(2, { contains: sha(0) });
    const q = queue();
    expect(await offer(q, 1)).toMatchObject({
      result: "queued",
      position: 1,
      reason: "main_red: ci",
    });
    expect(await offer(q, 2)).toMatchObject({ result: "queued", position: 2 });
    expect(world.merges).toEqual([]);
    expect(world.syncs).toEqual([]);
    expect((await store.get(REPO)).mainRed).toEqual({
      since: "2026-11-25T10:00:00.000Z",
      checks: ["ci"],
      raisedAt: null,
      sha: MAIN_TIP,
    });
  });

  it("GivenAHeldQueue_WhenACheckCompletesOnAnotherCommit_ThenNothingIsJudgedUntilOneCompletesOnTheRedTip", async () => {
    world.red.set(REPO, ["ci"]);
    world.add(1);
    const q = queue();
    await offer(q, 1);
    world.red.delete(REPO);
    // A check run on some pushed branch: can't buy a judgement while held.
    expect(await q.advanceFor(REPO, [], false, "f".repeat(40))).toEqual([]);
    const [outcome] = await q.advanceFor(REPO, [], false, MAIN_TIP);
    expect(outcome).toMatchObject({ number: 1, outcome: "merged" });
  });

  it("GivenAFailingCheckWithAnOverLongName_WhenHeld_ThenTheStoredNameIsCutAndTheRecordStillReads", async () => {
    const long = "x".repeat(300);
    world.red.set(REPO, [long]);
    world.add(1);
    const q = queue();
    await offer(q, 1);
    expect((await store.get(REPO)).mainRed?.checks).toEqual(["x".repeat(256)]);
    expect(await q.advanceFor(REPO, [1], false)).toEqual([
      { number: 1, outcome: "waiting", reason: `main_red: ${long}` },
    ]);
  });

  it("GivenAHeldQueue_WhenMainsChecksPassAndACheckCompletes_ThenItMergesUnaskedAndTheHoldIsReleased", async () => {
    world.red.set(REPO, ["ci"]);
    world.add(1);
    const q = queue();
    await offer(q, 1);
    // A completed check while main is still red: still held.
    expect(await q.advanceFor(REPO, [], false, MAIN_TIP)).toEqual([
      { number: 1, outcome: "waiting", reason: "main_red: ci" },
    ]);
    world.red.delete(REPO);
    const [outcome] = await q.advanceFor(REPO, [], false, MAIN_TIP);
    expect(outcome).toMatchObject({ number: 1, outcome: "merged" });
    expect(world.merges).toEqual([1]);
    expect((await store.get(REPO)).mainRed).toBeNull();
  });

  it("GivenAHeldQueueThatIsNotRedAnyMore_WhenAPrIsStillPending_ThenTheHoldIsReleased", async () => {
    world.red.set(REPO, ["ci"]);
    world.add(1, { checks: "pending" });
    const q = queue();
    await offer(q, 1);
    world.red.delete(REPO);
    await q.advanceFor(REPO, [], true);
    expect((await store.get(REPO)).mainRed).toBeNull();
  });

  it("GivenAQueueThatIsNotHeld_WhenACheckNamingNoQueuedPrCompletes_ThenNothingIsJudged", async () => {
    world.add(1, { checks: "pending" });
    const q = queue();
    await offer(q, 1);
    const judge = vi.spyOn(world, "judge");
    expect(await q.advanceFor(REPO, [], false, MAIN_TIP)).toEqual([]);
    expect(judge).not.toHaveBeenCalled();
  });

  it("GivenOneRepoRed_WhenAPrInAnotherRepoIsOffered_ThenItMergesWhileTheRedOneStaysHeld", async () => {
    world.red.set(REPO, ["ci"]);
    world.add(1);
    world.add(2);
    const q = queue();
    await offer(q, 1);
    expect(await offer(q, 2, OTHER)).toMatchObject({ result: "merged" });
    expect(world.merges).toEqual([2]);
    expect((await store.get(OTHER)).mainRed).toBeNull();
    expect((await store.get(REPO)).entries.map((e) => e.number)).toEqual([1]);
  });

  it("GivenMainRedPastTheCap_WhenAnyEventArrives_ThenOneNeedsYouNoteNamesTheCheckAndThePrStaysQueued", async () => {
    world.red.set(REPO, ["ci", "e2e"]);
    world.add(1);
    const q = queue();
    await offer(q, 1);
    later(MAX_MAIN_RED_HOLD_MS - 1000);
    await q.advanceFor(REPO, [], false, MAIN_TIP);
    expect(world.notes).toEqual([]);

    later(2000);
    // No check completed: the cap alone wakes the queue.
    await q.advanceFor(REPO, [], false);
    expect(world.notes).toEqual([
      { number: 1, reason: expect.stringContaining("failing: ci, e2e"), flag: true, note: "held" },
    ]);
    expect((await store.get(REPO)).mainRed?.raisedAt).toBe(clock.toISOString());

    // Held for hours: no second note, and the PR's own hold cap is paused, so it isn't dropped.
    later(MAX_HEAD_HOLD_MS * 3);
    await q.advanceFor(REPO, [], false, MAIN_TIP);
    await q.advanceFor(REPO, [1], false);
    expect(world.notes).toHaveLength(1);
    expect((await store.get(REPO)).entries.map((e) => e.number)).toEqual([1]);

    world.red.delete(REPO);
    await q.advanceFor(REPO, [], false, MAIN_TIP);
    expect(world.merges).toEqual([1]);
  });

  it("GivenARedSpellThatEnded_WhenMainTurnsRedAgain_ThenTheCapStartsAgainAndCanRaiseAgain", async () => {
    world.red.set(REPO, ["ci"]);
    world.add(1, { checks: "pending" });
    const q = queue();
    await offer(q, 1);
    later(MAX_MAIN_RED_HOLD_MS + 1);
    await q.advanceFor(REPO, [], false);
    world.red.delete(REPO);
    await q.advanceFor(REPO, [], true);
    world.red.set(REPO, ["ci"]);
    later(1000);
    await q.advanceFor(REPO, [], true);
    expect((await store.get(REPO)).mainRed).toMatchObject({
      since: clock.toISOString(),
      raisedAt: null,
    });
    later(MAX_MAIN_RED_HOLD_MS + 1);
    await q.advanceFor(REPO, [], false);
    expect(world.notes).toHaveLength(2);
  });

  it("GivenAPrParkedOnItsSyncWhenMainTurnsRed_WhenHeldLongerThanTheHoldCap_ThenItIsNotDroppedAsStuck", async () => {
    world.add(1, { contains: sha(0) });
    world.add(2, { contains: sha(0) });
    const q = queue();
    await offer(q, 1);
    await offer(q, 2);
    // Both parked on their syncs, each with its hold clock running.
    world.red.set(REPO, ["ci"]);
    world.synced(1, "green");
    await q.advanceFor(REPO, [1], false);
    later(MAX_HEAD_HOLD_MS * 2);
    world.red.delete(REPO);
    await q.advanceFor(REPO, [], false, MAIN_TIP);
    expect(world.merges).toEqual([1]);
    expect(world.notes).toEqual([]);
    expect((await store.get(REPO)).entries.map((e) => e.number)).toEqual([2]);
  });

  it("GivenAHeldQueue_WhenItsLastPrCloses_ThenTheHoldIsCleared", async () => {
    world.red.set(REPO, ["ci"]);
    world.add(1);
    const q = queue();
    await offer(q, 1);
    world.prs.get(1)!.open = false;
    await q.advanceFor(REPO, [1], false);
    expect(await store.get(REPO)).toMatchObject({ entries: [], mainRed: null });
  });
});
