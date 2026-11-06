import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RemoteHostTeams } from "./remote-host-teams.ts";

const A = `h_${"ab".repeat(16)}`;
const B = `h_${"cd".repeat(16)}`;
const SEC = "sec_12345678-1234-1234-1234-123456789abc";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const file = () => { const dir = mkdtempSync(join(tmpdir(), "host-teams-")); dirs.push(dir); return join(dir, "remote-host-teams.json"); };
const key = (section?: string) => section ?? "";

describe("RemoteHostTeams", () => {
  it("places a host per person, persists it and takes it off", () => {
    const path = file();
    const teams = new RemoteHostTeams(path, () => 1);
    teams.assign("Tech@Example.org", A, "Support", SEC);
    teams.assign("other@example.org", B, "Support");
    const again = new RemoteHostTeams(path);
    expect([...again.forPrincipal("tech@example.org").keys()]).toEqual([A]);
    expect(again.forPrincipal("tech@example.org").get(A)).toMatchObject({ section: "Support", sectionId: SEC });
    again.assign("tech@example.org", A, null);
    expect(new RemoteHostTeams(path).forPrincipal("tech@example.org").size).toBe(0);
  });

  it("gives a bot only its owner's hosts on its team, by id first", () => {
    const teams = new RemoteHostTeams(file());
    teams.assign("tech@example.org", A, "Support", SEC);
    teams.assign("tech@example.org", B, "Ventes");
    teams.assign("other@example.org", B, "Support");
    expect(teams.forBot({ section: "Renamed", sectionId: SEC }, "tech@example.org", key)).toEqual([A]);
    expect(teams.forBot({ section: "Ventes" }, "tech@example.org", key)).toEqual([B]);
    expect(teams.forBot({ section: "Support" }, "nobody@example.org", key)).toEqual([]);
  });

  it("follows a team rename and reads a damaged file as empty", () => {
    const teams = new RemoteHostTeams(file());
    teams.assign("tech@example.org", B, "Ventes");
    teams.renameSection("Ventes", "Sales");
    expect(teams.forPrincipal("tech@example.org").get(B)?.section).toBe("Sales");
    const bad = file();
    writeFileSync(bad, "{not json");
    expect(new RemoteHostTeams(bad).forPrincipal("tech@example.org").size).toBe(0);
  });
});
