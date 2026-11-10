// #3463 (lot 3 of #3451): the orchestrator names the piece of work, the
// step and its plan when it hands work over, through optional fields on
// coordinate_bots and send_to_bot. One line each, the three sizes of the
// design, secrets redacted, a bot of the plan resolved like bot_ids, and
// a call without them reads exactly as before.
import { describe, expect, it, vi } from "vitest";
import { TEAM_PLAN_STEPS, TEAM_STEP_NAME_CHARS, TEAM_WORK_NAME_CHARS } from "../../../shared/team-work.ts";
import { resolveTeammate } from "../../peers/peer-roster.ts";
import { workLabel } from "../../team-work/work-label.ts";
import type { ToolCallContext } from "../agents-call-types.ts";
import { DEF_COORDINATE_BOTS, DEF_SEND_TO_BOT, callCoreTool } from "./core.ts";

type Props = Record<string, { type?: string; items?: { type?: string; properties?: Record<string, unknown> } }>;

const context = (api: ReturnType<typeof vi.fn>) => ({ botId: "orc", threadId: "t1", depth: 0, client: { api } }) as unknown as ToolCallContext;
const body = (api: ReturnType<typeof vi.fn>, call = 0) => JSON.parse(String(api.mock.calls[call]![1]!.body)) as Record<string, unknown>;

describe("work, step and plan on the two hand-over tools (#3463)", () => {
  it("are optional fields of coordinate_bots and send_to_bot", () => {
    for (const def of [DEF_COORDINATE_BOTS, DEF_SEND_TO_BOT]) {
      const props = def.inputSchema.properties as Props;
      expect(props.work?.type, def.name).toBe("string");
      expect(props.step?.type, def.name).toBe("string");
      expect(props.plan?.type, def.name).toBe("array");
      expect(props.plan?.items?.properties, def.name).toHaveProperty("step");
      expect(props.plan?.items?.properties, def.name).toHaveProperty("bot");
      for (const field of ["work", "step", "plan"]) expect(def.inputSchema.required, def.name).not.toContain(field);
    }
  });

  it("are passed on to the hand-over routes, and a call without them sends what it sent before", async () => {
    const api = vi.fn(async (path: string) => path === "/api/internal/threads"
      ? { threadId: "t2", state: "running", botName: "Dev", title: "Write the fix" } : { receipts: [], message: "End your turn" });
    const plan = [{ step: "Write the fix", bot: "dev" }, { step: "Review" }];
    await callCoreTool("coordinate_bots", { bot_ids: ["dev"], message: "Fix the login", work: "Login fix", step: "Write the fix", plan }, context(api));
    expect(body(api, 0)).toMatchObject({ work: "Login fix", step: "Write the fix", plan });
    await callCoreTool("send_to_bot", { bot_id: "dev", title: "Write the fix", message: "Fix the login", work: "Login fix", step: "Write the fix", plan }, context(api));
    expect(body(api, 1)).toMatchObject({ work: "Login fix", step: "Write the fix", plan });
    await callCoreTool("coordinate_bots", { bot_ids: ["dev"], message: "Fix the login" }, context(api));
    await callCoreTool("send_to_bot", { bot_id: "dev", title: "Write the fix", message: "Fix the login" }, context(api));
    for (const call of [2, 3]) for (const field of ["work", "step", "plan"]) expect(body(api, call)).not.toHaveProperty(field);
  });

  it("the send's answer names the open pieces of work, so the next hand-over can reuse a name", async () => {
    const api = vi.fn(async () => ({ threadId: "t2", state: "running", botName: "Dev", title: "Write the fix", openWork: ["Login fix", "Release 2"] }));
    const result = await callCoreTool("send_to_bot", { bot_id: "dev", title: "Write the fix", message: "Fix the login", work: "Login fix" }, context(api));
    expect(result?.text).toContain('"Login fix"');
    expect(result?.text).toContain('"Release 2"');
    const none = vi.fn(async () => ({ threadId: "t2", state: "running", botName: "Dev", title: "Write the fix" }));
    expect((await callCoreTool("send_to_bot", { bot_id: "dev", title: "Write the fix", message: "Fix the login" }, context(none)))?.text).not.toMatch(/pieces of work/i);
  });
});

describe("workLabel: what the runtime row stores (#3463)", () => {
  const bots = [
    { id: "orc", name: "Orchestrator", ownerId: "p1" },
    { id: "dev", name: "Dev", ownerId: "p1" },
    { id: "rev", name: "Reviewer", ownerId: "p1" },
  ];
  const from = bots[0]!;
  const resolve = (raw: string) => { const found = resolveTeammate(bots as never, from as never, raw); return "id" in found ? found.id : undefined; };

  it("is absent when no field is given, or none holds words", () => {
    expect(workLabel({}, resolve)).toBeUndefined();
    expect(workLabel({ work: "  ", step: "\n", plan: [] }, resolve)).toBeUndefined();
    expect(workLabel({ work: 42, step: { a: 1 }, plan: "Write" }, resolve)).toBeUndefined();
  });

  it("keeps one line each, at most 80 characters for the work, 40 for a step and 12 steps", () => {
    const label = workLabel({
      work: `Login\nfix   ${"w".repeat(200)}`,
      step: `Write\r\nthe fix ${"s".repeat(100)}`,
      plan: Array.from({ length: 20 }, (_, index) => ({ step: `Step ${index + 1}\nmore ${"p".repeat(60)}` })),
    }, resolve)!;
    expect(label.name).not.toMatch(/\n/);
    expect(label.name!.startsWith("Login fix w")).toBe(true);
    expect(label.name!.length).toBeLessThanOrEqual(TEAM_WORK_NAME_CHARS);
    expect(label.step!.startsWith("Write the fix s")).toBe(true);
    expect(label.step!.length).toBeLessThanOrEqual(TEAM_STEP_NAME_CHARS);
    expect(label.plan).toHaveLength(TEAM_PLAN_STEPS);
    for (const step of label.plan!) {
      expect(step.name).not.toMatch(/\n/);
      expect(step.name.length).toBeLessThanOrEqual(TEAM_STEP_NAME_CHARS);
    }
    expect([TEAM_WORK_NAME_CHARS, TEAM_STEP_NAME_CHARS, TEAM_PLAN_STEPS]).toEqual([80, 40, 12]);
  });

  it("redacts secrets in every field", () => {
    const secret = "password=hunter2hunter2hunter2";
    const label = workLabel({ work: `Deploy ${secret}`, step: `Use ${secret}`, plan: [{ step: `Set ${secret}` }] }, resolve)!;
    expect(JSON.stringify(label)).not.toContain("hunter2hunter2");
  });

  it("resolves a bot of the plan like bot_ids: an id, a unique name; an unknown one is left out", () => {
    const label = workLabel({ work: "Login fix", plan: [
      { step: "Write the fix", bot: "dev" },
      { step: "Review", bot: "@reviewer" },
      { step: "Ship", bot: "nobody" },
      "Announce",
    ] }, resolve)!;
    expect(label.plan).toEqual([
      { name: "Write the fix", botId: "dev" },
      { name: "Review", botId: "rev" },
      { name: "Ship" },
      { name: "Announce" },
    ]);
  });

  it("keeps a plan only with a name for the work, and one entry per step name", () => {
    expect(workLabel({ step: "Write the fix", plan: [{ step: "Write the fix" }] }, resolve)).toEqual({ step: "Write the fix" });
    expect(workLabel({ work: "Login fix", plan: [{ step: "Review" }, { step: " review " }] }, resolve)!.plan).toEqual([{ name: "Review" }]);
  });
});
