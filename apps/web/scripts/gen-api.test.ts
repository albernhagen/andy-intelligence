// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GENERATED_PATH, generateApiTypes } from "./gen-api";

describe("generated API client", () => {
  it("GivenTheCurrentApi_WhenTypesAreRegenerated_ThenTheCheckedInFileMatches", async () => {
    // On failure: run `pnpm --filter @andy/web gen:api` and commit the result.
    expect(await generateApiTypes()).toBe(readFileSync(GENERATED_PATH, "utf8"));
  });
});
