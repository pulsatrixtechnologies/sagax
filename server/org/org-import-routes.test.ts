import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import { createOrgImportRoute, type OrgImportRouteDeps } from "./org-import-routes.ts";
import type { RequestAuth } from "../request-auth.ts";
import { RoutineManager } from "../routines.ts";
import { PASS, type RouteContext } from "../routes/table.ts";
import { SectionChannels } from "../section-channels.ts";
import type { SessionRecord } from "../sessions.ts";
import { Store } from "../store.ts";
import { importTeamBackup } from "../team-backup.ts";

const SELF = "pr_11111111-1111-4111-8111-111111111111";
const DANA = "pr_22222222-2222-4222-8222-222222222222";
const BOB = "pr_33333333-3333-4333-8333-333333333333";

function copy() {
  const task = (key: string) => ({ key, title: "Conversation", createdAt: 1, activeLeafId: null, messages: [] });
  return {
    format: "sagax.org-import", version: 1, exportedAt: 1, self: SELF,
    choices: { a: { threads: false, memory: false }, b: { threads: false, memory: false } },
    people: {
      bots: { a: { owner: SELF, grants: [DANA] }, b: { owner: null, grants: [] } },
      groups: { g: { humans: [SELF] } },
      routines: [{ runAs: null }],
    },
    backup: {
      format: "openmaus.backup", version: 1, name: "copy", exportedAt: 1, warnings: [],
      bots: ["a", "b"].map((key) => ({ key, name: key === "a" ? "Atlas" : "Bolt", title: "", description: "", color: "blue", chiefOfStaff: false, hidden: false, playbooks: [], activeTask: `${key}-t`, tasks: [task(`${key}-t`)], section: "Work" })),
      groups: [{ key: "g", name: "Pair", activeTask: "g-t", tasks: [task("g-t")], memberIds: ["a", "b"], dm: false, bulletin: "", defaultResponder: { kind: "mentions" }, section: "Work" }],
      routines: [{ name: "Hourly", prompt: "go", target: "bot", botId: "a", runOn: "maus", schedule: { type: "once", at: 5 }, durationMinutes: 10 }],
    },
  };
}

const bob: RequestAuth = {
  kind: "session", via: "cookie", scopes: ["client"],
  session: { id: "s1", label: "web", scopes: ["client"], createdAt: 1, lastSeenAt: 1, principalId: BOB, idp: { iss: "https://px.example.test", sub: "B1" } } as SessionRecord,
};

function harness(overrides: Partial<OrgImportRouteDeps> = {}) {
  const audits: unknown[] = [];
  const imports: unknown[] = [];
  const route = createOrgImportRoute({
    organization: true,
    mayCreateBots: () => true,
    importCopy: async (input) => {
      imports.push(input);
      return {
        bots: input.document.backup.bots.map((bot, i) => ({ id: `new-${i}`, name: bot.name, section: "Work" })),
        groups: [{ id: "room-1", name: "Pair" }],
        routines: [{ id: "r-1", name: "Hourly" }],
      };
    },
    audit: (_auth, details) => audits.push(details),
    ...overrides,
  });
  const call = async (input: { auth?: RequestAuth; method?: string; body?: unknown; contentType?: string; readBody?: () => Promise<unknown> } = {}) => {
    const out: { status?: number; body?: unknown } = {};
    const ctx = {
      req: { headers: { "content-type": input.contentType ?? "application/json" } },
      res: { setHeader: () => {}, headersSent: false, writableEnded: false },
      url: new URL("http://localhost/api/org/import"), path: "/api/org/import", method: input.method ?? "POST", auth: input.auth ?? bob,
      json: (_res: unknown, status: number, body: unknown) => { out.status = status; out.body = body; },
      readBody: input.readBody ?? (async () => input.body ?? copy()),
    } as unknown as RouteContext;
    const result = await route(ctx);
    return { ...out, passed: result === PASS };
  };
  return { call, audits, imports };
}

describe("POST /api/org/import", () => {
  it("imports a copy as the caller's and reports it, with one audit row", async () => {
    const h = harness();
    const out = await h.call();
    expect(out.status).toBe(201);
    expect(out.body).toEqual({
      bots: [
        { sourceKey: "a", id: "new-0", name: "Atlas", section: "Work", tasks: 1, messages: 0, memoryFiles: 0 },
        { sourceKey: "b", id: "new-1", name: "Bolt", section: "Work", tasks: 1, messages: 0, memoryFiles: 0 },
      ],
      groups: [{ sourceKey: "g", id: "room-1", name: "Pair" }],
      routines: [{ id: "r-1", name: "Hourly", enabled: false }],
      removedPeople: [{ object: "bot", sourceKey: "a", name: "Atlas", refs: 1 }],
      subject: { iss: "https://px.example.test", sub: "B1" },
      warnings: [],
    });
    expect(h.audits).toEqual([{ bots: 2, rooms: 1, routines: 1, messages: 0, memoryFiles: 0, removedRefs: 1 }]);
    expect(h.imports).toHaveLength(1);
    expect((h.imports[0] as { importer: string }).importer).toBe(BOB);
  });

  it("refuses with each contract status and never writes or audits", async () => {
    const solo = harness({ organization: false });
    expect(await solo.call()).toMatchObject({ status: 403, body: { code: "identity_perspicax" } });
    const h = harness();
    expect(await h.call({ auth: { kind: "loopback", scopes: ["admin", "client"] } })).toMatchObject({ status: 401, body: { code: "session_required" } });
    const paired = { ...bob, session: { ...(bob as { session: SessionRecord }).session, idp: undefined } } as RequestAuth;
    expect(await h.call({ auth: paired })).toMatchObject({ status: 401, body: { code: "session_required" } });
    expect(await harness({ mayCreateBots: () => false }).call()).toMatchObject({ status: 403, body: { code: "forbidden" } });
    expect(await h.call({ contentType: "text/plain" })).toMatchObject({ status: 415 });
    expect(await h.call({ readBody: async () => { throw Object.assign(new Error("big"), { status: 413 }); } })).toMatchObject({ status: 413, body: { code: "too_large" } });
    expect(await h.call({ body: { format: "openmaus.backup" } })).toMatchObject({ status: 400, body: { code: "invalid_document" } });
    const owner = copy();
    owner.people.bots.b.owner = DANA as never;
    expect(await h.call({ body: owner })).toMatchObject({ status: 400, body: { code: "foreign_owner" } });
    const room = copy();
    room.people.groups.g.humans.push(DANA);
    expect(await h.call({ body: room })).toMatchObject({ status: 400, body: { code: "foreign_room" } });
    const routine = copy();
    routine.people.routines[0] = { runAs: DANA as never };
    expect(await h.call({ body: routine })).toMatchObject({ status: 400, body: { code: "foreign_routine" } });
    expect(await h.call({ method: "GET" })).toMatchObject({ status: 405 });
    expect(h.imports).toHaveLength(0);
    expect(h.audits).toHaveLength(0);
  });

  it("answers 409 to a second import by the same person while one is running", async () => {
    const h = harness();
    let release: (value: unknown) => void = () => {};
    const slow = h.call({ readBody: () => new Promise((resolve) => { release = resolve; }) });
    expect(await h.call()).toMatchObject({ status: 409, body: { code: "import_in_progress" } });
    release(copy());
    expect(await slow).toMatchObject({ status: 201 });
    expect(await h.call()).toMatchObject({ status: 201 });
  });

  it("answers 500 import_failed without an audit row when the write fails", async () => {
    const h = harness({ importCopy: async () => { throw new Error("disk full"); } });
    expect(await h.call()).toMatchObject({ status: 500, body: { code: "import_failed" } });
    expect(h.audits).toHaveLength(0);
  });

  it("passes other paths", async () => {
    const h = harness();
    const route = createOrgImportRoute({ organization: true, mayCreateBots: () => true, importCopy: async () => { throw new Error("no"); }, audit: () => {} });
    const ctx = { path: "/api/org", method: "POST" } as unknown as RouteContext;
    expect(await route(ctx)).toBe(PASS);
    expect(h.audits).toHaveLength(0);
  });
});

describe("importTeamBackup as an organization copy", () => {
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

  function fixture(failRoutines = false) {
    const store = new Store(() => ({ instanceId: "fixture", model: "fixture-model" }));
    const routines = new RoutineManager({
      botState: (id) => (store.bot(id) ? "ready" : "missing"),
      goalState: () => "ready",
      createTask: (id, title) => store.createTask(id, title),
      startTurn: async () => { throw new Error("never runs"); },
    });
    if (failRoutines) routines.create = () => { throw new Error("injected failure"); };
    const channels = new SectionChannels({ path: join(mkdtempSync(join(tmpdir(), "sec-")), "section-channels.json") });
    // Someone else's section with the same name: the import never lands there.
    channels.ensure("Work", DANA);
    store.createBot({ name: "Existing", section: "Work" }, { seedMessages: false });
    return { store, routines, channels };
  }

  it("lands every bot, room and routine as the importer's, in fresh private sections", () => {
    const f = fixture();
    const backup = copy().backup;
    const imported = importTeamBackup(f.store, f.routines, backup, { instanceId: "fixture", model: "fixture-model" }, {
      ownerUserId: BOB,
      groupHumanIds: () => [BOB],
      routineRunAs: () => BOB,
      sectionChannels: f.channels,
    });
    for (const bot of imported.bots) {
      const stored = f.store.bot(bot.id)!;
      expect(stored.ownerUserId).toBe(BOB);
      expect(stored.section).not.toBe("Work");
      expect(stored.approvalMode).toBe("ask");
      expect(stored.computer).toBe("off");
      expect(stored.grants ?? []).toEqual([]);
    }
    const section = f.store.bot(imported.bots[0]!.id)!.section!;
    const record = f.channels.byName(section)!;
    expect(record).toMatchObject({ ownerPrincipalId: BOB, members: [] });
    expect(record.placedBots?.map((entry) => entry.ownerPrincipalId)).toEqual([BOB, BOB]);
    expect(record.placedRooms).toEqual([imported.groups[0]!.id]);
    expect(f.store.group(imported.groups[0]!.id)!.humanIds).toEqual([BOB]);
    expect(imported.routines[0]).toMatchObject({ enabled: false, runAs: BOB });
  });

  it("rolls back bots, rooms, sections and section-channel records after a failure midway", () => {
    const f = fixture(true);
    const before = { bots: f.store.bots.map((b) => b.id), groups: f.store.groups.map((g) => g.id), sections: [...f.store.sections], channels: f.channels.list() };
    expect(() => importTeamBackup(f.store, f.routines, copy().backup, { instanceId: "fixture", model: "fixture-model" }, {
      ownerUserId: BOB, groupHumanIds: () => [BOB], routineRunAs: () => BOB, sectionChannels: f.channels,
    })).toThrow(/injected failure/);
    expect(f.store.bots.map((b) => b.id)).toEqual(before.bots);
    expect(f.store.groups.map((g) => g.id)).toEqual(before.groups);
    expect(f.store.sections).toEqual(before.sections);
    expect(f.channels.list()).toEqual(before.channels);
  });
});
