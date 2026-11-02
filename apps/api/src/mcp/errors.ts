/** An OAuth error response (RFC 6749 §4.1.2.1, §5.2). */
export class OAuthError extends Error {
  constructor(
    readonly code:
      | "invalid_request"
      | "invalid_client"
      | "invalid_grant"
      | "invalid_scope"
      | "invalid_target"
      | "unsupported_grant_type",
    readonly description: string,
  ) {
    super(`${code}: ${description}`);
    this.name = "OAuthError";
  }

  toJSON() {
    return { error: this.code, error_description: this.description };
  }
}
