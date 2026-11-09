import { describe, expect, it } from "vitest";
import { chooseBlock, streamEvents } from "./stub-model.mjs";

const tools = [{ name: "Bash" }];

describe("chooseBlock", () => {
  it("GivenBashOffered_WhenFirstRequest_ThenCallsBashWithTheCommand", () => {
    const block = chooseBlock({ tools, messages: [{ role: "user", content: "go" }] }, "true");
    expect(block).toMatchObject({ type: "tool_use", name: "Bash", input: { command: "true" } });
  });

  it("GivenToolResult_WhenNextRequest_ThenAnswersWithText", () => {
    const content = [{ type: "tool_result", tool_use_id: "x", content: "" }];
    const block = chooseBlock({ tools, messages: [{ role: "user", content }] }, "true");
    expect(block.type).toBe("text");
  });

  it("GivenBashNotOffered_WhenRequested_ThenAnswersWithText", () => {
    expect(chooseBlock({ messages: [{ role: "user", content: "hi" }] }, "true").type).toBe("text");
  });
});

describe("streamEvents", () => {
  it("GivenToolUse_WhenStreamed_ThenStopsForTheToolWithTheInputAsJson", () => {
    const events = streamEvents(
      { type: "tool_use", id: "t", name: "Bash", input: { command: "true" } },
      "m",
    );
    expect(events[2].delta.partial_json).toBe('{"command":"true"}');
    expect(events[4].delta.stop_reason).toBe("tool_use");
    expect(events.at(-1).type).toBe("message_stop");
  });
});
