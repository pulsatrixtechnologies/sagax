import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

describe("runGroupMemberTurn leaf modules (#1388 w4 step 3)", () => {
  it("exposes createRunGroupMemberTurn and does not import server/index.ts", () => {
    const src = readFileSync(join(here, "group-member-turn.ts"), "utf8");
    expect(src).toMatch(/export function createRunGroupMemberTurn/);
    expect(src).not.toMatch(/from ["'].*\/index\.ts["']/);
    expect(src).not.toMatch(/from ["']\.\.\/index["']/);
  });

  it("keeps prepare/launch/stream/finish phase modules under server/turns/", () => {
    for (const name of [
      "group-member-turn-prepare.ts",
      "group-member-turn-launch.ts",
      "group-member-turn-stream.ts",
      "group-member-turn-finish.ts",
    ]) {
      const path = join(here, name);
      expect(existsSync(path), name).toBe(true);
      const src = readFileSync(path, "utf8");
      expect(src.length).toBeGreaterThan(50);
      expect(src).not.toMatch(/from ["'].*\/index\.ts["']/);
      expect(src).not.toMatch(/from ["']\.\.\/index["']/);
    }
  });

  it("wires runGroupMemberTurn through createRunGroupMemberTurn in index", () => {
    const index = readFileSync(join(here, "../index.ts"), "utf8");
    expect(index).toMatch(/import \{ createRunGroupMemberTurn \} from "\.\/turns\/group-member-turn\.ts"/);
    expect(index).toMatch(/const runGroupMemberTurnRunner = createRunGroupMemberTurn\(/);
    expect(index).toMatch(/async function runGroupMemberTurn\(/);
  });
});
