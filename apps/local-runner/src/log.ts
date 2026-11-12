/**
 * One JSON line per event on stdout, like the API's logs. Never pass the runner secret, a per-run
 * token or ticket text in `fields`: callers log ids, steps, paths and reasons only.
 */
export type Severity = "INFO" | "WARNING" | "ERROR";

export type Logger = (
  severity: Severity,
  message: string,
  fields?: Record<string, unknown>,
) => void;

export const consoleLogger: Logger = (severity, message, fields = {}) => {
  process.stdout.write(
    `${JSON.stringify({ time: new Date().toISOString(), severity, message, component: "local-runner", ...fields })}\n`,
  );
};

/** An error as one short line for logs and reports. */
export function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500);
}
