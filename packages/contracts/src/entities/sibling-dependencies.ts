/**
 * Why a list of drafted tickets' sibling links is invalid: self, unknown or repeated indexes, or
 * a cycle. `blockedBy` holds 0-based indexes of other items in the same list. Shared by refine's
 * split (`RefineOutput`, M4.3) and epic breakdowns (`EpicBreakdownProposal`, AI-383).
 */
export function siblingDependencyIssues(
  children: readonly { blockedBy: readonly number[] }[],
): string[] {
  const issues: string[] = [];
  children.forEach((child, i) => {
    if (new Set(child.blockedBy).size !== child.blockedBy.length) {
      issues.push(`child ${i} names a sibling twice`);
    }
    for (const b of child.blockedBy) {
      if (b === i) issues.push(`child ${i} is blocked by itself`);
      else if (b >= children.length)
        issues.push(`child ${i} is blocked by child ${b}, not in the output`);
    }
  });
  if (issues.length > 0) return issues;
  // Repeatedly settle children whose blockers are all settled; any left over are in a cycle.
  const settled = new Set<number>();
  let progressed = true;
  while (progressed) {
    progressed = false;
    children.forEach((child, i) => {
      if (!settled.has(i) && child.blockedBy.every((b) => settled.has(b))) {
        settled.add(i);
        progressed = true;
      }
    });
  }
  if (settled.size < children.length) issues.push("children block each other in a cycle");
  return issues;
}
