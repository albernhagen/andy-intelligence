import { InMemoryCodeHost, InMemoryWorkTracker } from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADR_DIR,
  ADR_HOLDS_PER_PROJECT,
  ADR_HOLDS_PER_TICKET,
  ADR_HOLD_TTL_MS,
  AdrNumbers,
  highestAdrOnDefaultBranch,
} from "./adr-numbers";

const REPO = "albernhagen/andy-intelligence";
const OWNER = "user:andy";

describe("AdrNumbers", () => {
  let tracker: InMemoryWorkTracker;
  let host: InMemoryCodeHost;
  let ms: number;
  let adr: AdrNumbers;
  let projectId: string;

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    tracker = new InMemoryWorkTracker();
    host = new InMemoryCodeHost([
      { fullName: REPO, defaultBranch: "main", private: false, url: `https://github.com/${REPO}` },
    ]);
    ms = Date.parse("2026-11-27T10:00:00.000Z");
    adr = new AdrNumbers(tracker, host, () => new Date(ms));
    projectId = (await tracker.createProject({ name: "AI", key: "AI", repos: [REPO] })).id;
    // Not contiguous, as on main: 0116 filled late, 0161 and 0162 handed out and never used.
    for (const f of ["0115-a.md", "0116-b.md", "0160-c.md", "README.md"]) {
      host.files.set(`${ADR_DIR}/${f}`, "x");
    }
  });

  const ticket = async () => (await tracker.createTicket(projectId, { title: "T" }, "system")).key;

  it("GivenAdrFilesWithGaps_WhenASessionReserves_ThenItGetsOneAboveTheHighestFile", async () => {
    const key = await ticket();
    expect(await adr.reserveForTicket(OWNER, key)).toEqual({
      ticket: key,
      number: 161,
      label: "ADR-0161",
      expiresAt: new Date(ms + ADR_HOLD_TTL_MS).toISOString(),
    });
  });

  it("GivenTwoSessionsAndABuildRun_WhenEachReserves_ThenNoNumberIsGivenTwice", async () => {
    const [a, b] = [await ticket(), await ticket()];
    const first = await adr.reserveForTicket(OWNER, a);
    expect(await tracker.reserveAdrNumber(projectId, 160)).toBe(162);
    const second = await adr.reserveForTicket(OWNER, b);
    expect([first.number, second.number]).toEqual([161, 163]);
  });

  it("GivenANewFileOnMainAboveTheCounter_WhenASessionReserves_ThenItNeverGetsThatFilesNumber", async () => {
    const key = await ticket();
    await adr.reserveForTicket(OWNER, key);
    host.files.set(`${ADR_DIR}/0170-late.md`, "x");
    expect((await adr.reserveForTicket(OWNER, key)).number).toBe(171);
  });

  it("GivenATicketAtItsCap_WhenItReservesAgain_ThenItIsRefusedWithAPlainReason", async () => {
    const key = await ticket();
    for (let i = 0; i < ADR_HOLDS_PER_TICKET; i++) await adr.reserveForTicket(OWNER, key);
    await expect(adr.reserveForTicket(OWNER, key)).rejects.toMatchObject({
      code: "reservation_limit",
      message: expect.stringContaining(`${key} already holds ${ADR_HOLDS_PER_TICKET}`),
      details: expect.arrayContaining([expect.stringContaining(`ADR-0161 for ${key}`)]),
    });
    // Another ticket still gets the next number: the refusal reserved nothing.
    expect((await adr.reserveForTicket(OWNER, await ticket())).number).toBe(
      161 + ADR_HOLDS_PER_TICKET,
    );
  });

  it("GivenTheProjectAtItsCap_WhenAnyTicketReserves_ThenItIsRefused", async () => {
    for (let i = 0; i < ADR_HOLDS_PER_PROJECT; i++)
      await adr.reserveForTicket(OWNER, await ticket());
    await expect(adr.reserveForTicket(OWNER, await ticket())).rejects.toMatchObject({
      code: "reservation_limit",
      message: expect.stringContaining(`${ADR_HOLDS_PER_PROJECT} ADR numbers held open`),
    });
  });

  it("GivenHoldsPastTheTimeLimit_WhenTheTicketReserves_ThenTheyNoLongerCountAndTheSequenceMovesOn", async () => {
    const key = await ticket();
    for (let i = 0; i < ADR_HOLDS_PER_TICKET; i++) await adr.reserveForTicket(OWNER, key);
    ms += ADR_HOLD_TTL_MS + 1;
    expect((await adr.reserveForTicket(OWNER, key)).number).toBe(161 + ADR_HOLDS_PER_TICKET);
  });

  it("GivenReleasedHolds_WhenTheTicketReservesAgain_ThenTheReleasedNumbersAreNotReissued", async () => {
    const key = await ticket();
    for (let i = 0; i < ADR_HOLDS_PER_TICKET; i++) await adr.reserveForTicket(OWNER, key);
    await tracker.releaseAdrHolds(projectId, key);
    expect((await adr.reserveForTicket(OWNER, key)).number).toBe(161 + ADR_HOLDS_PER_TICKET);
  });

  it("GivenAnAgent_WhenItReserves_ThenItIsRefused", async () => {
    await expect(adr.reserveForTicket("agent:run-1", await ticket())).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("GivenAnUnknownTicket_WhenReserved_ThenItIsRefused", async () => {
    await expect(adr.reserveForTicket(OWNER, "AI-999")).rejects.toMatchObject({
      code: "invalid_reference",
    });
    await expect(adr.reserveForTicket(OWNER, "nope")).rejects.toMatchObject({
      code: "invalid_reference",
    });
  });

  it("GivenNoAdrFilesOrNoCodeHost_WhenReserved_ThenItIsRefusedAndNothingIsGuessed", async () => {
    const key = await ticket();
    host.files.clear();
    await expect(adr.reserveForTicket(OWNER, key)).rejects.toMatchObject({ code: "invalid_repo" });
    await expect(new AdrNumbers(tracker, null).reserveForTicket(OWNER, key)).rejects.toMatchObject({
      code: "code_host_unavailable",
    });
    expect(await tracker.reserveAdrNumber(projectId, 0)).toBe(1);
  });

  it("GivenTheListingFails_WhenReserved_ThenCodeHostUnavailable", async () => {
    const key = await ticket();
    vi.spyOn(host, "listFiles").mockRejectedValueOnce(new Error("rate limited"));
    await expect(adr.reserveForTicket(OWNER, key)).rejects.toMatchObject({
      code: "code_host_unavailable",
    });
  });

  it("GivenTheLastNumberOnMain_WhenReserved_ThenItIsRefused", async () => {
    const key = await ticket();
    host.files.set(`${ADR_DIR}/9999-last.md`, "x");
    await expect(adr.reserveForTicket(OWNER, key)).rejects.toMatchObject({
      code: "reservation_limit",
    });
  });
});

describe("highestAdrOnDefaultBranch", () => {
  it("GivenAnUnknownRepo_WhenRead_ThenNull", async () => {
    expect(await highestAdrOnDefaultBranch(new InMemoryCodeHost([]), REPO)).toBeNull();
  });
});
