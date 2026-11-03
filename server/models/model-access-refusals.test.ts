import { describe, expect, it } from "vitest";

import { createModelAccessRefusals, personPayer, withoutRefusedModels } from "./model-access-refusals.ts";

const opencode = {
  instanceId: "opencode",
  models: { default: "opencode/big", options: [{ id: "opencode/big" }, { id: "opencode/free" }] },
};

describe("#1450 a model the paying account turned off", () => {
  it("leaves the lists of the payer it was refused for, and only theirs", () => {
    const refusals = createModelAccessRefusals();
    refusals.remember("org", "opencode", "opencode/big");
    expect([...refusals.refused(["org"], "opencode")]).toEqual(["opencode/big"]);
    expect(refusals.refused([personPayer("pr_a")], "opencode").size).toBe(0);
    expect(refusals.refused(["org"], "other").size).toBe(0);
  });

  it("comes back once the refusal is old, in case the account turned it on again", () => {
    let at = 0;
    const refusals = createModelAccessRefusals({ ttlMs: 1_000, now: () => at });
    refusals.remember(personPayer("PR_A"), "opencode", "opencode/big");
    expect(refusals.refused([personPayer("pr_a")], "opencode").has("opencode/big")).toBe(true);
    at = 1_000;
    expect(refusals.refused([personPayer("pr_a")], "opencode").size).toBe(0);
  });

  it("drops the refused model from the engine and moves its default", () => {
    const [shown] = withoutRefusedModels([opencode], () => new Set(["opencode/big"]));
    expect(shown.models).toEqual({ default: "opencode/free", options: [{ id: "opencode/free" }] });
    expect(withoutRefusedModels([opencode], () => new Set())[0]).toBe(opencode);
  });
});
