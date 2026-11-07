import { describe, expect, it, vi } from "vitest";
import { callRoutinesTool, DEF_RUN_ROUTINE } from "./routines.ts";
import type { ToolCallContext } from "../agents-call-types.ts";
describe("routine effort tools", () => {
  it("forwards low effort on create and a null reset on update", async () => {
    const api = vi.fn(async (_path: string, _options?: { body?: string }) => ({ state: "applied" }));
    const context = { botId: "bot", threadId: "thread", client: { api } } as unknown as ToolCallContext;
    await callRoutinesTool("propose_routine", { name: "Check", instructions: "Check the inbox", schedule: { type: "interval", every_minutes: 60 }, effort: "low" }, context);
    expect(JSON.parse(api.mock.calls[0]![1]!.body as string).routine.effort).toBe("low");
    await callRoutinesTool("propose_routine_action", { routine_id: "r1", action: "update", changes: { effort: null } }, context);
    expect(JSON.parse(api.mock.calls[1]![1]!.body as string).changes).toEqual({ effort: null });
    const invalid = await callRoutinesTool("propose_routine_action", { routine_id: "r1", action: "update", changes: { effort: "invalid" } }, context);
    expect(invalid?.isError).toBe(true);
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("forwards subagent_model on create and a null reset on update (#2038)", async () => {
    const api = vi.fn(async (_path: string, _options?: { body?: string }) => ({ state: "applied" }));
    const context = { botId: "bot", threadId: "thread", client: { api } } as unknown as ToolCallContext;
    await callRoutinesTool("propose_routine", { name: "Workers", instructions: "Spawn agents", schedule: { type: "interval", every_minutes: 60 }, subagent_model: "haiku-fast" }, context);
    expect(JSON.parse(api.mock.calls[0]![1]!.body as string).routine.subagentModel).toBe("haiku-fast");
    await callRoutinesTool("propose_routine_action", { routine_id: "r1", action: "update", changes: { subagent_model: null } }, context);
    expect(JSON.parse(api.mock.calls[1]![1]!.body as string).changes).toEqual({ subagentModel: null });
  });
});

describe("routine sub-agent model tool field (#2049)", () => {
  it("forwards subagent_model as subagentModel, with a null reset on update", async () => {
    const api = vi.fn(async (_path: string, _options?: { body?: string }) => ({ state: "applied" }));
    const context = { botId: "bot", threadId: "thread", client: { api } } as unknown as ToolCallContext;
    await callRoutinesTool("propose_routine_action", { routine_id: "r1", action: "update", changes: { subagent_model: "sonnet" } }, context);
    expect(JSON.parse(api.mock.calls[0]![1]!.body as string).changes).toEqual({ subagentModel: "sonnet" });
    await callRoutinesTool("propose_routine_action", { routine_id: "r1", action: "update", changes: { subagent_model: null } }, context);
    expect(JSON.parse(api.mock.calls[1]![1]!.body as string).changes).toEqual({ subagentModel: null });
    const invalid = await callRoutinesTool("propose_routine_action", { routine_id: "r1", action: "update", changes: { subagent_model: 3 } }, context);
    expect(invalid?.isError).toBe(true);
  });
});

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

describe("propose_routine GitHub trigger (I3)", () => {
  it("forwards a GitHub trigger with its events and filters, and refuses unknown keys", async () => {
    const api = vi.fn(async (_path: string, _options?: { body?: string }) => ({ state: "applied" }));
    const context = { botId: "bot", threadId: "thread", client: { api } } as unknown as ToolCallContext;
    const trigger = { type: "github", events: ["issue.labeled", "pr.review_requested"], filters: { repo: ["acme/api"] } };
    await callRoutinesTool("propose_routine", { name: "Triage", instructions: "Triage the issue.", trigger }, context);
    expect(JSON.parse(api.mock.calls[0]![1]!.body as string).routine.trigger).toEqual(trigger);
    const bad = await callRoutinesTool("propose_routine", { name: "Triage", instructions: "x", trigger: { type: "github", secret: "s" } }, context);
    expect(bad?.isError).toBe(true);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("offers github and the GitHub event kinds in the tool schema", async () => {
    const { DEF_PROPOSE_ROUTINE } = await import("./routines.ts");
    const trigger = DEF_PROPOSE_ROUTINE.inputSchema.properties.trigger;
    expect(trigger.properties.type.enum).toContain("github");
    expect(trigger.properties.events.items.enum).toEqual(expect.arrayContaining(["issue.opened", "issue.labeled", "pr.opened", "pr.review_requested"]));
  });
});
