import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { InternalRouteContext } from "./internal-route.ts";
import { createRoutineRunInternalRoutes, routineRunNowAllowed } from "./routine-run-internal.ts";
import { PASS } from "./table.ts";

type R = { id: string; botId: string; runAs?: string };
const OWNER = "pr_owner";
const RUN_AS = "pr_runas";
const ADMIN = "pr_admin";
const STRANGER = "pr_stranger";

/** An organization server whose rule is the one POST /api/routines/:id/run applies. */
function setup(speaker: string | undefined, over: { organization?: boolean; inFlight?: boolean } = {}) {
  const runs: string[] = [];
  const audits: Array<{ routine: string; run: string; by: string | undefined }> = [];
  const routines: R[] = [{ id: "r1", botId: "bot-1", runAs: RUN_AS }, { id: "r2", botId: "bot-other" }];
  const route = createRoutineRunInternalRoutes<R, { id: string }>({
    ownsThread: (botId, threadId) => botId === "bot-1" && threadId === "t-1",
    routines: () => routines,
    speaker: () => speaker,
    mayRunNow: (principalId, routine) => routineRunNowAllowed({
      organization: over.organization ?? true,
      person: true,
      ...(principalId ? { principalId } : {}),
      admin: principalId === ADMIN,
      botOwner: OWNER,
      ...(routine.runAs ? { runAs: routine.runAs } : {}),
    }),
    inFlight: () => over.inFlight === true,
    runNow: (id) => { runs.push(id); return { id: `run-${id}` }; },
    audit: (routine, run, by) => audits.push({ routine: routine.id, run: run.id, by }),
  });
  const call = async (body: Record<string, unknown>, ctx: Partial<InternalRouteContext> = {}) => {
    const sent: Array<{ status: number; body: any }> = [];
    const out = await route({
      res: {} as ServerResponse,
      path: "/api/internal/routine-run",
      method: "POST",
      json: ((_res: ServerResponse, status: number, b: unknown) => { sent.push({ status, body: b }); }) as InternalRouteContext["json"],
      capability: { botId: "bot-1", threadId: "t-1", generation: "g" },
      readBody: async () => body,
      ...ctx,
    });
    return { out, sent };
  };
  return { call, runs, audits };
}

describe("POST /api/internal/routine-run", () => {
  it("refuses a person who talks to the bot but is neither its owner, the run-as person nor an admin", async () => {
    const t = setup(STRANGER);
    const { sent } = await t.call({ routineId: "r1" });
    expect(sent).toEqual([{ status: 403, body: expect.objectContaining({ code: "run_now_not_allowed", permission: "routines.runNowAny" }) }]);
    expect(t.runs).toEqual([]);
    expect(t.audits).toEqual([]);
  });

  it("refuses on an organization server when nobody speaks for the turn", async () => {
    const t = setup(undefined);
    expect((await t.call({ routineId: "r1" })).sent[0]?.status).toBe(403);
    expect(t.runs).toEqual([]);
  });

  it("runs for the owner, the run-as person and an admin, and audits who", async () => {
    for (const who of [OWNER, RUN_AS, ADMIN]) {
      const t = setup(who);
      expect((await t.call({ routineId: "r1" })).sent).toEqual([{ status: 201, body: { runId: "run-r1", message: expect.stringContaining("Queued") } }]);
      expect(t.audits).toEqual([{ routine: "r1", run: "run-r1", by: who }]);
    }
  });

  it("keeps the bot-level rule on a solo server", async () => {
    const t = setup(undefined, { organization: false });
    expect((await t.call({ routineId: "r1" })).sent[0]?.status).toBe(201);
  });

  it("only reaches the calling bot's routines, from its own conversation, one run at a time", async () => {
    expect((await setup(OWNER).call({ routineId: "r2" })).sent[0]?.status).toBe(404);
    const foreign = await setup(OWNER).call({ routineId: "r1" }, { capability: { botId: "bot-1", threadId: "t-2", generation: "g" } });
    expect(foreign.sent[0]?.status).toBe(403);
    const busy = setup(OWNER, { inFlight: true });
    expect((await busy.call({ routineId: "r1" })).sent[0]).toMatchObject({ status: 409, body: { code: "run_in_flight" } });
    expect(busy.runs).toEqual([]);
  });

  it("passes other paths", async () => {
    expect((await setup(OWNER).call({}, { path: "/api/internal/routines" })).out).toBe(PASS);
  });
});

describe("routineRunNowAllowed", () => {
  const base = { organization: true, person: true, admin: false, botOwner: OWNER, runAs: RUN_AS };
  it("is the Run now rule", () => {
    expect(routineRunNowAllowed({ ...base, principalId: STRANGER })).toBe(false);
    expect(routineRunNowAllowed({ ...base, principalId: OWNER })).toBe(true);
    expect(routineRunNowAllowed({ ...base, principalId: RUN_AS })).toBe(true);
    expect(routineRunNowAllowed({ ...base, principalId: STRANGER, admin: true })).toBe(true);
    expect(routineRunNowAllowed({ ...base })).toBe(false);
    expect(routineRunNowAllowed({ ...base, person: false })).toBe(true);
    expect(routineRunNowAllowed({ ...base, organization: false, principalId: STRANGER })).toBe(true);
  });
});
