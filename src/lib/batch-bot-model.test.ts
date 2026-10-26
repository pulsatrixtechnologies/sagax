import { describe, expect, it } from "vitest";
import { batchModelActions } from "./batch-bot-model";

const selection = { instanceId: "claude", model: "opus", effort: "high" as const };

describe("batchModelActions", () => {
  it("writes the same model and effort as each bot's default", () => {
    expect(batchModelActions([
      { id: "a", threadId: "ta" },
      { id: "b", threadId: "tb", busy: true },
      { id: "c", threadId: "" },
    ], selection)).toEqual([
      { type: "setModel", botId: "a", threadId: "ta", updateBotDefault: true, selection },
    ]);
  });
});
