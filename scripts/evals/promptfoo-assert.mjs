// promptfoo `javascript` assertion (AI-6): runs a case's checks (from the test's metadata, which
// the runner wrote from a validated case) against the agent's structured output.
import { checkOutput } from "./assertions.mjs";

export default function assertCase(output, context) {
  let parsed;
  try {
    parsed = typeof output === "string" ? JSON.parse(output) : output;
  } catch {
    return { pass: false, score: 0, reason: "output is not JSON" };
  }
  const failures = checkOutput(parsed, context.test.metadata?.expect ?? []);
  return failures.length
    ? { pass: false, score: 0, reason: failures.join("\n") }
    : { pass: true, score: 1, reason: "all checks passed" };
}
