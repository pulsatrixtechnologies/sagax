// Slice 4 rights (server/auth/authz.ts): levels, team grants, sections, managers.
import { describe, expect, it } from "vitest";

import {
  atLeast,
  botLevel,
  can,
  canAdministerGrant,
  canAdministerSectionMember,
  canEditRoomHumans,
  canModerateSection,
  capLevel,
  grantAdministration,
  levelRank,
  parseTarget,
  roomAccess,
  type BotFacts,
  type BotGrant,
  type TeamRef,
  type Viewer,
} from "./authz.ts";

const pid = (n: number) => `pr_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ALICE = pid(1); // owner
const BOB = pid(2);
const CAROL = pid(3); // in team T
const DAVE = pid(4); // in team U
const MIA = pid(5); // manager of T
const ADMIN = pid(6);
const NED = pid(7); // co-manager of T

const teams: Record<string, TeamRef[]> = {
  [CAROL]: [{ id: "T", manager: false }],
  [DAVE]: [{ id: "U", manager: false }],
  [MIA]: [{ id: "T", manager: true }],
  [NED]: [{ id: "T", manager: true }],
};
const teamsOf = (id: string) => teams[id] ?? [];
const viewer = (id: string, patch: Partial<Viewer> = {}): Viewer => ({ principalId: id, orgAdmin: false, teams: teamsOf(id), disabled: false, ...patch });
const grant = (target: string, level: BotGrant["level"], by = ALICE): BotGrant => ({ target, level, by, at: 1 });
const bot = (grants: BotGrant[], patch: Partial<BotFacts> = {}): BotFacts => ({ ownerPrincipalId: ALICE, grants, ...patch });

describe("levels", () => {
  it("orders use < run < edit < manage < owner and caps", () => {
    expect(["use", "run", "edit", "manage", "owner"].map((l) => levelRank(l as never))).toEqual([1, 2, 3, 4, 5]);
    expect(atLeast("edit", "run")).toBe(true);
    expect(atLeast("use", "run")).toBe(false);
    expect(atLeast(null, "use")).toBe(false);
    expect(capLevel("manage", "run")).toBe("run");
    expect(capLevel("use", "run")).toBe("use");
  });

  it("parses targets", () => {
    expect(parseTarget(`user:${BOB}`)).toEqual({ kind: "user", id: BOB });
    expect(parseTarget("team:01J9TEAM")).toEqual({ kind: "team", id: "01J9TEAM" });
    expect(parseTarget("user:bob@example.test")).toBeNull();
    expect(parseTarget("team:bad id")).toBeNull();
    expect(parseTarget(BOB)).toBeNull();
  });
});

describe("botLevel", () => {
  it("owner above everything, user grant, team grant through membership (not the manager flag), highest wins", () => {
    const facts = bot([grant(`user:${BOB}`, "run"), grant("team:T", "use"), grant(`user:${CAROL}`, "edit")]);
    expect(botLevel({ viewer: viewer(ALICE), ...facts })).toBe("owner");
    expect(botLevel({ viewer: viewer(BOB), ...facts })).toBe("run");
    expect(botLevel({ viewer: viewer(CAROL), ...facts })).toBe("edit");
    expect(botLevel({ viewer: viewer(MIA), ...facts })).toBeNull();
    expect(botLevel({ viewer: viewer(DAVE), ...facts })).toBeNull();
  });

  it("a bot open to everyone (#2618 Feedback) gives every signed-in person use, not a disabled one", () => {
    const facts: BotFacts = { ...bot([grant(`user:${BOB}`, "edit")]), everyone: "use" };
    expect(botLevel({ viewer: viewer(MIA), ...facts })).toBe("use");
    expect(botLevel({ viewer: viewer(BOB), ...facts })).toBe("edit");
    expect(botLevel({ viewer: viewer(MIA, { disabled: true }), ...facts })).toBeNull();
  });

  it("a read-only person (Perspicax sagax_bots use) holds use at most, their own bots included; never an admin", () => {
    const facts = bot([grant(`user:${BOB}`, "manage"), grant(`user:${CAROL}`, "use")]);
    expect(botLevel({ viewer: viewer(ALICE, { botsReadOnly: true }), ...facts })).toBe("use");
    expect(botLevel({ viewer: viewer(BOB, { botsReadOnly: true }), ...facts })).toBe("use");
    expect(botLevel({ viewer: viewer(CAROL, { botsReadOnly: true }), ...facts })).toBe("use");
    expect(botLevel({ viewer: viewer(DAVE, { botsReadOnly: true }), ...facts })).toBeNull();
    expect(botLevel({ viewer: viewer(ALICE, { botsReadOnly: true, orgAdmin: true }), ...facts })).toBe("owner");
    expect(can(viewer(ALICE, { botsReadOnly: true }), "bot.use", { kind: "bot", bot: facts })).toBe(true);
    expect(can(viewer(ALICE, { botsReadOnly: true }), "bot.run", { kind: "bot", bot: facts })).toBe(false);
    expect(can(viewer(ALICE, { botsReadOnly: true }), "bot.edit", { kind: "bot", bot: facts })).toBe(false);
    expect(can(viewer(ALICE, { botsReadOnly: true }), "bot.manage", { kind: "bot", bot: facts })).toBe(false);
    expect(can(viewer(BOB, { botsReadOnly: true }), "bot.edit", { kind: "bot", bot: facts })).toBe(false);
    expect(can(viewer(ALICE, { botsReadOnly: true, orgAdmin: true }), "bot.manage", { kind: "bot", bot: facts })).toBe(true);
  });

  it("a disabled person has nothing, even as owner", () => {
    expect(botLevel({ viewer: viewer(ALICE, { disabled: true }), ...bot([]) })).toBeNull();
    expect(botLevel({ viewer: viewer(BOB, { disabled: true }), ...bot([grant(`user:${BOB}`, "manage")]) })).toBeNull();
  });

  it("an admin without a grant cannot use the bot", () => {
    expect(can(viewer(ADMIN, { orgAdmin: true }), "bot.use", { kind: "bot", bot: bot([]) })).toBe(false);
    expect(can(viewer(ADMIN, { orgAdmin: true }), "org.settings", { kind: "org" })).toBe(true);
    expect(can(viewer(BOB), "org.settings", { kind: "org" })).toBe(false);
  });

  it("section membership gives the default level, capped at run", () => {
    const section = { ownerPrincipalId: ALICE, members: [{ target: "team:U", role: "readonly" as const }], defaultLevel: "run" as const };
    expect(botLevel({ viewer: viewer(DAVE), ...bot([], { sections: [section] }) })).toBe("run");
    expect(botLevel({ viewer: viewer(DAVE), ...bot([], { sections: [{ ...section, defaultLevel: "use" }] }) })).toBe("use");
    // a grant above the section still wins
    expect(botLevel({ viewer: viewer(DAVE), ...bot([grant(`user:${DAVE}`, "edit")], { sections: [section] }) })).toBe("edit");
    expect(botLevel({ viewer: viewer(BOB), ...bot([], { sections: [section] }) })).toBeNull();
  });

  it("the operator (no viewer) may do everything", () => {
    expect(can(undefined, "bot.manage", { kind: "bot", bot: bot([]) })).toBe(true);
    expect(canAdministerGrant(undefined, { bot: bot([]), target: `user:${BOB}`, newLevel: "manage", teamsOf })).toBe(true);
  });

  it("maps actions to levels", () => {
    const facts = bot([grant(`user:${BOB}`, "run")]);
    expect(can(viewer(BOB), "bot.use", { kind: "bot", bot: facts })).toBe(true);
    expect(can(viewer(BOB), "bot.run", { kind: "bot", bot: facts })).toBe(true);
    expect(can(viewer(BOB), "bot.edit", { kind: "bot", bot: facts })).toBe(false);
    expect(can(viewer(BOB), "bot.manage", { kind: "bot", bot: facts })).toBe(false);
  });
});

describe("grant administration (D4)", () => {
  it("owner and admin administer anything, manage included", () => {
    const facts = bot([]);
    expect(canAdministerGrant(viewer(ALICE), { bot: facts, target: `user:${BOB}`, newLevel: "manage", teamsOf })).toBe(true);
    expect(canAdministerGrant(viewer(ADMIN, { orgAdmin: true }), { bot: facts, target: "team:U", newLevel: "manage", teamsOf })).toBe(true);
    expect(grantAdministration(viewer(ADMIN, { orgAdmin: true }), facts)).toMatchObject({ any: true, maxLevel: "manage" });
  });

  it("a manage holder grants up to edit and never touches a manage grant", () => {
    const facts = bot([grant(`user:${BOB}`, "manage"), grant(`user:${CAROL}`, "manage")]);
    expect(canAdministerGrant(viewer(BOB), { bot: facts, target: `user:${DAVE}`, newLevel: "use", teamsOf })).toBe(true);
    expect(canAdministerGrant(viewer(BOB), { bot: facts, target: `user:${DAVE}`, newLevel: "edit", teamsOf })).toBe(true);
    expect(canAdministerGrant(viewer(BOB), { bot: facts, target: `user:${DAVE}`, newLevel: "manage", teamsOf })).toBe(false);
    expect(canAdministerGrant(viewer(BOB), { bot: facts, target: `user:${CAROL}`, teamsOf })).toBe(false);
    expect(grantAdministration(viewer(BOB), facts)).toMatchObject({ any: true, maxLevel: "edit" });
  });

  it("use, run and edit holders administer nothing", () => {
    for (const level of ["use", "run", "edit"] as const) {
      const facts = bot([grant(`user:${BOB}`, level)]);
      expect(canAdministerGrant(viewer(BOB), { bot: facts, target: `user:${DAVE}`, newLevel: "use", teamsOf })).toBe(false);
      expect(grantAdministration(viewer(BOB), facts)).toBeNull();
    }
  });

  it("a manager adds only with an anchor, up to its level, for their teams and members", () => {
    const noAnchor = bot([]);
    expect(canAdministerGrant(viewer(MIA), { bot: noAnchor, target: "team:T", newLevel: "use", teamsOf })).toBe(false);
    expect(grantAdministration(viewer(MIA), noAnchor)).toMatchObject({ any: false, teamIds: ["T"], canAdd: false });
    const anchored = bot([grant("team:T", "use")]);
    expect(canAdministerGrant(viewer(MIA), { bot: anchored, target: `user:${CAROL}`, newLevel: "use", teamsOf })).toBe(true);
    expect(canAdministerGrant(viewer(MIA), { bot: anchored, target: `user:${CAROL}`, newLevel: "run", teamsOf })).toBe(false);
    expect(canAdministerGrant(viewer(MIA), { bot: anchored, target: "team:T", newLevel: "run", teamsOf })).toBe(false);
    expect(grantAdministration(viewer(MIA), anchored)).toMatchObject({ any: false, teamIds: ["T"], maxLevel: "use", canAdd: true });
    // dave is not in her teams; team U is not hers
    expect(canAdministerGrant(viewer(MIA), { bot: anchored, target: `user:${DAVE}`, newLevel: "use", teamsOf })).toBe(false);
    expect(canAdministerGrant(viewer(MIA), { bot: anchored, target: "team:U", newLevel: "use", teamsOf })).toBe(false);
  });

  it("a manager anchored at manage still gives at most edit", () => {
    const both = viewer(MIA, { teams: [{ id: "T", manager: true }, { id: "T2", manager: true }] });
    const anchored = bot([grant("team:T", "manage")]);
    expect(canAdministerGrant(both, { bot: anchored, target: "team:T2", newLevel: "manage", teamsOf })).toBe(false);
    expect(canAdministerGrant(both, { bot: anchored, target: `user:${CAROL}`, newLevel: "manage", teamsOf })).toBe(false);
    expect(canAdministerGrant(both, { bot: anchored, target: "team:T2", newLevel: "edit", teamsOf })).toBe(true);
    expect(canAdministerGrant(both, { bot: anchored, target: `user:${CAROL}`, newLevel: "edit", teamsOf })).toBe(true);
    expect(grantAdministration(both, anchored)).toMatchObject({ any: false, maxLevel: "edit", canAdd: true });
  });

  it("a grant the manager gave herself is not an anchor", () => {
    const own = bot([grant("team:T", "run", MIA)]);
    expect(canAdministerGrant(viewer(MIA), { bot: own, target: `user:${CAROL}`, newLevel: "use", teamsOf })).toBe(false);
  });

  it("a manager lowers or removes grants of their teams and members, never others", () => {
    const facts = bot([grant("team:T", "run"), grant(`user:${CAROL}`, "edit"), grant(`user:${BOB}`, "use")]);
    expect(canAdministerGrant(viewer(MIA), { bot: facts, target: "team:T", teamsOf })).toBe(true);
    expect(canAdministerGrant(viewer(MIA), { bot: facts, target: `user:${CAROL}`, newLevel: "use", teamsOf })).toBe(true);
    expect(canAdministerGrant(viewer(MIA), { bot: facts, target: `user:${BOB}`, teamsOf })).toBe(false);
    // removing an absent grant is not "allowed" (the route answers 404 or 403)
    expect(canAdministerGrant(viewer(MIA), { bot: facts, target: "team:X", teamsOf })).toBe(false);
  });

  it("a manager never adds or raises an entry for herself or a co-manager", () => {
    const anchored = bot([grant("team:T", "run")]);
    expect(canAdministerGrant(viewer(MIA), { bot: anchored, target: `user:${MIA}`, newLevel: "use", teamsOf })).toBe(false);
    expect(canAdministerGrant(viewer(MIA), { bot: anchored, target: `user:${MIA}`, newLevel: "run", teamsOf })).toBe(false);
    expect(botLevel({ viewer: viewer(MIA), ...anchored })).toBeNull();
    expect(canAdministerGrant(viewer(MIA), { bot: anchored, target: `user:${NED}`, newLevel: "use", teamsOf })).toBe(false);
    // an existing entry of hers: lowered or removed, never raised
    const own = bot([grant("team:T", "run"), grant(`user:${MIA}`, "use", ADMIN)]);
    expect(canAdministerGrant(viewer(MIA), { bot: own, target: `user:${MIA}`, newLevel: "run", teamsOf })).toBe(false);
    expect(canAdministerGrant(viewer(MIA), { bot: own, target: `user:${MIA}`, newLevel: "use", teamsOf })).toBe(true);
    expect(canAdministerGrant(viewer(MIA), { bot: own, target: `user:${MIA}`, teamsOf })).toBe(true);
  });

  it("a disabled manager administers nothing", () => {
    expect(canAdministerGrant(viewer(MIA, { disabled: true }), { bot: bot([grant("team:T", "use")]), target: "team:T", teamsOf })).toBe(false);
  });

  it("a read-only person administers no grant, their own bots included; an admin still can", () => {
    const facts = bot([grant(`user:${BOB}`, "manage")]);
    const ownerRo = viewer(ALICE, { botsReadOnly: true });
    expect(canAdministerGrant(ownerRo, { bot: facts, target: `user:${DAVE}`, newLevel: "use", teamsOf })).toBe(false);
    expect(grantAdministration(ownerRo, facts)).toBeNull();
    const manageRo = viewer(BOB, { botsReadOnly: true });
    expect(canAdministerGrant(manageRo, { bot: facts, target: `user:${DAVE}`, newLevel: "use", teamsOf })).toBe(false);
    expect(grantAdministration(manageRo, facts)).toBeNull();
    const adminRo = viewer(ADMIN, { botsReadOnly: true, orgAdmin: true });
    expect(canAdministerGrant(adminRo, { bot: facts, target: `user:${DAVE}`, newLevel: "manage", teamsOf })).toBe(true);
    expect(grantAdministration(adminRo, facts)).toMatchObject({ any: true, maxLevel: "manage" });
  });
});

describe("rooms and sections", () => {
  it("rooms list people by id or by team", () => {
    expect(roomAccess({ viewer: viewer(DAVE), humanIds: ["team:U"] })).toBe("participant");
    expect(roomAccess({ viewer: viewer(CAROL), humanIds: ["team:U"] })).toBeNull();
    expect(roomAccess({ viewer: viewer(BOB), humanIds: [BOB] })).toBe("participant");
    expect(roomAccess({ viewer: undefined, humanIds: [] })).toBe("owner");
    expect(can(viewer(DAVE), "channel.post", { kind: "room", humanIds: ["team:U"] })).toBe(true);
  });

  it("a section's roles: read-only reads, participant posts, moderator moderates", () => {
    const section = { ownerPrincipalId: ALICE, members: [{ target: "team:T", role: "readonly" as const }, { target: `user:${BOB}`, role: "moderator" as const }], defaultLevel: "use" as const };
    expect(can(viewer(CAROL), "channel.read", { kind: "room", humanIds: [], section })).toBe(true);
    expect(can(viewer(CAROL), "channel.post", { kind: "room", humanIds: [], section })).toBe(false);
    expect(can(viewer(BOB), "channel.post", { kind: "room", humanIds: [], section })).toBe(true);
    expect(canModerateSection(viewer(BOB), section)).toBe(true);
    expect(canModerateSection(viewer(CAROL), section)).toBe(false);
    expect(canModerateSection(viewer(ALICE), section)).toBe(true);
    expect(canModerateSection(viewer(ADMIN, { orgAdmin: true }), section)).toBe(true);
    expect(can(viewer(DAVE), "channel.read", { kind: "room", humanIds: [], section })).toBe(false);
  });

  it("a manager edits section entries of their teams with the anchor rule", () => {
    const empty = { ownerPrincipalId: ALICE, members: [], defaultLevel: "use" as const };
    expect(canAdministerSectionMember(viewer(MIA), { section: empty, target: "team:T", role: "readonly", teamsOf })).toBe(false);
    const anchored = { ...empty, members: [{ target: "team:T", role: "participant" as const }] };
    expect(canAdministerSectionMember(viewer(MIA), { section: anchored, target: `user:${CAROL}`, role: "participant", teamsOf })).toBe(true);
    expect(canAdministerSectionMember(viewer(MIA), { section: anchored, target: `user:${CAROL}`, role: "moderator", teamsOf })).toBe(false);
    expect(canAdministerSectionMember(viewer(MIA), { section: anchored, target: "team:T", teamsOf })).toBe(true);
    expect(canAdministerSectionMember(viewer(MIA), { section: anchored, target: "team:U", role: "readonly", teamsOf })).toBe(false);
  });

  it("a manager never adds or raises a section entry for herself or a co-manager", () => {
    const anchored = { ownerPrincipalId: ALICE, members: [{ target: "team:T", role: "participant" as const }], defaultLevel: "use" as const };
    expect(canAdministerSectionMember(viewer(MIA), { section: anchored, target: `user:${MIA}`, role: "participant", teamsOf })).toBe(false);
    expect(canAdministerSectionMember(viewer(MIA), { section: anchored, target: `user:${MIA}`, role: "readonly", teamsOf })).toBe(false);
    expect(canAdministerSectionMember(viewer(MIA), { section: anchored, target: `user:${NED}`, role: "readonly", teamsOf })).toBe(false);
    const listed = { ...anchored, members: [...anchored.members, { target: `user:${MIA}`, role: "readonly" as const }] };
    expect(canAdministerSectionMember(viewer(MIA), { section: listed, target: `user:${MIA}`, role: "participant", teamsOf })).toBe(false);
    expect(canAdministerSectionMember(viewer(MIA), { section: listed, target: `user:${MIA}`, teamsOf })).toBe(true);
  });

  it("room people: admins edit, a manager edits their entries with an anchor", () => {
    expect(canEditRoomHumans(viewer(ADMIN, { orgAdmin: true }), { before: [], after: ["team:U"], teamsOf })).toBe(true);
    expect(canEditRoomHumans(viewer(MIA), { before: [], after: ["team:T"], teamsOf })).toBe(false);
    expect(canEditRoomHumans(viewer(MIA), { before: ["team:T"], after: ["team:T", CAROL], teamsOf })).toBe(true);
    expect(canEditRoomHumans(viewer(MIA), { before: ["team:T", CAROL], after: [], teamsOf })).toBe(true);
    expect(canEditRoomHumans(viewer(MIA), { before: ["team:T"], after: ["team:T", DAVE], teamsOf })).toBe(false);
    expect(canEditRoomHumans(viewer(BOB), { before: [], after: [BOB], teamsOf })).toBe(false);
  });

  it("a manager never adds herself or a co-manager to a room", () => {
    expect(canEditRoomHumans(viewer(MIA), { before: ["team:T"], after: ["team:T", MIA], teamsOf })).toBe(false);
    expect(canEditRoomHumans(viewer(MIA), { before: ["team:T"], after: ["team:T", `user:${MIA}`], teamsOf })).toBe(false);
    expect(canEditRoomHumans(viewer(MIA), { before: ["team:T"], after: ["team:T", NED], teamsOf })).toBe(false);
    // leaving is fine
    expect(canEditRoomHumans(viewer(MIA), { before: ["team:T", MIA], after: ["team:T"], teamsOf })).toBe(true);
  });
});
