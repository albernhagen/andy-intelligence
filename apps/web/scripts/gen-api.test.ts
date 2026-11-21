// @vitest-environment node
import { describe, expect, it } from "vitest";
import { apiDocument, generateApiTypes } from "./gen-api";

describe("generated API client", () => {
  it("GivenTheCurrentApi_WhenTypesAreGenerated_ThenEveryPathIsTyped", async () => {
    const [doc, types] = await Promise.all([apiDocument(), generateApiTypes()]);
    const paths = Object.keys(doc.paths ?? {});
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(types).toContain(`"${path}": {`);
  });
});
