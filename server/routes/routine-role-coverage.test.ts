import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { RequestAuth } from "../auth/request-auth.ts";
import { RoleJournal } from "../perspicax/role-journal.ts";
import type { HeldRole } from "../../shared/perspicax-roles.ts";
import { createPerspicaxRoleRoutes } from "./perspicax-roles.ts";
import { routineRoleCoverageRoute, type CoverageRoutine, type RoutineRoleCoverageDeps } from "./routine-role-coverage.ts";
import type { RouteContext } from "./table.ts";
import { PASS } from "./table.ts";

const auth = { kind: "session", via: "cookie", scopes: ["client"], session: { principalId: "pr_alex" } } as unknown as RequestAuth;
const desk: HeldRole = { slug: "service-desk", name: "Service Desk", readOnly: false, explicitOnly: false, reachable: true, can: { read: true, write: true } };
const full: HeldRole = { slug: "full-access", name: "Full Access", readOnly: false, explicitOnly: false, reachable: true, can: { read: true, write: true, routines_run: true, approvals_answer: true, flow: true, sagax: true } };
const card = { routine: { name: "morning-pass", inputs: { standing_mandate: ["schedule_create", "status_change"] }, server_profiles: ["service-desk", "full-access"] } };

function harness(over: Partial<RoutineRoleCoverageDeps> & { routines?: CoverageRoutine[]; journal?: RoleJournal } = {}) {
  const journal = over.journal ?? new RoleJournal(null);
  const probes: Array<{ principalId: string; botId: string; recipe?: string }> = [];
  const routines = over.routines ?? [{ id: "r1", botId: "nova", prompt: "Run routine: morning-pass", runAs: "pr_alex" }];
  const deps: RoutineRoleCoverageDeps = {
    routine: (_auth, id) => routines.find((routine) => routine.id === id),
    mayCheck: () => true,
    runAsOf: (routine) => routine.runAs,
    recipeOf: (prompt) => /routine: ([\w-]+)/.exec(prompt)?.[1],
    probe: async (principalId, botId, recipe) => { probes.push({ principalId, botId, ...(recipe ? { recipe } : {}) }); return { held: principalId === "pr_alex" ? [desk, full] : [full], ...(recipe ? { card } : {}) }; },
    refusals: (principalId, botId) => journal.refusalsFor(principalId, botId).map((entry) => ({ role: entry.role.slug, path: entry.permission.path, operation: entry.permission.operation })),
    ...over,
  };
  const route = createPerspicaxRoleRoutes({
    actor: () => "pr_alex",
    mayUseBot: () => true,
    answerTransition: () => ({ status: 500, body: null }),
    rules: () => ({ status: 500, body: null }),
    removeRule: () => ({ status: 500, body: null }),
    more: routineRoleCoverageRoute(deps),
  });
  const get = async (search: string, method = "GET") => {
    const sent: Array<{ status: number; body: any }> = [];
    const path = "/api/bots/nova/roles/routine-coverage";
    const ctx: RouteContext = {
      req: { headers: {} } as RouteContext["req"],
      res: { setHeader: () => undefined } as unknown as ServerResponse,
      url: new URL(`http://local${path}${search}`), path, method, auth,
      json: ((_res, status, body) => { sent.push({ status, body }); }) as RouteContext["json"],
      readBody: async () => ({}),
    };
    const answer = await route(ctx);
    return { answer, sent };
  };
  return { get, probes, journal };
}

const refusal = (principalId: string, slug: string, path: string, operation: "Inquire" | "Add" | "Edit" | "Delete") => ({
  principalId, botId: "nova", threadId: "t", role: { slug, name: slug }, tool: "cw_psa_write", kind: operation === "Inquire" ? "read" as const : "write" as const,
  permission: { path, module: "", func: path, operation },
});

describe("GET /api/bots/:id/roles/routine-coverage (2026-11-05)", () => {
  it("lists the run-as person's roles, the recipe's mandate and suggests the first covering server profile", async () => {
    const h = harness();
    const { sent } = await h.get("?routineId=r1");
    expect(sent[0]?.status).toBe(200);
    expect(h.probes).toEqual([{ principalId: "pr_alex", botId: "nova", recipe: "morning-pass" }]);
    const body = sent[0]!.body;
    expect(body.held.map((role: HeldRole) => role.slug)).toEqual(["service-desk", "full-access"]);
    expect(body.mandate).toEqual(["schedule_create", "status_change"]);
    expect(body.suggested).toBe("service-desk");
    expect(body.selected).toBe("service-desk");
    expect(body.coverage.ok).toBe(true);
  });

  it("opens the connection as the routine's run-as person, not the signed-in one", async () => {
    const h = harness({ routines: [{ id: "r1", botId: "nova", prompt: "Run routine: morning-pass", runAs: "pr_sam" }] });
    const { sent } = await h.get("?routineId=r1");
    expect(h.probes[0]?.principalId).toBe("pr_sam");
    expect(sent[0]!.body.held.map((role: HeldRole) => role.slug)).toEqual(["full-access"]);
  });

  it("counts only the run-as person's refusals for this bot, never another person's", async () => {
    const journal = new RoleJournal(null);
    journal.logRefusal(refusal("pr_other", "service-desk", "schedule/entries", "Add"));
    journal.logRefusal(refusal("pr_other", "service-desk", "schedule/holidayLists", "Inquire"));
    journal.logRefusal({ ...refusal("pr_alex", "service-desk", "finance/invoices", "Inquire"), botId: "other-bot" });
    const h = harness({ journal });
    const clean = (await h.get("?routineId=r1")).sent[0]!.body;
    expect(clean.refusals).toEqual([]);
    expect(clean.coverage.ok).toBe(true);
    journal.logRefusal(refusal("pr_alex", "service-desk", "schedule/entries", "Add"));
    const mine = (await h.get("?routineId=r1&slug=service-desk")).sent[0]!.body;
    expect(mine.refusals).toEqual([{ role: "service-desk", path: "schedule/entries", operation: "Add" }]);
    expect(mine.coverage.notCovered.map((row: { item: string }) => row.item)).toEqual(["schedule_create"]);
    expect(mine.coverage.ok).toBe(false);
    // the minimal covering role moves on to the next server profile
    expect(mine.suggested).toBe("full-access");
  });

  it("evaluates the saved choice, then the slug asked for", async () => {
    const h = harness({ routines: [{ id: "r1", botId: "nova", prompt: "Run routine: morning-pass", runAs: "pr_alex", actAs: "" }] });
    expect((await h.get("?routineId=r1")).sent[0]!.body.selected).toBe("");
    expect((await h.get("?routineId=r1&slug=full-access")).sent[0]!.body.selected).toBe("full-access");
  });

  it("a non-Flow routine has an empty mandate and no describe call", async () => {
    const h = harness({ routines: [{ id: "r1", botId: "nova", prompt: "Summarize my day", runAs: "pr_alex" }] });
    const body = (await h.get("?routineId=r1")).sent[0]!.body;
    expect(h.probes[0]?.recipe).toBeUndefined();
    expect(body.mandate).toEqual([]);
    expect(body.coverage.ok).toBe(true);
  });

  it("a new routine lists the signed-in person's roles and reads its recipe from the prompt", async () => {
    const h = harness();
    const body = (await h.get(`?prompt=${encodeURIComponent("Run routine: morning-pass")}`)).sent[0]!.body;
    expect(h.probes[0]).toEqual({ principalId: "pr_alex", botId: "nova", recipe: "morning-pass" });
    expect(body.mandate).toHaveLength(2);
  });

  it("refuses a routine of another bot, a person without check rights, a bad slug and other methods", async () => {
    const h = harness({ routines: [{ id: "r1", botId: "other", prompt: "", runAs: "pr_alex" }] });
    expect((await h.get("?routineId=r1")).sent[0]?.status).toBe(404);
    expect((await harness({ mayCheck: () => false }).get("?routineId=r1")).sent[0]?.status).toBe(403);
    expect((await harness().get("?slug=has%20space")).sent[0]?.status).toBe(400);
    expect((await harness().get("", "POST")).sent[0]?.status).toBe(405);
    expect((await harness({ probe: async () => { throw new Error("down"); } }).get("?routineId=r1")).sent[0]?.status).toBe(502);
  });

  it("passes other role routes on", async () => {
    const more = routineRoleCoverageRoute({} as RoutineRoleCoverageDeps);
    expect(await more({} as RouteContext, { botId: "nova", rest: "roles/tab", actor: "pr_alex" })).toBe(PASS);
  });
});
