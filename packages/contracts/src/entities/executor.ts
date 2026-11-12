import { z } from "zod";

/**
 * Where a ticket's agent runs execute (ADR-0089): on the cloud CI executor (`actions`, the
 * default) or on Andy's own machine through the local runner (`local`). A project default plus a
 * typed ticket override, never a label; resolved at read time and never copied onto the ticket.
 */
export const ExecutorKind = z.enum(["actions", "local"]);
export type ExecutorKind = z.infer<typeof ExecutorKind>;

/**
 * Where the next run goes once runner presence is known: `wait` is a ticket overriding to
 * `local` while no runner is present (ADR-0089 open question 3: it waits, it doesn't fall back).
 */
export const ResolvedExecutor = z.enum(["actions", "local", "wait"]);
export type ResolvedExecutor = z.infer<typeof ResolvedExecutor>;

/** A ticket's executor as read: what it asks for, and the two inputs it came from. */
export const ExecutorView = z.object({
  /** The ticket's pick if it has one, else the project's default. */
  executor: ExecutorKind,
  /** The ticket's own pick; null when it follows the project's default. */
  override: ExecutorKind.nullable(),
  projectDefault: ExecutorKind,
  /** Where its next run goes now: `wait` while it overrides to `local` and no runner is present. */
  next: ResolvedExecutor,
  /** Whether a runner serving its project is present (polled in the last 2 minutes). */
  runnerPresent: z.boolean(),
});
export type ExecutorView = z.infer<typeof ExecutorView>;

/** `executor: null` clears the ticket's pick, so it follows the project's default again. */
export const SetExecutor = z.object({ executor: ExecutorKind.nullable() });
export type SetExecutor = z.infer<typeof SetExecutor>;
