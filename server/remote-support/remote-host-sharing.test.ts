// Bot scope and sharing of enrolled hosts (#2957): "All bots" is the default
// and is never stored; shares are idempotent, isolated per owner, and reach
// a person directly or through one of their teams.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RemoteHostSharing } from "./remote-host-sharing.ts";

const HOST = `h_${"ab".repeat(16)}`;
const OTHER = `h_${"ef".repeat(16)}`;
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const file = () => { const dir = mkdtempSync(join(tmpdir(), "sagax-host-sharing-")); dirs.push(dir); return join(dir, "remote-host-sharing.json"); };

describe("bot scope per host", () => {
  it("defaults to all bots, keeps the chosen bots, and resets on null or an empty list", () => {
    const path = file();
    const sharing = new RemoteHostSharing(path, () => 1_000);
    expect(sharing.botScope("tech@acme", HOST)).toBeNull();
    expect(sharing.botAllowed("tech@acme", HOST, "bot-1")).toBe(true);
    expect(sharing.botAllowed("tech@acme", HOST, null)).toBe(true);

    expect(sharing.setBotScope("Tech@Acme", HOST, ["bot-1", " bot-2 ", "bot-1"])).toEqual(["bot-1", "bot-2"]);
    expect(sharing.botAllowed("tech@acme", HOST, "bot-2")).toBe(true);
    expect(sharing.botAllowed("tech@acme", HOST, "bot-9")).toBe(false);
    expect(sharing.botAllowed("tech@acme", HOST, null)).toBe(false);
    // another host of the same person stays open to every bot
    expect(sharing.botAllowed("tech@acme", OTHER, "bot-9")).toBe(true);
    // another person's same host id is not affected
    expect(sharing.botScope("bob@acme", HOST)).toBeNull();
    expect(sharing.botScopes("tech@acme")).toEqual(new Map([[HOST, ["bot-1", "bot-2"]]]));

    // survives a restart
    expect(new RemoteHostSharing(path).botScope("tech@acme", HOST)).toEqual(["bot-1", "bot-2"]);
    expect(sharing.setBotScope("tech@acme", HOST, [])).toBeNull();
    expect(new RemoteHostSharing(path).botScope("tech@acme", HOST)).toBeNull();
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ version: 1, scopes: [], shares: [] });
  });
});

describe("shares per host", () => {
  it("shares once per target, lists by owner, unshares and forgets", () => {
    const sharing = new RemoteHostSharing(file(), () => 1_000);
    expect(sharing.share("tech@acme", HOST, { kind: "person", id: "Marie@Acme" })).toEqual([{ kind: "person", id: "marie@acme" }]);
    expect(sharing.share("tech@acme", HOST, { kind: "person", id: "marie@acme" })).toHaveLength(1);
    expect(sharing.share("tech@acme", HOST, { kind: "team", id: "team-support" })).toEqual([
      { kind: "person", id: "marie@acme" }, { kind: "team", id: "team-support" },
    ]);
    sharing.share("tech@acme", OTHER, { kind: "person", id: "paul@acme" });
    expect(sharing.sharesByOwner("tech@acme")).toEqual(new Map([
      [HOST, [{ kind: "person", id: "marie@acme" }, { kind: "team", id: "team-support" }]],
      [OTHER, [{ kind: "person", id: "paul@acme" }]],
    ]));
    // another owner sees none of them
    expect(sharing.sharesByOwner("bob@acme").size).toBe(0);
    expect(sharing.sharesOf("bob@acme", HOST)).toEqual([]);

    expect(sharing.unshare("tech@acme", HOST, { kind: "person", id: "marie@acme" })).toEqual([{ kind: "team", id: "team-support" }]);
    sharing.setBotScope("tech@acme", HOST, ["bot-1"]);
    sharing.forget("tech@acme", HOST);
    expect(sharing.sharesOf("tech@acme", HOST)).toEqual([]);
    expect(sharing.botScope("tech@acme", HOST)).toBeNull();
    expect(sharing.sharesOf("tech@acme", OTHER)).toEqual([{ kind: "person", id: "paul@acme" }]);
  });

  it("reaches a person directly or through a team, never through their own shares", () => {
    const sharing = new RemoteHostSharing(file(), () => 1_000);
    sharing.share("tech@acme", HOST, { kind: "person", id: "marie@acme" });
    sharing.share("tech@acme", HOST, { kind: "team", id: "team-support" });
    sharing.share("tech@acme", OTHER, { kind: "team", id: "team-compta" });
    sharing.share("marie@acme", OTHER, { kind: "person", id: "paul@acme" });

    // direct and team hit on the same host counts once
    expect(sharing.sharedWith("marie@acme", ["team-support"])).toEqual([{ hostId: HOST, owner: "tech@acme" }]);
    expect(sharing.sharedWith("paul@acme", ["team-compta"])).toEqual([
      { hostId: OTHER, owner: "tech@acme" }, { hostId: OTHER, owner: "marie@acme" },
    ]);
    // isolation: no share, no team -> nothing
    expect(sharing.sharedWith("bob@acme", [])).toEqual([]);
    // an owner never receives their own share back
    expect(sharing.sharedWith("tech@acme", ["team-support", "team-compta"])).toEqual([]);
  });

  it("reads a damaged file as all bots and no share", () => {
    const path = file();
    writeFileSync(path, "{not json");
    const sharing = new RemoteHostSharing(path);
    expect(sharing.botScope("tech@acme", HOST)).toBeNull();
    expect(sharing.sharedWith("tech@acme")).toEqual([]);
    writeFileSync(path, JSON.stringify({ version: 1, scopes: [{ hostId: "bad", principalId: "x", botIds: [], setAt: 1 }], shares: [] }));
    expect(new RemoteHostSharing(path).botScopes("x").size).toBe(0);
  });
});
