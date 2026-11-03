import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ToolGrantStore } from "./tool-grants.ts";
import { guardDecision, toolGuardMode } from "./tool-guard.ts";

const bot = { kind: "bot" as const, id: "bot-1" };
const owner = { kind: "user" as const, id: "pr_owner" };
const admin = { tier: "admin" as const, scope: "agents:admin", readOnly: false, defaultEnabled: false };

describe("tool grants", () => {
  it("grants, persists, covers lower tiers of the same area, expires and revokes", () => {
    let t = 1_000;
    const file = join(mkdtempSync(join(tmpdir(), "grants-")), "tool-grants.json");
    const store = new ToolGrantStore(file, () => t);
    const g = store.grant(bot, "routines:write", "pr_owner", 5_000);
    expect(store.holds(bot, "routines:read")).toBe(true);
    expect(store.holds(bot, "routines:write")).toBe(true);
    expect(store.holds(bot, "routines:admin")).toBe(false);
    expect(store.holds(bot, "files:read")).toBe(false);
    expect(new ToolGrantStore(file, () => t).holds(bot, "routines:write")).toBe(true);
    t = 6_000;
    expect(store.holds(bot, "routines:write")).toBe(false);
    t = 1_000;
    expect(store.revoke(g.id, "pr_owner")).toBe(true);
    expect(store.holds(bot, "routines:write")).toBe(false);
    expect(JSON.parse(readFileSync(file, "utf8")).grants[0]).toMatchObject({ revokedBy: "pr_owner" });
    expect(() => store.grant(bot, "Routines", "pr_owner")).toThrow();
  });
});

describe("tool guard", () => {
  it("lets default-enabled reads and writes through; writes need approval", () => {
    const store = new ToolGrantStore(null);
    expect(guardDecision({ tier: "read", scope: "agents:read", readOnly: true, defaultEnabled: true }, bot, owner, store)).toEqual({ allow: true, reason: "default", needsApproval: false });
    expect(guardDecision({ tier: "write", scope: "agents:write", readOnly: false, defaultEnabled: true }, bot, owner, store)).toEqual({ allow: true, reason: "default", needsApproval: true });
  });

  it("keeps admin off without a grant, and a bot never past its speaker", () => {
    const store = new ToolGrantStore(null);
    expect(guardDecision(admin, bot, owner, store)).toMatchObject({ allow: false, reason: "not_granted" });
    store.grant(bot, "agents:admin", "pr_owner");
    expect(guardDecision(admin, bot, owner, store)).toMatchObject({ allow: false, reason: "speaker_not_granted" });
    store.grant(owner, "agents:admin", "pr_owner");
    expect(guardDecision(admin, bot, owner, store)).toEqual({ allow: true, reason: "grant", needsApproval: true });
  });

  it("lets the owner delete their own resource without a grant, and nobody else", () => {
    const store = new ToolGrantStore(null);
    const own = { tier: "admin" as const, scope: "bots:admin", readOnly: false, defaultEnabled: false, ownerScoped: true };
    const alice = { kind: "user" as const, id: "pr_alice" };
    const bob = { kind: "user" as const, id: "pr_bob" };
    // Alice herself, and her bot speaking for her.
    expect(guardDecision(own, alice, null, store, { ownerPrincipalId: "pr_alice" })).toEqual({ allow: true, reason: "owner", needsApproval: true });
    expect(guardDecision(own, bot, alice, store, { ownerPrincipalId: "pr_alice" })).toMatchObject({ allow: true, reason: "owner" });
    // Bob's resource, an unknown owner, or a bot with no speaker: the grant rule.
    expect(guardDecision(own, alice, null, store, { ownerPrincipalId: "pr_bob" })).toMatchObject({ allow: false, reason: "not_granted" });
    expect(guardDecision(own, bot, alice, store, { ownerPrincipalId: "pr_bob" })).toMatchObject({ allow: false, reason: "not_granted" });
    expect(guardDecision(own, bot, bob, store, { ownerPrincipalId: "pr_alice" })).toMatchObject({ allow: false });
    expect(guardDecision(own, alice, null, store)).toMatchObject({ allow: false, reason: "not_granted" });
    expect(guardDecision(own, bot, null, store, { ownerPrincipalId: "pr_alice" })).toMatchObject({ allow: false });
    // An admin route that is not owner-scoped stays admin for its owner too.
    expect(guardDecision(admin, alice, null, store, { ownerPrincipalId: "pr_alice" })).toMatchObject({ allow: false, reason: "not_granted" });
  });

  it("treats an unknown route (off by default) as needing a grant", () => {
    expect(guardDecision({ tier: "write", scope: "unknown:write", readOnly: false, defaultEnabled: false }, bot, null, new ToolGrantStore(null))).toMatchObject({ allow: false, reason: "not_granted" });
  });

  it("defaults to shadow", () => {
    expect(toolGuardMode(undefined)).toBe("shadow");
    expect(toolGuardMode("enforce")).toBe("enforce");
    expect(toolGuardMode("bogus")).toBe("shadow");
  });
});
