import { afterEach, describe, expect, it } from "vitest";

import { orgPeerInScope } from "./peer-scope.ts";
import { canReachPeer, reachablePeers, resolveTeammate, setPeerScope, type RosterMember } from "./peer-roster.ts";

type Bot = RosterMember & { ownerUserId: string };

const ALICE = "pr_aaaaaaaa-0000-4000-8000-000000000001";
const BOB = "pr_bbbbbbbb-0000-4000-8000-000000000002";
const DAVE = "pr_dddddddd-0000-4000-8000-000000000004";

// No bot has a section: on an organization server the sidebar's sections
// are each person's own and bot.section is never written.
const ada: Bot = { id: "ada", name: "Ada", ownerUserId: ALICE };
const ari: Bot = { id: "ari", name: "Ari", ownerUserId: ALICE };
const bee: Bot = { id: "bee", name: "Bee", ownerUserId: BOB };
const quasar: Bot = { id: "quasar", name: "Quasar", ownerUserId: DAVE };
const fleet = [ada, ari, bee, quasar];

// Bob holds a grant on Ari; nobody else is shared.
const shares: Record<string, string[]> = { ari: [BOB] };
const deps = {
  ownerOf: (bot: Bot) => bot.ownerUserId,
  personSeesBot: (principalId: string, bot: Bot) => bot.ownerUserId === principalId || (shares[bot.id] ?? []).includes(principalId),
};

describe("orgPeerInScope", () => {
  it("keeps a bot's own owner's bots in scope", () => {
    expect(orgPeerInScope(ada, ari, deps)).toBe(true);
  });

  it("adds the bots shared with the owner, never the rest of the organization", () => {
    expect(orgPeerInScope(bee, ari, deps)).toBe(true);
    expect(orgPeerInScope(bee, ada, deps)).toBe(false);
    expect(orgPeerInScope(ada, quasar, deps)).toBe(false);
    expect(orgPeerInScope(quasar, ada, deps)).toBe(false);
  });

  it("is not symmetric: sharing Ari with Bob does not open Bob's bots to Alice's", () => {
    expect(orgPeerInScope(ari, bee, deps)).toBe(false);
  });

  it("fails closed for an empty owner (index.ts gives an unrecorded one to the local operator)", () => {
    const orphan: Bot = { id: "orphan", name: "Orphan", ownerUserId: "" };
    expect(orgPeerInScope(orphan, { ...quasar, ownerUserId: "" }, deps)).toBe(false);
  });

  it("compares owners case-insensitively", () => {
    expect(orgPeerInScope(ada, { ...ari, ownerUserId: ALICE.toUpperCase() }, deps)).toBe(true);
  });
});

describe("reachablePeers with the organization scope", () => {
  afterEach(() => setPeerScope(null));

  const byId = new Map(fleet.map((bot) => [bot.id, bot]));
  const install = () => setPeerScope((from, target) => orgPeerInScope(byId.get(from.id)!, byId.get(target.id)!, deps));

  it("without a scope (solo server), every bot of the section is a teammate", () => {
    expect(reachablePeers(fleet, ada).map((bot) => bot.id)).toEqual(["ari", "bee", "quasar"]);
  });

  it("names only the owner's bots and the ones shared with them", () => {
    install();
    expect(reachablePeers(fleet, ada).map((bot) => bot.id)).toEqual(["ari"]);
    expect(reachablePeers(fleet, bee).map((bot) => bot.id)).toEqual(["ari"]);
    expect(reachablePeers(fleet, quasar).map((bot) => bot.id)).toEqual([]);
    expect(canReachPeer(ada, quasar)).toBe(false);
  });

  it("does not resolve another person's bot by name", () => {
    install();
    expect(resolveTeammate(fleet, ada, "Quasar")).toHaveProperty("error");
    expect(resolveTeammate(fleet, ada, "Ari")).toMatchObject({ id: "ari" });
  });
});
