/**
 * Fixed-window counter, per instance. Caps Firestore lookups that unauthenticated callers
 * can trigger (ADR-0028). With max 2 instances the cap is 2 × limit per window.
 */
export class FixedWindowLimiter {
  private windowStart = 0;
  private count = 0;
  private refused = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** True if the call is within the cap (and counts it). */
  tryTake(): boolean {
    const t = this.now();
    if (t - this.windowStart >= this.windowMs) {
      this.windowStart = t;
      this.count = 0;
      this.refused = 0;
    }
    if (this.count >= this.limit) {
      this.refused++;
      return false;
    }
    this.count++;
    return true;
  }

  /** True only for the first refusal in the current window: log that one, not every one. */
  firstRefusalInWindow(): boolean {
    return this.refused === 1;
  }
}
