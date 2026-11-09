import { z } from "zod";

/**
 * Who does a ticket's work (ADR-0082). A project's default and a resolved worker are one of these;
 * `ask` means nobody yet: Andy has to pick before anything can build it.
 */
export const Worker = z.enum(["agent", "me", "ask"]);
export type Worker = z.infer<typeof Worker>;

/** What Andy can pick on one ticket. */
export const WorkerChoice = z.enum(["agent", "me"]);
export type WorkerChoice = z.infer<typeof WorkerChoice>;

/** A ticket's worker as read: the result, and the two inputs it came from. */
export const WorkerView = z.object({
  worker: Worker,
  /** The ticket's own pick; null when it follows the project's default. */
  override: WorkerChoice.nullable(),
  projectDefault: Worker,
});
export type WorkerView = z.infer<typeof WorkerView>;

/** `worker: null` clears the ticket's pick, so it follows the project's default again. */
export const SetWorker = z.object({ worker: WorkerChoice.nullable() });
export type SetWorker = z.infer<typeof SetWorker>;
