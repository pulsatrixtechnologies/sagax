import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyIdentityMigration, migrateIdentityRefs, principalIdFor, rewritePeopleForAttach, rewritePeopleForImport, type AttachRecords } from "./identity-migration.ts";
import { PrincipalRegistry } from "../auth/principals.ts";

const fresh = () => new PrincipalRegistry({ path: join(mkdtempSync(join(tmpdir(), "mig-")), "principals.json") });

describe("identity migration", () => {
  it("maps emails and local-owner to principals and leaves principal ids alone", () => {
    const registry = fresh();
    const local = registry.localOperator("owner@example.com");
    expect(principalIdFor("local-owner", registry)).toBe(local.id);
    expect(principalIdFor("OWNER@example.com", registry)).toBe(local.id);
    const morgan = principalIdFor("morgan@example.com", registry);
    expect(morgan).toMatch(/^pr_/);
    expect(principalIdFor(morgan, registry)).toBe(morgan);
  });

  it("rewrites org owner, humanIds, bot owners, grants and pairing sessions once", () => {
    const registry = fresh();
    const local = registry.localOperator("owner@example.com");
    const input = {
      org: { ownerUserId: "owner@example.com" },
      groups: [{ id: "g1", humanIds: ["owner@example.com", "morgan@example.com"] }, { id: "g2" }],
      bots: [{ id: "b1", ownerUserId: "local-owner", directGrants: ["morgan@example.com"] }, { id: "b2" }],
      sessions: [
        { id: "s-phone", scopes: ["admin", "client"] },
        { id: "s-kiosk", scopes: ["client"] },
        { id: "s-morgan", email: "morgan@example.com", userId: "cp_7", scopes: ["client"] },
      ],
      registry,
    };
    const out = migrateIdentityRefs(input);
    const morgan = registry.byEmail("morgan@example.com")!.id;
    expect(out.orgOwner).toBe(local.id);
    expect(out.groups).toEqual([{ id: "g1", humanIds: [local.id, morgan] }]);
    expect(out.bots).toEqual([{ id: "b1", ownerUserId: local.id, directGrants: [morgan] }]);
    expect(out.sessions).toEqual([{ id: "s-phone", principalId: local.id }, { id: "s-morgan", principalId: morgan }]);
    expect(out.promoted).toEqual([{ id: "s-phone" }]);
    expect(registry.byId(morgan)?.controlPlaneUserId).toBe("cp_7");
    // A chat-only device from before accounts is nobody: it gets no principal.
    expect(out.sessions.some((s) => s.id === "s-kiosk")).toBe(false);

    // Applying the result and running again changes nothing.
    const again = migrateIdentityRefs({
      org: { ownerUserId: out.orgOwner! },
      groups: [{ id: "g1", humanIds: out.groups[0]!.humanIds }, { id: "g2" }],
      bots: [{ id: "b1", ownerUserId: local.id, directGrants: [morgan] }, { id: "b2" }],
      sessions: [{ id: "s-phone", principalId: local.id }, { id: "s-morgan", email: "morgan@example.com", principalId: morgan }],
      registry,
    });
    expect(again).toEqual({ groups: [], bots: [], sessions: [], promoted: [] });
    expect(registry.list()).toHaveLength(2);
  });

  it("skips sessions with userId but no email (incomplete migration state)", () => {
    const registry = fresh();
    registry.localOperator("owner@example.com");
    const input = {
      org: null,
      groups: [],
      bots: [],
      sessions: [{ id: "s-odd", userId: "cp_x" }],
      registry,
    };
    const out = migrateIdentityRefs(input);
    // The session with userId but no email is not included in the result.
    expect(out.sessions).toEqual([]);
    // No additional principal was created.
    expect(registry.list()).toHaveLength(1);
  });

  it("maps only the literal local-owner to the operator and drops blank refs", () => {
    const registry = fresh();
    const local = registry.localOperator("owner@example.com");
    expect(principalIdFor("", registry)).toBe("");
    expect(principalIdFor("   ", registry)).toBe("");
    expect(principalIdFor("Local-Owner", registry)).toBe(local.id);
    const out = migrateIdentityRefs({
      org: null,
      groups: [{ id: "g1", humanIds: ["", "  ", "morgan@example.com"] }],
      bots: [{ id: "b1", ownerUserId: "local-owner", directGrants: ["", "morgan@example.com", " "] }],
      sessions: [],
      registry,
    });
    const morgan = registry.byEmail("morgan@example.com")!.id;
    expect(out.groups).toEqual([{ id: "g1", humanIds: [morgan] }]);
    expect(out.bots).toEqual([{ id: "b1", ownerUserId: local.id, directGrants: [morgan] }]);
  });

  it("creates no principal for a ref that is not an account email", () => {
    const registry = fresh();
    registry.localOperator();
    const huge = `${"a".repeat(400)}@example.com`;
    expect(principalIdFor(huge, registry)).toBe(huge);
    expect(principalIdFor("bob", registry)).toBe("bob");
    const out = migrateIdentityRefs({ org: null, groups: [], bots: [], sessions: [{ id: "s", email: huge, scopes: ["client"] }], registry });
    expect(out.sessions).toEqual([]);
    expect(registry.list()).toHaveLength(1);
  });

  it("applies the changes and names each promoted pairing session", () => {
    const registry = fresh();
    const local = registry.localOperator("owner@example.com");
    const lines: string[] = [];
    const patched: unknown[] = [];
    let owner = "owner@example.com";
    applyIdentityMigration({
      registry,
      org: { ownerUserId: owner },
      saveOrgOwner: (id) => { owner = id; },
      groups: [],
      patchGroup: (id, patch) => patched.push({ id, ...patch }),
      bots: [{ id: "b1", ownerUserId: "local-owner" }],
      patchBot: (id, patch) => patched.push({ id, ...patch }),
      sessions: [{ id: "s-phone", label: "Owner's phone", scopes: ["admin"] }, { id: "s-kiosk", label: "Kiosk", scopes: ["client"] }],
      setPrincipal: (id, principalId) => patched.push({ id, principalId }),
      log: (line) => lines.push(line),
    });
    expect(owner).toBe(local.id);
    expect(patched).toEqual([{ id: "b1", ownerUserId: local.id }, { id: "s-phone", principalId: local.id }]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("s-phone");
    expect(lines[0]).toContain("Owner's phone");
  });
});


const SELF = "pr_11111111-1111-4111-8111-111111111111";
const DANA = "pr_22222222-2222-4222-8222-222222222222";
const BOB = "pr_33333333-3333-4333-8333-333333333333";
const EVE = "pr_44444444-4444-4444-8444-444444444444";

describe("rewritePeopleForImport", () => {
  const people = () => ({
    bots: { a: { owner: SELF, grants: [DANA, SELF] }, b: { owner: null, grants: [] } },
    groups: { g: { humans: [SELF] }, h: { humans: [] } },
    routines: [{ runAs: SELF }, { runAs: null }],
  });

  it("maps self to the importer and drops every other ref, counted", () => {
    const result = rewritePeopleForImport({ self: SELF, importer: BOB, people: people(), names: { bots: { a: "Atlas" } } });
    expect(result).toEqual({
      ok: true,
      owners: { a: BOB, b: BOB },
      groupsHumans: { g: [BOB], h: [BOB] },
      routinesRunAs: [BOB, BOB],
      removed: [{ object: "bot", sourceKey: "a", name: "Atlas", refs: 1 }],
    });
    // A dropped ref never becomes anything: DANA appears nowhere.
    expect(JSON.stringify(result)).not.toContain(DANA);
  });

  it("refuses a foreign owner, room person or routine runner", () => {
    const owner = people();
    owner.bots.b.owner = DANA as never;
    expect(rewritePeopleForImport({ self: SELF, importer: BOB, people: owner })).toEqual({ ok: false, code: "foreign_owner", sourceKey: "b" });
    const room = people();
    room.groups.g.humans.push(DANA);
    expect(rewritePeopleForImport({ self: SELF, importer: BOB, people: room })).toMatchObject({ ok: false, code: "foreign_room" });
    const routine = people();
    routine.routines[1] = { runAs: DANA as never };
    expect(rewritePeopleForImport({ self: SELF, importer: BOB, people: routine })).toMatchObject({ ok: false, code: "foreign_routine", sourceKey: "1" });
  });
});

describe("rewritePeopleForAttach", () => {
  const records = (): AttachRecords => ({
    bots: [
      { id: "legacy", ownerUserId: SELF, directGrants: [DANA] },
      { id: "shared", ownerUserId: DANA, directGrants: [SELF, EVE], grants: [
        { target: `user:${SELF}`, level: "edit", by: DANA, at: 1 },
        { target: `user:${EVE}`, level: "use", by: DANA, at: 1 },
      ] },
      { id: "kept", ownerUserId: DANA, grants: [{ target: `user:${EVE}`, level: "run", by: DANA, at: 1 }, { target: `user:${SELF}`, level: "use", by: DANA, at: 1 }] },
      { id: "other", ownerUserId: BOB },
    ],
    groups: [{ id: "room", humanIds: [SELF, DANA] }, { id: "dm", humanIds: [BOB] }],
    sections: [
      { id: "s1", ownerPrincipalId: SELF, members: [{ target: `user:${SELF}`, role: "moderator" }, { target: `user:${EVE}`, role: "readonly" }], placedBots: [{ botId: "legacy", ownerPrincipalId: SELF }] },
      { id: "s2", ownerPrincipalId: BOB, members: [{ target: "team:T1", role: "participant" }] },
    ],
    routines: [{ id: "r1", runAs: SELF }, { id: "r2", runAs: BOB }, { id: "r3" }],
  });

  it("moves owner, grants (keeping the higher level), rooms, sections and routines", () => {
    const result = rewritePeopleForAttach({ from: SELF, to: EVE }, records());
    expect(result.counts).toEqual({ bots: 1, grants: 2, rooms: 1, sections: 1, routines: 1 });
    expect(result.bots.find((b) => b.id === "legacy")).toEqual({ id: "legacy", ownerUserId: EVE });
    const shared = result.bots.find((b) => b.id === "shared")!;
    expect(shared.directGrants).toEqual([EVE]);
    expect(shared.grants).toEqual([{ target: `user:${EVE}`, level: "edit", by: DANA, at: 1 }]);
    // EVE's own run grant beats the moved use grant.
    expect(result.bots.find((b) => b.id === "kept")!.grants).toEqual([{ target: `user:${EVE}`, level: "run", by: DANA, at: 1 }]);
    expect(result.bots.some((b) => b.id === "other")).toBe(false);
    expect(result.groups).toEqual([{ id: "room", humanIds: [EVE, DANA] }]);
    expect(result.sections).toEqual([{ id: "s1", ownerPrincipalId: EVE, members: [{ target: `user:${EVE}`, role: "moderator" }], placedBots: [{ botId: "legacy", ownerPrincipalId: EVE }] }]);
    expect(result.routines).toEqual([{ id: "r1", runAs: EVE }]);
  });

  it("is idempotent and leaves unknown refs alone", () => {
    const first = records();
    const once = rewritePeopleForAttach({ from: SELF, to: EVE }, first);
    const applied: AttachRecords = {
      bots: first.bots.map((bot) => ({ ...bot, ...once.bots.find((b) => b.id === bot.id) })),
      groups: first.groups.map((group) => ({ ...group, ...once.groups.find((g) => g.id === group.id) })),
      sections: first.sections.map((section) => once.sections.find((s) => s.id === section.id) ?? section),
      routines: first.routines.map((routine) => ({ ...routine, ...once.routines.find((r) => r.id === routine.id) })),
    };
    const twice = rewritePeopleForAttach({ from: SELF, to: EVE }, applied);
    expect(twice.counts).toEqual({ bots: 0, grants: 0, rooms: 0, sections: 0, routines: 0 });
    expect(JSON.stringify(applied)).toContain(DANA);
    expect(JSON.stringify(applied)).toContain(BOB);
    expect(JSON.stringify(applied)).not.toContain(SELF);
  });
});
