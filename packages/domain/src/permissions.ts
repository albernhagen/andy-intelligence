import type { EventActor } from "@andy/contracts";
import { DomainError } from "./errors";

/**
 * The one permission function for owner-only rules (AI-19). Every rule that only the owner may
 * use asks `can` (or `requireCan`); nothing else compares actors. Today the owner is the single
 * allow-listed user: every `user:<uid>` actor passed the API's allow-list, and the stored
 * legacy actor `andy` means the owner. Agents and the system get none of these actions; what
 * they may do is decided by the rules themselves. Project members (AI-18) change only this file.
 */
export const OWNER_ACTIONS = {
  force_move: "force a stage move",
  reopen_ticket: "reopen a cancelled ticket",
  cancel_ticket: "cancel a ticket",
  archive_ticket: "archive a ticket",
  start_run: "start an agent task",
  answer_question: "answer a question",
  promote_assumption: "promote an assumption",
  accept_assumption: "accept a held gap",
  decide_plan: "approve or reject a plan",
  set_worker: "choose who works a ticket",
  change_project_settings: "change project settings",
  clear_quota_idle: "clear a quota idle",
} as const;

export type OwnerAction = keyof typeof OWNER_ACTIONS;

/** The stored actor before AI-19; read as the owner forever (no migration). */
const LEGACY_OWNER = "andy";

/** The display label of the owner, derived at read time and never stored. */
export const OWNER_LABEL = "Andy";

/** The actor a signed-in user acts as: their auth uid, never their email (ADR-0015). */
export function userActor(uid: string): EventActor {
  if (!uid) throw new Error("a signed-in user needs a uid");
  return `user:${uid}`;
}

export function isOwner(actor: EventActor): boolean {
  return actor === LEGACY_OWNER || actor.startsWith("user:");
}

/**
 * Whether `actor` may do `action` in project `projectId`. The project is unused until members
 * (AI-18), which decide per project.
 */
export function can(actor: EventActor, action: OwnerAction, projectId: string | null): boolean {
  void action;
  void projectId;
  return isOwner(actor);
}

/** `can`, or a `forbidden` DomainError saying who may: the same code callers get today. */
export function requireCan(actor: EventActor, action: OwnerAction, projectId: string | null): void {
  if (can(actor, action, projectId)) return;
  console.log(
    JSON.stringify({
      severity: "WARNING",
      message: "owner-only action refused",
      component: "permissions",
      action,
      actor,
      projectId,
    }),
  );
  throw new DomainError("forbidden", `only the owner can ${OWNER_ACTIONS[action]}`);
}

/** How history shows an actor: the owner (old `andy` or a user uid) by label; others as stored. */
export function actorLabel(actor: EventActor): string {
  return isOwner(actor) ? OWNER_LABEL : actor;
}
