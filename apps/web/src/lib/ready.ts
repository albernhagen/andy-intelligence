import { Confidence, ReadyFilters, Risk, Size } from "@andy/contracts";

/** The URL's filters, keeping only values `list_ready` accepts. */
export function readySearch(search: Record<string, unknown>): ReadyFilters {
  const parsed = ReadyFilters.safeParse({
    size: Size.safeParse(search.size).data,
    risk: Risk.safeParse(search.risk).data,
    confidence: Confidence.safeParse(search.confidence).data,
  });
  return parsed.success ? parsed.data : {};
}
