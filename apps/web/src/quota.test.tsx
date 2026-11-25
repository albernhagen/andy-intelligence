import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { QuotaReading } from "@andy/contracts";
import { renderApp } from "@/test/harness";
import { emulateWidth } from "@/test/phone";

/**
 * M1.9: Quota capture: the gauge and the persistent banner, over the real API. Desktop shows the
 * sidebar's meters (AI-370); the phone keeps the header gauge (AI-176).
 */

const reading = (window: "5h" | "weekly", usedPct: number): QuotaReading => ({
  provider: "claude-sub",
  window,
  usedPct,
  resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
  source: "test",
  takenAt: new Date().toISOString(),
  confidence: "high",
});

async function open(readings: QuotaReading[]) {
  const harness = renderApp("/all/inbox");
  await harness.quota.save(readings);
  await harness.tracker.createProject({ name: "AI", key: "AI" });
  await harness.router.invalidate();
  return harness;
}

describe("quota gauge and banner", () => {
  it("GivenAFreshReading_WhenTheShellOpens_ThenTheGaugeShowsIt", async () => {
    await open([reading("5h", 42), reading("weekly", 10)]);
    const meter = await screen.findByRole("meter", { name: "5-hour quota used" });
    expect(meter.getAttribute("aria-valuenow")).toBe("42");
    expect(screen.getByText("Claude 5-hour · 42%")).toBeTruthy();
    expect(screen.getByText("Weekly · 10%")).toBeTruthy();
  });

  it("GivenBothWindowsOk_WhenTheShellOpens_ThenNoBanner", async () => {
    await open([reading("5h", 42), reading("weekly", 10)]);
    await screen.findByRole("meter", { name: "Weekly quota used" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/Claude quota unknown/)).toBeNull();
  });

  it("GivenAWindowPastWarn_WhenTheShellOpens_ThenAWarningBannerWithNoDismiss", async () => {
    await open([reading("5h", 75), reading("weekly", 10)]);
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toMatch(/warning level \(70%\): 5-hour 75%/);
    expect(within(banner).queryByRole("button")).toBeNull();
  });

  it("GivenAWindowPastPause_WhenTheShellOpens_ThenThePauseBannerSaysDispatchHolds", async () => {
    await open([reading("5h", 75), reading("weekly", 85)]);
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toMatch(/pause level \(80%\): Weekly 85%/);
    expect(banner.textContent).toMatch(/Dispatch starts nothing new until it drops/);
  });

  // AI-74: the clear shows only while a reading holds dispatch at the reserve.
  it("GivenAWindowPastPause_WhenAndyClearsTheIdle_ThenTheReadingIsDiscardedAndQuotaReadsUnknown", async () => {
    const harness = await open([reading("5h", 92), reading("weekly", 10)]);
    const banner = await screen.findByRole("alert");
    fireEvent.click(within(banner).getByRole("button", { name: "Clear quota idle" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByRole("button", { name: "Clear quota idle" })).toBeNull();
    const [cleared] = (await harness.quota.latest("claude-sub")).filter((r) => r.window === "5h");
    expect(cleared?.discarded?.by).toBe("andy@example.com");
  });

  it("GivenAWindowOnlyPastWarn_WhenTheShellOpens_ThenNoClearIsOffered", async () => {
    await open([reading("5h", 75), reading("weekly", 10)]);
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Clear quota idle" })).toBeNull();
  });

  it("GivenNoReadings_WhenTheShellOpens_ThenOneQuietMarkerNotTwoLabels", async () => {
    await open([]);
    const marker = await screen.findByText("Quota unknown");
    expect(marker.getAttribute("title")).toMatch(/don't assume there is headroom/);
    expect(screen.getAllByText(/unknown/)).toHaveLength(1);
    expect(screen.queryByRole("list", { name: "Claude quota" })).toBeNull();
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("GivenOneWindowUnknown_WhenTheShellOpens_ThenItsRowSaysSoBesideTheKnownMeter", async () => {
    await open([reading("5h", 42)]);
    await screen.findByRole("meter", { name: "5-hour quota used" });
    expect(screen.getByText(/^Weekly · unknown/)).toBeTruthy();
  });
});

describe("quota gauge when a reading is missing or the read fails (AI-328)", () => {
  it("GivenTheQuotaReadFails_WhenTheShellOpens_ThenTheGaugeStillSaysUnknownWithItsHint", async () => {
    const harness = renderApp("/all/inbox");
    vi.spyOn(harness.quota, "latest").mockRejectedValue(new Error("store down"));
    await harness.router.invalidate();
    const gauge = await screen.findByText("Quota unknown");
    // The failed-read gauge shows at every width, not only on a phone.
    expect(gauge.className).not.toContain("md:hidden");
    expect(screen.queryByRole("list", { name: "Claude quota" })).toBeNull();
    expect(gauge.getAttribute("title")).toMatch(/don't assume there is headroom/);
    expect(within(gauge).getByText(/don't assume there is headroom/).className).toContain(
      "sr-only",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("GivenNoReadings_WhenTheShellOpens_ThenScreenReadersHearTheHintOnce", async () => {
    await open([]);
    const marker = await screen.findByText("Quota unknown");
    expect(within(marker).getAllByText(/don't assume there is headroom/)).toHaveLength(1);
  });
});

/** AI-176: M7.6: on a phone the header shows the fullest window and a one-tap pause. */
describe("phone quota and pause", () => {
  beforeEach(() => emulateWidth(true));
  afterEach(() => vi.unstubAllGlobals());

  it("GivenTwoWindows_WhenTheShellOpens_ThenThePhoneGaugeShowsTheFullest", async () => {
    await open([reading("5h", 42), reading("weekly", 61)]);
    expect(await screen.findByText("Quota 61%")).toBeTruthy();
  });

  it("GivenNoReadings_WhenTheShellOpens_ThenThePhoneGaugeSaysUnknown", async () => {
    await open([]);
    expect(await screen.findByText("Quota unknown")).toBeTruthy();
  });

  it("GivenTheInbox_WhenAndyTapsPauseThenResume_ThenDispatchPausesAndResumes", async () => {
    const harness = await open([reading("5h", 42), reading("weekly", 10)]);
    fireEvent.click(await screen.findByRole("button", { name: "Pause dispatch for AI" }));
    const resume = await screen.findByRole("button", { name: "Resume dispatch for AI" });
    expect(resume.getAttribute("aria-pressed")).toBe("true");
    expect((await harness.tracker.getProject("ai"))?.paused).toBe(true);

    fireEvent.click(resume);
    await screen.findByRole("button", { name: "Pause dispatch for AI" });
    expect((await harness.tracker.getProject("ai"))?.paused).toBe(false);
  });

  it("GivenTwoProjectsAndTheAllScope_WhenTheShellOpens_ThenNoPauseButton", async () => {
    const harness = await open([reading("5h", 42)]);
    await screen.findByRole("button", { name: "Pause dispatch for AI" });
    await harness.tracker.createProject({ name: "Other", key: "OT" });
    await harness.queryClient.invalidateQueries();
    await screen.findByText("Quota 42%");
    await waitFor(() => expect(screen.queryByRole("button", { name: /dispatch for/ })).toBeNull());
  });
});
