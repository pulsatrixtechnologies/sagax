import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { RequestAuth } from "../auth/request-auth.ts";
import type { BotRecord } from "../store.ts";
import { createTeamExportImportRoutes, type TeamExportImportRouteDeps } from "./team-export-import.ts";
import { PASS, type RouteContext } from "./table.ts";

const owner = { kind: "loopback", trust: "owner", scopes: ["admin"] } as unknown as RequestAuth;
const member = {
  kind: "session",
  scopes: ["client"],
  session: { id: "s1", principalId: "p1" },
} as unknown as RequestAuth;
const bot = { id: "b1", name: "Ada", hidden: false, color: "blue" } as BotRecord;

function deps(over: Partial<TeamExportImportRouteDeps> = {}): TeamExportImportRouteDeps {
  return {
    profileName: () => "Pat",
    bots: () => [bot],
    groups: () => [],
    sections: () => ["Ops"],
    sectionKey: (section) => section ?? "",
    listRoutines: () => [],
    mcpServers: () => ({}),
    readSectionContext: () => ({ text: "" }),
    readPublishedLibrary: () => null,
    writePublishedLibrary: () => undefined,
    readPublishedTeam: () => null,
    writePublishedTeam: () => undefined,
    defaultsPresetFor: () => ({ preset: null, skipped: [] }),
    collectTeamSkills: () => ({ ok: true, all: true, skillsByBot: new Map(), skipped: [], available: [] }),
    starterNotes: () => [],
    checkedExportSkillNames: () => ({ ok: true, names: [] }),
    collectExportSkills: () => new Map(),
    createBackup: (name) => ({ format: "openmaus.backup", name }),
    isPerspicax: () => false,
    creatingBotOwnerId: () => "p1",
    botCreationAllowed: () => true,
    personBotsReadOnly: () => false,
    botsReadOnlyRefusal: () => ({ error: "read-only", code: "org_bots_read_only" }),
    ownerChosenVisibility: (_auth, visibility) => visibility,
    memberImportReset: () => ({}),
    defaultSelection: async () => ({ instanceId: "i1", model: "m" }),
    packageImportDeps: () => ({}) as never,
    store: {
      bot: (id) => (id === "b1" ? bot : null),
      patchBot: () => bot,
      patchGroup: () => null,
    },
    importBackup: () => ({ bots: [], groups: [] }),
    sectionChannels: null,
    publicBot: (row) => row,
    groupWithThread: (group) => group,
    broadcast: () => undefined,
    viewerForApproval: () => ({}),
    projectBotTranscript: (row) => row,
    projectGroupTranscript: (group) => group,
    ...over,
  };
}

function ctx(path: string, method: string, body: unknown = null, auth: RequestAuth = owner, query = "") {
  const sent: Array<{ status: number; body: unknown }> = [];
  const context = {
    req: {} as IncomingMessage,
    res: {} as ServerResponse,
    url: new URL(`http://x${path}${query}`),
    path,
    method,
    auth,
    json: ((_res: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as RouteContext["json"],
    readBody: (async () => body) as RouteContext["readBody"],
  } satisfies RouteContext;
  return { context, sent };
}

describe("createTeamExportImportRoutes", () => {
  it("passes foreign paths", async () => {
    const route = createTeamExportImportRoutes(deps());
    expect(await route(ctx("/api/team-library/catalog", "GET").context)).toBe(PASS);
    expect(await route(ctx("/api/team-map", "GET").context)).toBe(PASS);
    expect(await route(ctx("/api/groups", "POST").context)).toBe(PASS);
  });

  it("exports a legacy manifest", async () => {
    const route = createTeamExportImportRoutes(deps());
    const call = ctx("/api/teams/export", "POST", { name: "Mine" });
    await route(call.context);
    expect(call.sent[0]?.status).toBe(200);
    expect(call.sent[0]?.body).toMatchObject({ team: { name: "Mine" } });
  });

  it("exports a backup through the injected helper", async () => {
    const createBackup = vi.fn((name: string) => ({ format: "openmaus.backup", name }));
    const route = createTeamExportImportRoutes(deps({ createBackup }));
    const call = ctx("/api/teams/export", "POST", { format: "backup" });
    await route(call.context);
    expect(createBackup).toHaveBeenCalledWith("Pat's Team");
    expect(call.sent[0]?.status).toBe(200);
  });

  it("refuses scout without a folder", async () => {
    const route = createTeamExportImportRoutes(deps());
    const call = ctx("/api/teams/scout", "GET", null, owner, "");
    await route(call.context);
    expect(call.sent[0]?.status).toBe(400);
  });

  it("refuses replace import mode", async () => {
    const route = createTeamExportImportRoutes(deps());
    const call = ctx("/api/teams/import", "POST", {}, owner, "?mode=replace");
    await route(call.context);
    expect(call.sent[0]?.status).toBe(400);
    expect((call.sent[0]?.body as { error: string } | undefined)?.error).toMatch(/no longer supported/);
  });

  it("refuses a read-only member import", async () => {
    const route = createTeamExportImportRoutes(deps({
      botCreationAllowed: () => false,
      personBotsReadOnly: () => true,
    }));
    const call = ctx("/api/teams/import", "POST", { format: "team" }, member, "?mode=add");
    await route(call.context);
    expect(call.sent[0]?.status).toBe(403);
    expect(call.sent[0]?.body).toMatchObject({ code: "org_bots_read_only" });
  });

  it("refuses member backup restore (admin only)", async () => {
    const route = createTeamExportImportRoutes(deps());
    const call = ctx("/api/teams/import", "POST", { format: "openmaus.backup" }, member, "?mode=add");
    await route(call.context);
    expect(call.sent[0]).toEqual({
      status: 403,
      body: { error: "Restoring a backup stays an admin's. Import a bot or a team file instead.", code: "admin_only" },
    });
  });

  it("#2045: export sees only the caller's team; another person's same name is 404", async () => {
    const aliceBot = { id: "a1", name: "Aria", hidden: false, section: "Ops", ownerUserId: "alice" } as BotRecord;
    const bobBot = { id: "b1", name: "Boris", hidden: false, section: "Ops", ownerUserId: "p1", color: "blue" } as BotRecord;
    const route = createTeamExportImportRoutes(deps({
      isPerspicax: () => true,
      bots: () => [aliceBot, bobBot],
      sections: () => ["Ops"],
      sectionsFor: () => ["Ops"],
      ownsBot: (row, auth) => (row.ownerUserId ?? "").toLowerCase() === (auth.kind === "session" ? auth.session.principalId : ""),
      readSectionContextFor: () => ({ text: "Bob brief" }),
    }));
    const foreign = ctx("/api/teams/export", "POST", { format: "package", version: 2, team: "AliceOnly" }, member);
    await route(foreign.context);
    expect(foreign.sent[0]?.status).toBe(404);

    const own = ctx("/api/teams/export", "POST", { format: "package", version: 2, team: "Ops", dryRun: true }, member);
    await route(own.context);
    expect(own.sent[0]?.status).toBe(200);
    const document = (own.sent[0]?.body as { document?: { package?: { agents?: Array<{ name?: string }> } } } | undefined)?.document;
    const names = document?.package?.agents?.map((agent) => agent.name) ?? [];
    expect(names).toContain("Boris");
    expect(names).not.toContain("Aria");
  });
});
