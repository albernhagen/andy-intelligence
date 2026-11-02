import { describe, expect, it } from "vitest";
import { greet } from "./index.js";

describe("greet", () => {
  it("GivenAName_WhenGreeting_ThenSaysHello", () => {
    expect(greet("Andy")).toBe("Hello, Andy");
  });
});
