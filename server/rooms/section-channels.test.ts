// Slice 4: sidebar sections as channels (server/rooms/section-channels.ts).
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { botLevel, canInChannel, type TeamRef, type Viewer } from "../auth/authz.ts";
import { createSectionChannelRoutes, type SectionAuditRow, migrationOwner, SectionChannels, sectionShareGrants, validSectionName } from "./section-channels.ts";

const pid = (n: number) => `pr_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ALICE = pid(1);
const BOB = pid(2);
const CAROL = pid(3);
const DAVE = pid(4);
const MIA = pid(5);
const ADMIN = pid(6);
const teams: Record<string, TeamRef[]> = { [CAROL]: [{ id: "T", manager: false }], [DAVE]: [{ id: "U", manager: false }], [MIA]: [{ id: "T", manager: true }] };
const viewerOf = (id: string): Viewer => ({ principalId: id, orgAdmin: id === ADMIN, teams: teams[id] ?? [], disabled: false });

describe("SectionChannels store", () => {
  it("migrates each section to a private record owned by the owner of most of its bots", () => {
    expect(migrationOwner([{ ownerPrincipalId: ALICE, createdAt: 3 }, { ownerPrincipalId: ALICE, createdAt: 4 }, { ownerPrincipalId: BOB, createdAt: 1 }], ADMIN)).toBe(ALICE);
    // a tie: the owner of the oldest bot among the tied owners
    expect(migrationOwner([{ ownerPrincipalId: ALICE, createdAt: 5 }, { ownerPrincipalId: BOB, createdAt: 2 }], ADMIN)).toBe(BOB);
    expect(migrationOwner([], ADMIN)).toBe(ADMIN);
    const path = join(mkdtempSync(join(tmpdir(), "sections-")), "section-channels.json");
    let n = 0;
    const channels = new SectionChannels({ path, newId: () => `sec_00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, now: () => 7 });
    expect(channels.migrate(["Support", "Ventes"], (name) => (name === "Support" ? ALICE : ADMIN))).toBe(2);
    expect(channels.migrate(["Support", "Ventes"], () => BOB)).toBe(0);
    expect(channels.byName("Support")).toMatchObject({ ownerPrincipalId: ALICE, members: [], defaultLevel: "use" });
    // private: no access facts at all
    expect(channels.accessFor("Support")).toBeNull();
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
    channels.rename("Support", "Support QC");
    expect(channels.byName("Support QC")?.id).toBe("sec_00000000-0000-4000-8000-000000000001");
    channels.reconcile(["Support QC"]);
    expect(channels.list().map((r) => r.name)).toEqual(["Support QC"]);
    expect(JSON.parse(readFileSync(path, "utf8")).sections).toHaveLength(1);
    expect(new SectionChannels({ path }).list()).toHaveLength(1);
  });

  it("names: 1 to 60 characters without control characters", () => {
    expect(validSectionName("Ventes")).toBe(true);
    expect(validSectionName("")).toBe(false);
    expect(validSectionName("x".repeat(61))).toBe(false);
    expect(validSectionName("a\u0007b")).toBe(false);
    expect(validSectionName(42)).toBe(false);
  });

  it("access through a team, readonly cannot post, default level capped at run, owner opens nothing by owning", () => {
    const section = { ownerPrincipalId: ALICE, members: [{ target: "team:T", role: "readonly" as const }], defaultLevel: "run" as const };
    expect(botLevel({ viewer: viewerOf(CAROL), ownerPrincipalId: BOB, grants: [], sections: [section] })).toBe("run");
    expect(botLevel({ viewer: viewerOf(DAVE), ownerPrincipalId: BOB, grants: [], sections: [section] })).toBeNull();
    expect(botLevel({ viewer: viewerOf(ALICE), ownerPrincipalId: BOB, grants: [], sections: [section] })).toBeNull();
    expect(canInChannel(viewerOf(CAROL), "channel.read", { humanIds: [], section })).toBe(true);
    expect(canInChannel(viewerOf(CAROL), "channel.post", { humanIds: [], section })).toBe(false);
  });
});

function harness() {
  const path = join(mkdtempSync(join(tmpdir(), "sections-routes-")), "section-channels.json");
  let n = 0;
  const channels = new SectionChannels({ path, newId: () => `sec_00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` });
  const sections = new Set<string>(["Support"]);
  const bots: Record<string, { owner: string; section?: string }> = { v: { owner: ALICE }, w: { owner: BOB }, x: { owner: BOB } };
  let changed = 0;
  const audits: Array<SectionAuditRow & { actor: string }> = [];
  channels.migrate([...sections], () => ALICE);
  const route = createSectionChannelRoutes({
    channels,
    viewer: (auth) => {
      const id = (auth as unknown as { actor?: string }).actor;
      return id ? viewerOf(id) : undefined;
    },
    principalId: (auth) => (auth as unknown as { actor: string }).actor,
    teamsOf: (id) => teams[id] ?? [],
    sections: () => [...sections],
    createSection: (name) => { sections.add(name); return undefined; },
    renameSection: (name, next) => {
      sections.delete(name); sections.add(next);
      for (const bot of Object.values(bots)) if (bot.section === name) bot.section = next;
      return undefined;
    },
    deleteSection: (name) => {
      sections.delete(name);
      for (const bot of Object.values(bots)) if (bot.section === name) delete bot.section;
      return undefined;
    },
    onChanged: () => { changed += 1; },
    audit: (auth, row) => { audits.push({ ...row, actor: (auth as unknown as { actor: string }).actor }); },
  });
  const call = async (actor: string | undefined, method: string, path: string, body?: unknown) => {
    let answer: { status: number; body: any } | undefined;
    await route({
      req: {} as never,
      res: { setHeader: () => {} } as never,
      url: new URL(`http://x${path}`),
      path,
      method,
      auth: { actor } as never,
      json: ((_res: unknown, status: number, payload: unknown) => { answer = { status, body: payload }; }) as never,
      readBody: (async () => body) as never,
    });
    return answer!;
  };
  return { channels, sections, bots, call, changed: () => changed, audits, path };
}

describe("legacy section access (records kept from before sections were personal)", () => {
  it("a mixed section shared by one owner gives nothing on another owner's bot", () => {
    const h = harness();
    const record = h.channels.byName("Support")!;
    expect(record.ownerPrincipalId).toBe(ALICE);
    h.channels.setMembers(record.id, [{ target: "team:U", role: "participant" }], "run");
    const onV = h.channels.accessForBot("Support", { id: "v", ownerPrincipalId: ALICE });
    const onY = h.channels.accessForBot("Support", { id: "y", ownerPrincipalId: CAROL });
    expect(onV).not.toBeNull();
    expect(onY).toBeNull();
    // a placement recorded for its owner counts, and only for that owner
    h.channels.recordPlacement("Support", "x", BOB);
    expect(h.channels.accessForBot("Support", { id: "x", ownerPrincipalId: BOB })).not.toBeNull();
    expect(h.channels.accessForBot("Support", { id: "x", ownerPrincipalId: CAROL })).toBeNull();
    h.channels.forgetPlacement("Support", "x");
    expect(h.channels.accessForBot("Support", { id: "x", ownerPrincipalId: BOB })).toBeNull();
  });

  it("opens the section's own room and placed rooms, never a legacy room carrying its name", () => {
    const h = harness();
    const record = h.channels.byName("Support")!;
    h.channels.setMembers(record.id, [{ target: "team:U", role: "readonly" }], "use");
    h.channels.setRoom(record.id, "room-Support");
    expect(h.channels.accessForRoom("Support", "room-Support")).not.toBeNull();
    expect(h.channels.accessForRoom("Support", "legacy")).toBeNull();
    h.channels.recordRoomPlacement("Support", "later");
    expect(h.channels.accessForRoom("Support", "later")).not.toBeNull();
    h.channels.forgetRoomPlacement("Support", "later");
    expect(h.channels.accessForRoom("Support", "later")).toBeNull();
    // a private section opens no room at all
    h.channels.recordRoomPlacement("Support", "later");
    h.channels.setMembers(record.id, [], "use");
    expect(h.channels.accessForRoom("Support", "later")).toBeNull();
  });
});

describe("sections are personal: legacy shares become bot grants", () => {
  it("one grant per member on each consented bot, at the default level; private sections give none", () => {
    const h = harness();
    const support = h.channels.byName("Support")!;
    h.channels.setMembers(support.id, [{ target: "team:U", role: "readonly" }, { target: `user:${DAVE}`, role: "participant" }], "run");
    h.channels.ensure("Private", ALICE);
    const grants = sectionShareGrants(h.channels, [
      { id: "v", section: "Support", ownerPrincipalId: ALICE },
      // carol never consented to Support: nothing on her bot
      { id: "y", section: "Support", ownerPrincipalId: CAROL },
      { id: "p", section: "Private", ownerPrincipalId: ALICE },
      { id: "z", ownerPrincipalId: ALICE },
    ]);
    expect(grants).toEqual([
      { botId: "v", target: "team:U", level: "run", by: ALICE, section: "Support" },
      { botId: "v", target: `user:${DAVE}`, level: "run", by: ALICE, section: "Support" },
    ]);
  });

  it("runs once: the marker survives a restart and the records stay on disk", () => {
    const h = harness();
    const support = h.channels.byName("Support")!;
    h.channels.setMembers(support.id, [{ target: "team:U", role: "participant" }], "use");
    expect(h.channels.botSharesMigrated()).toBe(false);
    h.channels.markBotSharesMigrated();
    const reopened = new SectionChannels({ path: h.path });
    expect(reopened.botSharesMigrated()).toBe(true);
    expect(reopened.byName("Support")?.members).toEqual([{ target: "team:U", role: "participant" }]);
  });
});

describe("section routes", () => {
  it("creates a section owned by the caller, refuses General and duplicates", async () => {
    const h = harness();
    const created = await h.call(ALICE, "POST", "/api/org/sections", { name: "Ventes" });
    expect(created).toMatchObject({ status: 201, body: { section: { name: "Ventes", ownerPrincipalId: ALICE, viewerRole: "owner", canModerate: true, members: [] } } });
    expect((await h.call(ALICE, "POST", "/api/org/sections", { name: "general" })).body.code).toBe("general_is_personal");
    expect((await h.call(ALICE, "POST", "/api/org/sections", { name: "Ventes" })).status).toBe(409);
    expect((await h.call(ALICE, "POST", "/api/org/sections", { name: "" })).status).toBe(400);
    expect((await h.call(ALICE, "PATCH", "/api/org/sections/general", { name: "x" })).body.code).toBe("general_is_personal");
  });

  it("members and bot placement are gone: 410 sections_are_personal, nothing changes", async () => {
    const h = harness();
    const id = (await h.call(ALICE, "POST", "/api/org/sections", { name: "Ventes" })).body.section.id;
    const before = h.changed();
    for (const [path, body] of [
      [`/api/org/sections/${id}/members`, { members: [{ target: "team:T", role: "participant" }] }],
      [`/api/org/sections/${id}/bots`, { add: ["v"] }],
    ] as const) {
      const answer = await h.call(ALICE, "PUT", path, body);
      expect(answer.status).toBe(410);
      expect(answer.body.code).toBe("sections_are_personal");
    }
    expect(h.channels.byId(id)?.members).toEqual([]);
    expect(h.bots.v!.section).toBeUndefined();
    expect(h.changed()).toBe(before);
  });

  it("listing no longer forgets a record whose name left the store", async () => {
    const h = harness();
    h.sections.delete("Support");
    await h.call(ALICE, "GET", "/api/org/sections");
    expect(h.channels.byName("Support")).not.toBeNull();
  });

  it("rename and delete need channel.moderate and keep the record in step", async () => {
    const h = harness();
    const id = (await h.call(ALICE, "POST", "/api/org/sections", { name: "Ventes" })).body.section.id;
    h.channels.setMembers(id, [{ target: `user:${BOB}`, role: "moderator" }], "use");
    expect((await h.call(BOB, "PATCH", `/api/org/sections/${id}`, { name: "Ventes QC" })).status).toBe(200);
    expect(h.channels.byId(id)).toMatchObject({ name: "Ventes QC", members: [{ target: `user:${BOB}` }] });
    expect(h.sections.has("Ventes QC")).toBe(true);
    expect((await h.call(DAVE, "DELETE", `/api/org/sections/${id}`)).status).toBe(403);
    expect((await h.call(ADMIN, "DELETE", `/api/org/sections/${id}`)).status).toBe(200);
    expect(h.channels.byId(id)).toBeNull();
    expect(h.sections.has("Ventes QC")).toBe(false);
  });
});

describe("section audit (slice 7)", () => {
  it("writes one row per saved change, none for a refusal", async () => {
    const h = harness();
    const id = (await h.call(ALICE, "POST", "/api/org/sections", { name: "Ventes" })).body.section.id;
    await h.call(ALICE, "PATCH", `/api/org/sections/${id}`, { name: "Ventes QC" });
    const before = h.audits.length;
    expect((await h.call(BOB, "PATCH", `/api/org/sections/${id}`, { name: "Nope" })).status).toBe(403);
    expect((await h.call(ALICE, "PUT", `/api/org/sections/${id}/members`, { members: [] })).status).toBe(410);
    expect(h.audits.length).toBe(before);
    await h.call(ALICE, "DELETE", `/api/org/sections/${id}`);
    expect(h.audits.map((row) => row.action)).toEqual(["section.create", "section.rename", "section.delete"]);
    expect(h.audits.every((row) => row.actor === ALICE && row.section.id === id)).toBe(true);
    expect(h.audits[1]).toMatchObject({ before: { name: "Ventes" }, after: { name: "Ventes QC" } });
  });
});
