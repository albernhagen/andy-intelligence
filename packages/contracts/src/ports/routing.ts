import type { RoutingConfig, RoutingConfigInput } from "../entities/routing";

// ── RoutingConfigStore ───────────────────────────────────────────────────────
// Model routing config (AI-230: M9.3): one global document and at most one per project.
// Storage only: who may edit it, compatibility and narrowing live in @andy/domain and the API.
// Errors are WorkTrackerError (`conflict`), mapped the same way by the API.

export interface RoutingConfigStore {
  /** The global config; `DEFAULT_ROUTING` (updatedAt null) while none is stored. */
  getGlobal(): Promise<RoutingConfig>;
  /** The project's config, or null when it has none (it then follows global) or the id isn't a project key. */
  getProject(projectId: string): Promise<RoutingConfig | null>;
  /**
   * Stores the config for its scope and stamps `updatedAt` (always later than the one it
   * replaces). `ifUpdatedAt` is the `updatedAt` the caller read: null when none was stored.
   * Anything else is stale and refused with `conflict`; nothing is written.
   */
  put(config: RoutingConfigInput, ifUpdatedAt: string | null): Promise<RoutingConfig>;
}
