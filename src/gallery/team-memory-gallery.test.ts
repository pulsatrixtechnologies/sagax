import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// #4439: a bot saves team memory itself. The gallery pages show what a person
// sees now: entries a bot saved, already kept; a "Remember this?" card only as
// one an earlier version left waiting in a conversation.
const source = (name: string) => readFileSync(join(__dirname, name), "utf8");

describe("team memory in the gallery (#4439)", () => {
  it("shows the entries a bot saved as kept, never waiting for the person", () => {
    for (const page of ["memory-manager.tsx", "lot6-ux.tsx"]) {
      const src = source(page);
      const teamRows = src.split("\n").filter((line) => /kind: "(person|place|decision|term)"/.test(line) && line.includes("botName"));
      expect(teamRows.length, page).toBeGreaterThan(0);
      for (const line of teamRows) expect(line, page).toContain('status: "accepted"');
    }
  });

  it("labels the team memory card rows as cards left from before, not the normal path", () => {
    const src = source("question-cards.tsx");
    for (const id of ["ask-409-allow", "ask-409-gone"]) {
      const row = src.split("\n").find((line) => line.includes(`id="${id}"`)) ?? "";
      expect(row, id).toMatch(/version précédente/);
    }
  });
});
