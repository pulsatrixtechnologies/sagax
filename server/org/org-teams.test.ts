// Slice 4: the Perspicax team names (server/org/org-teams.ts).
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { OrgTeams } from "./org-teams.ts";

const file = () => join(mkdtempSync(join(tmpdir(), "org-teams-")), "org-teams.json");

describe("OrgTeams", () => {
  it("replaces from the directory, merges claims, and saves 0600", () => {
    const path = file();
    const teams = new OrgTeams({ path });
    expect(teams.list()).toEqual([]);
    expect(teams.mergeFromClaims([{ id: "B", name: "Bravo" }])).toBe(true);
    expect(teams.replaceFromDirectory([{ id: "A", name: "Alpha" }, { id: "bad id", name: "x" }])).toBe(true);
    expect(teams.list()).toEqual([{ id: "A", name: "Alpha" }]);
    expect(teams.replaceFromDirectory([{ id: "A", name: "Alpha" }])).toBe(false);
    teams.mergeFromClaims([{ id: "C", name: "Charlie" }, { id: "A", name: "Alpha 2" }]);
    expect(teams.name("A")).toBe("Alpha 2");
    expect(teams.has("C")).toBe(true);
    expect(teams.name("Z")).toBeUndefined();
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ version: 1, teams: [{ id: "A", name: "Alpha 2" }, { id: "C", name: "Charlie" }] });
    expect(new OrgTeams({ path }).list()).toHaveLength(2);
  });

  it("starts empty on a file it cannot read", () => {
    const path = file();
    writeFileSync(path, "not json");
    expect(new OrgTeams({ path }).list()).toEqual([]);
    writeFileSync(path, JSON.stringify({ version: 2, teams: [] }));
    expect(new OrgTeams({ path }).list()).toEqual([]);
  });
});
