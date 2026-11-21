// ── ProjectVersions ──────────────────────────────────────────────────────────
// One change counter per project (AI-222: Firestore reads grow with project size). Every write
// that changes what the board or a ticket list shows bumps it; a reader that cached a project's
// view at version N serves the cache while the counter still reads N, so an unchanged poll costs
// one document read instead of one per ticket.

export interface ProjectVersions {
  /** The project's counter: 0 before its first bump. Reads one document. */
  get(projectId: string): Promise<number>;
  /** Adds one. Never reads, so concurrent bumps from two instances all count. */
  bump(projectId: string): Promise<void>;
}
