import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { QuotaReading } from "@andy/contracts";
import { renderApp } from "@/test/harness";

/** M1.9: Quota capture: the header gauge and the persistent banner, over the real API. */

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
    expect(screen.getByText("42%")).toBeTruthy();
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

  it("GivenAWindowPastPause_WhenTheShellOpens_ThenThePauseBannerSaysRunsAreNotPausedYet", async () => {
    await open([reading("5h", 75), reading("weekly", 85)]);
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toMatch(/pause level \(80%\): Weekly 85%/);
    expect(banner.textContent).toMatch(/not paused automatically yet/);
  });

  it("GivenNoReadings_WhenTheShellOpens_ThenTheGaugeAndALowerSeverityBannerShowUnknown", async () => {
    await open([]);
    await screen.findByText(/Claude quota unknown/);
    const gauge = screen.getByRole("list", { name: "Claude quota" });
    expect(within(gauge).getAllByText("unknown")).toHaveLength(2);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
