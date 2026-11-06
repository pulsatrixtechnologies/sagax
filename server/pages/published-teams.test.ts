// #2045: published-teams.json keys move from display name to section id.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  migratePublishedTeamEntries,
  migratePublishedTeamKeys,
  PUBLISHED_TEAMS_FILE,
  readPublishedTeam,
  writePublishedTeam,
  type PublishedTeam,
} from "./published-teams.ts";

const SEC_A = "sec_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const sample = (packageId: string): PublishedTeam => ({
  packageId,
  lastRelease: "1.0.0",
  keys: { bots: {}, rooms: {}, routines: {} },
});

describe("published-teams (#2045)", () => {
  beforeEach(() => {
    mkdirSync(dirname(PUBLISHED_TEAMS_FILE), { recursive: true, mode: 0o700 });
    rmSync(PUBLISHED_TEAMS_FILE, { force: true });
  });

  it("migrates an unambiguous name key onto the section id", () => {
    const teams = new Map<string, PublishedTeam>([["Ops", sample("ops-pack")]]);
    const { next, moved } = migratePublishedTeamEntries(teams, (name) => (name === "Ops" ? SEC_A : null));
    expect(moved).toBe(1);
    expect(next.has("Ops")).toBe(false);
    expect(next.get(SEC_A)).toEqual(sample("ops-pack"));
  });

  it("leaves a name alone when two owners share it", () => {
    const teams = new Map<string, PublishedTeam>([["Ops", sample("ops-pack")]]);
    const { next, moved } = migratePublishedTeamEntries(teams, () => null);
    expect(moved).toBe(0);
    expect(next.get("Ops")).toEqual(sample("ops-pack"));
  });

  it("drops a leftover name key when the id key already exists", () => {
    const teams = new Map<string, PublishedTeam>([
      ["Ops", sample("legacy-name")],
      [SEC_A, sample("by-id")],
    ]);
    const { next, moved } = migratePublishedTeamEntries(teams, () => SEC_A);
    expect(moved).toBe(1);
    expect(next.has("Ops")).toBe(false);
    expect(next.get(SEC_A)?.packageId).toBe("by-id");
  });

  it("rewrites the on-disk file at boot when the owner is unambiguous", () => {
    writeFileSync(PUBLISHED_TEAMS_FILE, JSON.stringify({
      version: 1,
      teams: {
        Ops: sample("ops-pack"),
        Sales: sample("sales-pack"),
      },
    }));
    const moved = migratePublishedTeamKeys((name) => {
      if (name === "Ops") return SEC_A;
      // Sales held by two people: stay on the name key.
      return null;
    });
    expect(moved).toBe(1);
    expect(existsSync(PUBLISHED_TEAMS_FILE)).toBe(true);
    const disk = JSON.parse(readFileSync(PUBLISHED_TEAMS_FILE, "utf8")) as { teams: Record<string, PublishedTeam> };
    expect(disk.teams[SEC_A]?.packageId).toBe("ops-pack");
    expect(disk.teams.Ops).toBeUndefined();
    expect(disk.teams.Sales?.packageId).toBe("sales-pack");
    expect(readPublishedTeam("Ops", SEC_A)?.packageId).toBe("ops-pack");
    expect(readPublishedTeam("Sales")?.packageId).toBe("sales-pack");
  });

  it("writePublishedTeam stores under the id and drops the name key", () => {
    writePublishedTeam("Ops", sample("first"), SEC_A);
    writePublishedTeam("Ops", sample("second"), SEC_A);
    expect(readPublishedTeam("Ops", SEC_A)?.packageId).toBe("second");
    const disk = JSON.parse(readFileSync(PUBLISHED_TEAMS_FILE, "utf8")) as { teams: Record<string, unknown> };
    expect(Object.keys(disk.teams)).toEqual([SEC_A]);
  });
});
