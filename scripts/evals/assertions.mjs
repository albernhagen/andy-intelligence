// The fixed check vocabulary for eval cases (AI-6, ADR-0086). Messages are built from the case,
// never from the agent's text, so a run summary can't carry model output.

const lower = (v) => (typeof v === "string" ? v.toLowerCase() : "");

function findingText(f) {
  return [f.title, f.scenario, f.description, f.recommendation].map(lower).join(" ");
}

function matches(f, check) {
  if (check.severity && !check.severity.includes(f?.severity)) return false;
  if (check.file && !String(f?.file ?? "").endsWith(check.file)) return false;
  if (check.mentions && !check.mentions.some((m) => findingText(f).includes(m.toLowerCase()))) {
    return false;
  }
  return true;
}

function describe(check) {
  const sev = check.severity ? `${check.severity.join("/")} ` : "";
  const file = check.file ? ` in a file ending ${check.file}` : "";
  const mentions = check.mentions ? ` mentioning one of: ${check.mentions.join(", ")}` : "";
  return `${sev}finding${file}${mentions}`;
}

/** Failed checks for one structured output; an empty list means every check passed. */
export function checkOutput(output, checks) {
  const findings = Array.isArray(output?.findings) ? output.findings : null;
  if (findings === null) return ["output has no findings list"];
  const failures = [];
  for (const check of checks) {
    const count = findings.filter((f) => matches(f, check)).length;
    if (check.check === "finding" && count === 0)
      failures.push(`expected a ${describe(check)}: none`);
    if (check.check === "no-finding" && count > 0) {
      failures.push(`expected no ${describe(check)}: got ${count}`);
    }
    if (check.check === "max-findings" && count > check.max) {
      failures.push(`expected at most ${check.max} ${describe(check)}s: got ${count}`);
    }
  }
  return failures;
}
