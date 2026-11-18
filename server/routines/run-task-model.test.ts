import { describe, expect, it } from "vitest";

import { runTaskModel } from "./run-task-model.ts";

const GROK = { instanceId: "grok", model: "grok-4.7", effort: "xhigh" as const };

describe("#4711: a bot run's task starts on the model the chat chip shows", () => {
  it("takes the model the person picked in their conversation", () => {
    const picked = runTaskModel({ conversation: { modelSelection: GROK } });
    expect(picked).toEqual(GROK);
    // a copy: the run's task never shares the conversation's record
    expect(picked).not.toBe(GROK);
  });

  it("follows the bot when the conversation follows it", () => {
    expect(runTaskModel({ conversation: {} })).toBeUndefined();
    expect(runTaskModel({ conversation: null })).toBeUndefined();
  });

  it("keeps a routine's own model, which the person chose for that routine", () => {
    expect(runTaskModel({ routineModel: "claude-sonnet", conversation: { modelSelection: GROK } })).toBeUndefined();
  });
});
