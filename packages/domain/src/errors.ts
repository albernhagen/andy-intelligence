/** A rule violation the caller caused; the API maps codes to HTTP statuses. */
export class DomainError extends Error {
  constructor(
    readonly code:
      | "invalid_transition"
      | "dor_not_met"
      | "forbidden"
      | "invalid_repo"
      | "repo_taken"
      | "invalid_step"
      | "not_refinable"
      | "not_buildable"
      | "run_limit"
      | "run_finished"
      | "executor_unavailable"
      | "dispatch_failed"
      | "cancel_failed"
      | "plan_not_decidable"
      | "not_promotable"
      | "invalid_reference"
      | "not_clearable"
      | "not_acceptable",
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = "DomainError";
  }
}
