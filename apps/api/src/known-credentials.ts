import { hashToken } from "./mcp/tokens";

/**
 * Hashes of credentials that verified recently (ADR-0094). A caller presenting one skips the
 * unauthenticated lookup cap, so a flood of guessed runner secrets or per-run tokens can use up
 * that cap without locking out the real runner. Knowing a hash grants nothing: the caller is
 * still verified against the store on every request (so a revoke applies at once). Bounded:
 * at most `maxEntries` hashes, each forgotten `ttlMs` after its last use.
 */
export class KnownCredentials {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  has(credential: string): boolean {
    const key = hashToken(credential);
    const at = this.seen.get(key);
    if (at === undefined) return false;
    if (this.now() - at >= this.ttlMs) {
      this.seen.delete(key);
      return false;
    }
    return true;
  }

  /** Records a credential that just verified; the oldest entry goes when full. */
  remember(credential: string): void {
    const key = hashToken(credential);
    this.seen.delete(key);
    if (this.seen.size >= this.maxEntries) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.set(key, this.now());
  }
}
