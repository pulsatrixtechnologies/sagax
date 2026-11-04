import { describe, expect, it, vi } from "vitest";
import { callRoutinesTool, DEF_RUN_ROUTINE } from "./routines.ts";
import type { ToolCallContext } from "../agents-call-types.ts";
describe("run_routine readiness", () => {
  it("forwards check to the internal bridge and returns the structured result without starting", async () => {
    const answer = { ok: false, checks: [{ kind: "skills", ok: false, code: "skill_missing", params: { skill: "inbox-review" }, line: "Missing skill. Assign it." }], checkedAt: 123 };
    const api = vi.fn(async () => answer);
    const result = await callRoutinesTool("run_routine", { routine_id: "r1", action: "check" }, { botId: "osprey", threadId: "t1", client: { api } } as unknown as ToolCallContext);
    expect(api).toHaveBeenCalledWith("/api/internal/routine-run", { method: "POST", body: JSON.stringify({ fromBotId: "osprey", fromThreadId: "t1", routineId: "r1", action: "check" }) });
    expect(JSON.parse(result!.text)).toEqual(answer);
    expect(DEF_RUN_ROUTINE.inputSchema.properties.action.enum).toContain("check");
  });
});
