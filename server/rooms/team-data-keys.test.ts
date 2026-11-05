// #2045: team instructions and memory keyed by owner + section id.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TeamMemory } from "../memory/team-memory.ts";
import {
  isTeamDataKey,
  migrateNamedKeys,
  teamDataKey,
} from "./section-context.ts";
import { SectionChannels } from "./section-channels.ts";

const pid = (n: number) => `pr_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ALICE = pid(1);
const BOB = pid(2);

describe("team data keys (#2045)", () => {
  it("builds a stable owner/id key", () => {
    const key = teamDataKey(ALICE, "sec_00000000-0000-4000-8000-000000000001");
    expect(key).toBe(`${ALICE}/sec_00000000-0000-4000-8000-000000000001`);
    expect(isTeamDataKey(key)).toBe(true);
    expect(isTeamDataKey("Ops")).toBe(false);
  });

  it("two people with the same team name keep separate instructions and memory", () => {
    const dir = mkdtempSync(join(tmpdir(), "team-data-"));
    const channels = new SectionChannels({
      path: join(dir, "section-channels.json"),
      newId: (() => {
        let n = 0;
        return () => `sec_00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
      })(),
    });
    const alice = channels.ensure("Ops", ALICE);
    const bob = channels.ensure("Ops", BOB);
    expect(alice.id).not.toBe(bob.id);

    const aliceKey = teamDataKey(alice.ownerPrincipalId, alice.id);
    const bobKey = teamDataKey(bob.ownerPrincipalId, bob.id);
    const briefs = {
      [aliceKey]: { text: "Alice Ops brief", updatedAt: 1 },
      [bobKey]: { text: "Bob Ops brief", updatedAt: 2 },
    };
    expect(briefs[aliceKey]?.text).toBe("Alice Ops brief");
    expect(briefs[bobKey]?.text).toBe("Bob Ops brief");
    expect(briefs.Ops).toBeUndefined();

    const memory = new TeamMemory(join(dir, "team-memory.json"));
    memory.propose(aliceKey, { kind: "term", name: "VPN", detail: "Alice network" }, {
      botId: "a", botName: "A", threadId: "t", at: 1,
    });
    memory.propose(bobKey, { kind: "term", name: "VPN", detail: "Bob network" }, {
      botId: "b", botName: "B", threadId: "t", at: 2,
    });
    expect(memory.list(aliceKey).map((entry) => entry.detail)).toEqual(["Alice network"]);
    expect(memory.list(bobKey).map((entry) => entry.detail)).toEqual(["Bob network"]);
    expect(memory.list("Ops")).toEqual([]);
  });

  it("migrates legacy name keys onto the section owner's id", () => {
    const dir = mkdtempSync(join(tmpdir(), "team-migrate-"));
    const channels = new SectionChannels({
      path: join(dir, "section-channels.json"),
      newId: () => "sec_00000000-0000-4000-8000-000000000099",
    });
    channels.ensure("Ops", ALICE);

    const legacy = { Ops: { text: "Legacy brief", updatedAt: 1 } };
    const { next, moved } = migrateNamedKeys(legacy, (name) => {
      const record = channels.byName(name);
      return record ? { ownerPrincipalId: record.ownerPrincipalId, id: record.id } : null;
    });
    expect(moved).toBe(1);
    expect(next[teamDataKey(ALICE, "sec_00000000-0000-4000-8000-000000000099")]).toEqual(legacy.Ops);
    expect(next.Ops).toBeUndefined();

    const memory = new TeamMemory(join(dir, "team-memory.json"));
    memory.propose("Ops", { kind: "place", name: "Board", detail: "War room" }, {
      botId: "a", botName: "A", threadId: "t", at: 1,
    });
    expect(memory.migrateSectionKeys((name) => {
      const record = channels.byName(name);
      return record ? { ownerPrincipalId: record.ownerPrincipalId, id: record.id } : null;
    })).toBe(1);
    expect(memory.list("Ops")).toEqual([]);
    expect(memory.list(teamDataKey(ALICE, "sec_00000000-0000-4000-8000-000000000099")).map((entry) => entry.name)).toEqual(["Board"]);
  });
});

describe("migrateSectionContextKeys against a temp data dir", () => {
  const previous = process.env.SAGAX_DATA_DIR;

  afterEach(() => {
    if (previous === undefined) delete process.env.SAGAX_DATA_DIR;
    else process.env.SAGAX_DATA_DIR = previous;
    vi.resetModules();
  });

  it("rewrites the on-disk brief file once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "brief-migrate-"));
    process.env.SAGAX_DATA_DIR = dir;
    vi.resetModules();
    const mod = await import("./section-context.ts");
    writeFileSync(mod.SECTION_CONTEXTS_FILE, JSON.stringify({
      version: 1,
      sections: ["Ops"],
      contexts: { Ops: { text: "Move me", updatedAt: 3 } },
    }));
    const moved = mod.migrateSectionContextKeys(() => ({
      ownerPrincipalId: ALICE,
      id: "sec_00000000-0000-4000-8000-000000000042",
    }));
    expect(moved).toBe(1);
    expect(mod.readSectionContext("Ops")).toBeNull();
    expect(mod.readSectionContext(mod.teamDataKey(ALICE, "sec_00000000-0000-4000-8000-000000000042"))?.text).toBe("Move me");
  });
});
