// #3545: a start's section owner check must not read the whole activity log
// in one synchronous pass. Who created each section is kept with the records,
// filled once from the log.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ sync: 0, sliced: 0, rows: 0 }));
vi.mock("../activity/admin-activity.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../activity/admin-activity.ts")>();
  return {
    ...original,
    readAdminActivityRange: (...args: Parameters<typeof original.readAdminActivityRange>) => {
      reads.sync += 1;
      const rows = original.readAdminActivityRange(...args);
      reads.rows += rows.length;
      return rows;
    },
    scanAdminActivityRange: async (...args: Parameters<typeof original.scanAdminActivityRange>) => {
      reads.sliced += 1;
      const rows = await original.scanAdminActivityRange(...args);
      reads.rows += rows.length;
      return rows;
    },
  };
});

const { readAdminActivityRange, scanAdminActivityRange } = await import("../activity/admin-activity.ts");
const { SectionChannels } = await import("./section-channels.ts");
const { prepareSectionCreators, sectionCreationOf } = await import("./section-creators.ts");
const { removeTempDir } = await import("../testing/cleanup.ts");

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "section-creators-"));
  dirs.push(dir);
  return dir;
};
beforeEach(() => { reads.sync = 0; reads.sliced = 0; reads.rows = 0; });
afterEach(async () => { for (const dir of dirs.splice(0)) await removeTempDir(dir); });

const person = (principalId: string) => ({ kind: "person", principalId, via: "sagax" });
const ID = (n: number) => `sec_0000000${n}-0000-4000-8000-000000000000`;

/** A log of many thousands of rows over three months, a handful about sections. */
function bigLog(dir: string): void {
  mkdirSync(join(dir, "admin-activity"), { recursive: true });
  const sectionRows = [
    { action: "section.create", target: { kind: "section", id: ID(1), name: "Ops" }, actor: person("ada") },
    { action: "section.create", target: { kind: "section", id: ID(2), name: "Ops" }, actor: person("bob") },
    { action: "section.create", target: { kind: "section", id: ID(3), name: "Sales" }, actor: person("cy") },
    { action: "section.rename", target: { kind: "section", id: ID(3), name: "Field" }, actor: person("cy") },
    { action: "section.create", target: { kind: "section", id: ID(4), name: "Lab" }, actor: { kind: "loopback" } },
    { action: "section.create", target: { kind: "section", id: ID(1), name: "Ops" }, actor: person("eve") },
  ];
  for (const [month, offset] of [["2026-09", 0], ["2026-10", 2], ["2026-11", 4]] as const) {
    const lines: string[] = [];
    for (let i = 0; i < 3000; i++) {
      const at = `${month}-0${1 + (i % 9)}T00:00:${String(i % 60).padStart(2, "0")}.000Z`;
      if (i === 1500 || i === 2500) {
        const row = sectionRows[offset + (i === 1500 ? 0 : 1)]!;
        lines.push(JSON.stringify({ at, category: "section", ...row }));
      } else {
        lines.push(JSON.stringify({ at, category: "bot", action: "bot.update", target: { kind: "bot", id: `b${i}` }, changed: ["name"], actor: person("ada") }));
      }
    }
    writeFileSync(join(dir, "admin-activity", `${month}.ndjson`), lines.join("\n") + "\n");
  }
}

/** The creators exactly as the start found them before #3545: the whole log. */
function creatorsFromWholeLog(dir: string) {
  const byId = new Map<string, string>();
  const byName = new Map<string, Set<string>>();
  for (const row of readAdminActivityRange(dir, { from: new Date(0), to: new Date() })) {
    if (row.action !== "section.create" || row.target?.kind !== "section") continue;
    const actor = (row.actor as { principalId?: unknown } | undefined)?.principalId;
    if (typeof actor !== "string" || !actor.trim()) continue;
    if (row.target.id && !byId.has(row.target.id)) byId.set(row.target.id, actor);
    if (row.target.name) byName.set(row.target.name.trim(), (byName.get(row.target.name.trim()) ?? new Set()).add(actor));
  }
  return { byId, byName };
}

const channelsIn = (dir: string) => new SectionChannels({ path: join(dir, "section-channels.json"), now: () => 1_000 });

/** A start's owner check: the creators step, then verifyOwners. */
async function startOwnerCheck(dir: string, needNow = true) {
  const channels = channelsIn(dir);
  await prepareSectionCreators(channels, dir, needNow);
  return channels.verifyOwners({
    inUse: () => false,
    creatorOf: (record) => channels.creatorOf(record.id),
    personalOwners: () => [],
    orderOwners: () => [],
  });
}

describe("who created each section (#3545)", () => {
  it("a start reads no activity row once the creators are on record", async () => {
    const dir = tempDir();
    bigLog(dir);
    const first = channelsIn(dir);
    await prepareSectionCreators(first, dir, false);
    expect(first.creatorsFilled()).toBe(true);
    reads.sync = 0; reads.sliced = 0; reads.rows = 0;

    await startOwnerCheck(dir);
    await startOwnerCheck(dir, false);

    expect(reads.sync).toBe(0);
    expect(reads.sliced).toBe(0);
    expect(reads.rows).toBe(0);
  });

  it("the one-time fill finds the same creators as the whole log, sliced or now", async () => {
    const dir = tempDir();
    bigLog(dir);
    const whole = creatorsFromWholeLog(dir);
    reads.rows = 0;
    for (const needNow of [false, true]) {
      const home = tempDir();
      const channels = new SectionChannels({ path: join(home, "section-channels.json") });
      await prepareSectionCreators(channels, dir, needNow);
      for (const [id, actor] of whole.byId) expect(channels.creatorOf(id)).toBe(actor);
      expect(channels.creatorOf(ID(4))).toBeNull();
      for (const [name, actors] of whole.byName) expect(new Set(channels.creatorsOfName(name))).toEqual(actors);
      expect(channels.creatorsOfName("Field")).toEqual([]);
    }
    // two fills, each opening only the five creation rows, never the 8995 others
    expect(reads.rows).toBe(10);
    expect(whole.byId.get(ID(1))).toBe("ada");
    expect(new Set(whole.byName.get("Ops"))).toEqual(new Set(["ada", "bob", "eve"]));
  });

  it("the sliced fill gives the event loop back", async () => {
    const dir = tempDir();
    bigLog(dir);
    let turns = 0;
    let running = true;
    const spin = () => { if (!running) return; turns += 1; setImmediate(spin); };
    setImmediate(spin);
    const rows = await scanAdminActivityRange(dir, { from: new Date(0), to: new Date() }, { action: (action) => action === "section.create", sliceMs: 0 });
    running = false;
    expect(rows).toHaveLength(5);
    expect(turns).toBeGreaterThan(100);
  });

  it("a section created or renamed after the fill keeps its creator, across a restart", async () => {
    const dir = tempDir();
    bigLog(dir);
    const channels = channelsIn(dir);
    await prepareSectionCreators(channels, dir, false);
    const record = channels.ensure("Night", "zoe");
    const creation = sectionCreationOf({ action: "section.create", target: { kind: "section", id: record.id, name: record.name }, actor: person("zoe") as never });
    expect(creation).toEqual({ id: record.id, name: "Night", principalId: "zoe" });
    channels.noteCreator(creation!);
    channels.renameById(record.id, "Late");
    channels.renameById(ID(1), "Ops 2");

    const again = channelsIn(dir);
    expect(again.creatorsFilled()).toBe(true);
    expect(again.creatorOf(record.id)).toBe("zoe");
    expect(again.creatorsOfName("Night")).toEqual(["zoe"]);
    expect(again.creatorOf(ID(1))).toBe("ada");
    expect(sectionCreationOf({ action: "section.rename", target: { kind: "section", id: record.id }, actor: person("zoe") as never })).toBeNull();
  });
});
