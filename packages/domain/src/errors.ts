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
      | "spend_cap"
      | "run_finished"
      | "executor_unavailable"
      | "dispatch_failed"
      | "cancel_failed"
      | "plan_not_decidable"
      | "not_promotable"
      | "invalid_reference"
      | "not_clearable"
      | "not_acceptable"
      | "runner_limit"
      | "runs_elsewhere"
      | "brief_too_long"
      | "code_host_unavailable"
      | "rate_limited"
      | "not_revertible"
      | "invalid_field",
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = "DomainError";
  }
}
