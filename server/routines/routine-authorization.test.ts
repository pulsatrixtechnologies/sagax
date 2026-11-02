import { describe, expect, it } from "vitest";
import { routineOwnerAuthorization } from "./routine-authorization.ts";

const base = {
  run: { id: "run-1", routineId: "routine-1", botId: "bot-1", status: "running", triggerSource: "webhook", runAs: "pr_owner" },
  routine: { id: "routine-1", botId: "bot-1", enabled: true, runAs: "pr_owner" },
  rootBotOwner: "pr_owner", receivingBotOwner: "pr_owner", webhookRoutineId: "routine-1",
};
describe("the owner's webhook routine authorization", () => {
  it("binds the actual active run, routine and current owner", () => {
    expect(routineOwnerAuthorization(base)).toEqual({ runId: "run-1", routineId: "routine-1", botId: "bot-1", principalId: "pr_owner" });
    expect(routineOwnerAuthorization({ ...base, run: { ...base.run, status: "waiting" } })).not.toBeNull();
    // Pausing future runs does not revoke work already authorized and running.
    expect(routineOwnerAuthorization({ ...base, routine: { ...base.routine, enabled: false } })).not.toBeNull();
  });
  it("revokes the grant on owner change, person change, routine deletion, or a completed run", () => {
    for (const change of [
      { receivingBotOwner: "pr_other" }, { rootBotOwner: "pr_other" },
      { run: { ...base.run, runAs: "pr_other" } }, { routine: { ...base.routine, runAs: "pr_other" } },
      { routine: null }, { run: null },
      { run: { ...base.run, status: "completed" } }, { webhookRoutineId: undefined },
      { routine: { ...base.routine, botId: "bot-other" } },
    ]) expect(routineOwnerAuthorization({ ...base, ...change })).toBeNull();
  });
  it("does not infer authorization from an event or a standalone hook", () => {
    expect(routineOwnerAuthorization({ ...base, routine: null })).toBeNull();
    expect(routineOwnerAuthorization({ ...base, run: { ...base.run, routineId: "hook-id" } })).toBeNull();
  });
});
