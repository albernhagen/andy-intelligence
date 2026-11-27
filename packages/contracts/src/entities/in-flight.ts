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

/**
 * A session's hold on an ADR number (AI-384), drawn from the same per-project counter as build
 * runs, so the two never get the same number. Kept on the counter itself; the number is never
 * handed out again, even after the hold is released (an unused one is a gap, like 0161).
 */
export const AdrHold = z.object({
  number: AdrNumber,
  /** The ticket key the number is for ("AI-384"): its PR merging or closing releases the hold. */
  holder: z.string().regex(/^[A-Z][A-Z0-9]{0,9}-\d+$/),
  reservedAt: Timestamp,
  /** Past this, the hold no longer counts against the caps and is dropped on the next write. */
  expiresAt: Timestamp,
});
export type AdrHold = z.infer<typeof AdrHold>;

/** A session's hold request: who, when, and the caps checked in the same transaction. */
export interface AdrHoldRequest {
  holder: string;
  now: string;
  expiresAt: string;
  /** Most open holds one holder (ticket) may have. */
  perHolder: number;
  /** Most open holds across the project. */
  perProject: number;
}

/** A hold was taken, or refused at a cap with the open holds that fill it. */
export type AdrHoldResult =
  | { ok: true; hold: AdrHold }
  | { ok: false; reason: "holder_cap" | "project_cap"; open: AdrHold[] };
