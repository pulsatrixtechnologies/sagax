// #4460: whose team memory a bot reads and writes, and the move of entries a
// shared key held to their author's own memory.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TeamMemory } from "./team-memory.ts";
import { personMemoryKey, teamMemoryScope, teamMemoryWording, UNCLAIMED_MEMORY_KEY } from "./team-memory-scope.ts";
import { availableTools, catalogProfileFromEnv } from "../drivers/agents-catalog.ts";
import { removeTempDir } from "../testing/cleanup.ts";

let dir: string;
let memory: TeamMemory;
const at = 1_757_000_000_000;
const from = (botId: string) => ({ botId, botName: "Scout", threadId: "t1", at });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omb-team-memory-scope-"));
  memory = new TeamMemory(join(dir, "team-memory.json"));
});

afterEach(async () => {
  await removeTempDir(dir);
});

/** A bot of this owner, in this section, on a solo or a shared server. */
const scopeOf = (personScoped: boolean, owner: string, section: string) => teamMemoryScope({
  personScoped,
  owner,
  section: () => ({ key: section, label: section || "General" }),
  person: () => ({ name: owner, teams: [] }),
});

describe("teamMemoryScope", () => {
  it("never gives two people the same key on a shared server: no section, or the same section name", () => {
    for (const section of ["", "Ops"]) {
      const alice = scopeOf(true, "alice", section);
      const bob = scopeOf(true, "bob", section);
      expect(alice.key).not.toBe(bob.key);
      expect(alice.key).toBe(personMemoryKey("alice"));
      expect(alice.person?.name).toBe("alice");
    }
    // one person's bots, whatever their section, share that person's memory
    expect(scopeOf(true, "alice", "Ops").key).toBe(scopeOf(true, "alice", "").key);
  });

  it("keeps a solo install's memory per section, as before", () => {
    expect(scopeOf(false, "alice", "Ops")).toEqual({ key: "Ops", label: "Ops" });
    expect(scopeOf(false, "alice", "")).toEqual({ key: "", label: "General" });
  });

  it("an entry one person confirmed never enters the other person's prompt", () => {
    for (const section of ["", "Ops"]) {
      const alice = scopeOf(true, "alice", section);
      const bob = scopeOf(true, "bob", section);
      const proposed = memory.propose(alice.key, { kind: "term", name: `Zephyr${section}`, detail: "Alice's scheduling bot" }, from("a1"));
      memory.resolve(alice.key, proposed.entry.id, "accept");
      expect(memory.systemPrompt(alice.key, alice.label, alice.person)).toContain(`Zephyr${section}`);
      expect(memory.systemPrompt(bob.key, bob.label, bob.person)).toBe("");
      expect(memory.list(bob.key)).toEqual([]);
    }
  });
});

describe("systemPrompt source", () => {
  it("names whose memory it is and the person's organization teams", () => {
    const key = personMemoryKey("alice");
    memory.resolve(key, memory.propose(key, { kind: "term", name: "Corvid", detail: "the reporting bot" }, from("a1")).entry.id, "accept");
    const block = memory.systemPrompt(key, "Alice", { name: "Alice", teams: ["Field"] });
    expect(block).toContain("Your own memory, \"Alice\"'s");
    expect(block).toContain("no bot of another person does");
    expect(block).toContain("(\"Alice\"'s teams: \"Field\")");
    expect(memory.systemPrompt(key, "Alice", { name: "Alice", teams: [] })).toContain("\"Alice\" is in no team of the organization");
  });

  it("says that whoever the person lets use one of their bots reads it there, never that nobody else knows it", () => {
    const key = personMemoryKey("alice");
    memory.resolve(key, memory.propose(key, { kind: "term", name: "Corvid", detail: "the reporting bot" }, from("a1")).entry.id, "accept");
    const block = memory.systemPrompt(key, "Alice", { name: "Alice", teams: [] });
    expect(block).toContain("Someone \"Alice\" lets use one of \"Alice\"'s bots reads it too, in that conversation.");
    expect(block).not.toContain("nobody else knows");
  });

  it("says a workspace with no console keeps no memory between people", () => {
    const key = personMemoryKey("alice");
    memory.resolve(key, memory.propose(key, { kind: "term", name: "Corvid", detail: "the reporting bot" }, from("a1")).entry.id, "accept");
    const block = memory.systemPrompt(key, "Alice", { name: "Alice", teams: [], console: false });
    expect(block).toContain("This server keeps no memory shared between people.");
    expect(block).not.toContain("organization console");
  });

  it("names the shared memory a moved entry came from", () => {
    memory.propose("", { kind: "term", name: "Corvid", detail: "the reporting bot" }, from("bot-alice"));
    memory.resolve("", memory.list("")[0]!.id, "accept");
    memory.scopeToPeople(() => "alice", () => "General");
    const block = memory.systemPrompt(personMemoryKey("alice"), "Alice", { name: "Alice", teams: [] });
    expect(block).toContain("- Corvid [moved from the former shared \"General\" memory]: the reporting bot");
  });

  it("keeps the solo header unchanged", () => {
    memory.resolve("Ops", memory.propose("Ops", { kind: "term", name: "Corvid", detail: "the reporting bot" }, from("a1")).entry.id, "accept");
    expect(memory.systemPrompt("Ops")).toContain("Team memory for the \"Ops\" section: people, places, decisions and terms every bot on the team shares.");
  });
});

describe("scopeToPeople", () => {
  it("moves each shared entry to its author's own memory, keeps an unknown author's aside, deletes nothing", () => {
    memory.propose("", { kind: "term", name: "Corvid", detail: "Alice's" }, from("bot-alice"));
    memory.propose("", { kind: "term", name: "Orphan", detail: "nobody's" }, from(""));
    memory.propose("Ops", { kind: "term", name: "Pelican", detail: "Bob's" }, from("bot-bob"));
    const owners: Record<string, string> = { "bot-alice": "alice", "bot-bob": "bob" };
    expect(memory.hasSharedKeys()).toBe(true);
    const result = memory.scopeToPeople((_key, entry) => owners[entry.source.botId] ?? null, (key) => key || "General");
    expect(result.unclaimed).toBe(1);
    expect(result.moved.map((row) => [row.person, row.entry.name, row.entry.movedFrom])).toEqual([["alice", "Corvid", "General"], ["bob", "Pelican", "Ops"]]);
    expect(memory.hasSharedKeys()).toBe(false);
    expect(memory.list(personMemoryKey("alice")).map((entry) => entry.name)).toEqual(["Corvid"]);
    expect(memory.list(personMemoryKey("bob")).map((entry) => entry.name)).toEqual(["Pelican"]);
    expect(memory.list(UNCLAIMED_MEMORY_KEY).map((entry) => entry.name)).toEqual(["Orphan"]);
    expect(memory.list("")).toEqual([]);
    expect(memory.list("Ops")).toEqual([]);
    // on disk too, and a second run moves nothing
    const reopened = new TeamMemory(join(dir, "team-memory.json"));
    expect(reopened.list(personMemoryKey("bob"))[0]!.movedFrom).toBe("Ops");
    expect(reopened.scopeToPeople(() => "alice", () => "x")).toEqual({ moved: [], unclaimed: 0 });
    for (const name of ["Corvid", "Pelican", "Orphan"]) expect(readFileSync(join(dir, "team-memory.json"), "utf8")).toContain(name);
  });

  it("keeps one copy when the author already holds the same fact", () => {
    const own = personMemoryKey("alice");
    memory.propose(own, { kind: "term", name: "Corvid", detail: "same" }, from("bot-alice"));
    memory.propose("", { kind: "term", name: "Corvid", detail: "same" }, from("bot-alice"));
    memory.propose("", { kind: "term", name: "Corvid", detail: "different" }, from("bot-alice"));
    memory.scopeToPeople(() => "alice", () => "General");
    expect(memory.list(own).map((entry) => entry.detail)).toEqual(["same", "different"]);
  });
});

describe("#4460 what the bot, its tool and the person are told", () => {
  const shared = /team|shared prompts|organization admin|section-wide|ask an admin/i;
  it("on a server several people use, every text says it is the owner's own memory, never a team's", () => {
    const own = teamMemoryWording(true);
    for (const text of [own.prompt, own.toolDescription, own.cardTitle, own.ruleDescription("term"), own.restrictedRefusal, own.resultTarget]) {
      expect(text).toMatch(/own memory/);
    }
    for (const text of [own.prompt, own.toolDescription]) {
      expect(text).toMatch(/only that person's bots read it/);
      expect(text).toMatch(/shared with a team is kept only in an organization console, never here/);
      expect(text).not.toMatch(/shared prompts|organization admin|every bot on the team/);
    }
    for (const text of [own.cardTitle, own.ruleDescription("term"), own.restrictedRefusal, own.resultTarget]) expect(text).not.toMatch(shared);
  });

  it("a solo install keeps its card words, for a card left from before #4439", () => {
    const solo = teamMemoryWording(false);
    expect(solo.cardTitle).toBe("Remember this for the team?");
    expect(solo.ruleDescription("term")).toBe("Remember term entries for the team");
  });

  // #4439: the bot saves it itself, at once, and says so; nothing waits
  it("tells the bot to save at once and say so, never to propose or wait for a confirmation", () => {
    for (const wording of [teamMemoryWording(false), teamMemoryWording(true)]) {
      for (const text of [wording.prompt, wording.toolDescription]) {
        expect(text).not.toMatch(/propos|confirm|wait|card/i);
      }
      expect(wording.prompt).toContain("save_team_memory");
      expect(wording.prompt).toMatch(/short line/);
    }
  });

  it("the tool's description follows the server's mode", () => {
    const describe = (env: Record<string, string>) => availableTools(catalogProfileFromEnv(env)).find((tool) => tool.name === "save_team_memory")?.description ?? "";
    expect(describe({ SAGAX_ROOM_TURN: "1" })).toBe(teamMemoryWording(false).toolDescription);
    expect(describe({ SAGAX_ROOM_TURN: "1", SAGAX_OWN_TEAM_MEMORY: "1" })).toBe(teamMemoryWording(true).toolDescription);
  });
});
