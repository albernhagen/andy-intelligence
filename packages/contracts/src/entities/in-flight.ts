import { z } from "zod";
import { Id, RunStep, Timestamp } from "./common";

/** Conflict-aware dispatch (ADR-0080): what a run will edit, and its reserved ADR number. */

/** Most paths a run records: the ticket's `touches` (20) plus the approved plan's files. */
export const RUN_TOUCHES_MAX = 100;
const Path = z.string().max(300);

/** The highest ADR number a reservation can hold (four digits, as the files are named). */
export const ADR_NUMBER_MAX = 9999;
export const AdrNumber = z.number().int().positive().max(ADR_NUMBER_MAX);

/** Spread into `Run`. Defaults keep older documents readable (no schema version bump). */
export const runInFlightFields = {
  /**
   * Path globs the run may edit: the ticket's `touches` at start plus the approved plan's files.
   * Empty means unknown, which overlaps everything (ADR-0080).
   */
  touches: z.array(Path).max(RUN_TOUCHES_MAX).default([]),
  /** A build run's ADR number, reserved at start and never reused; null when none was. */
  reservedAdr: AdrNumber.nullable().default(null),
};

/** One run in flight as the in-flight view shows it (API, MCP `list_in_flight`, board panel). */
export const InFlightRun = z.object({
  runId: Id,
  /** Null for a run without a ticket. */
  ticketKey: z.string().nullable(),
  /** Untrusted text. */
  ticketTitle: z.string().nullable(),
  step: RunStep,
  status: z.enum(["queued", "running"]),
  /** The branch a build run pushes; null for other steps. */
  branch: z.string().nullable(),
  pullRequest: z.string().nullable(),
  startedAt: Timestamp.nullable(),
  touches: z.array(Path),
  reservedAdr: AdrNumber.nullable(),
});
export type InFlightRun = z.infer<typeof InFlightRun>;
