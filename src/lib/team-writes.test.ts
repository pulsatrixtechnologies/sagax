import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock("@/state/store", () => ({ api }));

import { PERSONAL_SECTIONS_KEY, parsePersonalSections, readPersonalSections, writePersonalSections, EMPTY_PERSONAL_SECTIONS } from "./personal-sections";
import { SECTION_PARENTS_KEY, parentOf, readSectionParents, writeSectionParents, EMPTY_SECTION_PARENTS } from "./section-tree";
import { createTeam, deleteTeam, moveBotToTeam, setTeamParent, teamNames, type TeamWriteContext } from "./team-writes";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear() { map.clear(); },
    getItem(key: string) { return map.get(key) ?? null; },
    setItem(key: string, value: string) { map.set(key, value); },
    removeItem(key: string) { map.delete(key); },
    key(index: number) { return [...map.keys()][index] ?? null; },
  };
}

function context(over: Partial<TeamWriteContext> = {}): TeamWriteContext {
  return {
    orgMode: true,
    dispatch: vi.fn(),
    viewerId: "pr_bob",
    bots: [
      { id: "b1", name: "Boris", ownerUserId: "pr_bob" } as TeamWriteContext["bots"][number],
      { id: "a1", name: "Aria", ownerUserId: "pr_alice", section: "Equipe A" } as TeamWriteContext["bots"][number],
    ],
    serverSections: [],
    ...over,
  };
}

beforeEach(() => {
  api.mockReset();
  api.mockImplementation(async () => ({ sections: [], bots: [] }));
  vi.stubGlobal("localStorage", memoryStorage());
  writePersonalSections(EMPTY_PERSONAL_SECTIONS);
  writeSectionParents(EMPTY_SECTION_PARENTS);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("team writes: two people (#2045)", () => {
  it("creates a team with the viewer's bots only; a shared bot never echoes to the server", async () => {
    const ctx = context();
    expect(await createTeam(ctx, "Equipe B", ["b1", "a1"])).toBeNull();
    expect(teamNames(ctx).has("Equipe B")).toBe(true);
    expect(parsePersonalSections(localStorage.getItem(PERSONAL_SECTIONS_KEY))?.sections).toEqual([
      { name: "Equipe B", items: ["bot:b1", "bot:a1"] },
    ]);
    // Personal folder may hold the shared bot for layout; the server echo
    // files only the viewer's own bot.
    expect(api).toHaveBeenCalledWith("/api/sidebar-sections", {
      method: "POST",
      body: JSON.stringify({ name: "Equipe B", botIds: ["b1"] }),
    });
  });

  it("keeps each person's teams in their own preference store", async () => {
    const bobStore = memoryStorage();
    vi.stubGlobal("localStorage", bobStore);
    writePersonalSections(EMPTY_PERSONAL_SECTIONS);
    await createTeam(context({ viewerId: "pr_bob" }), "Equipe B", ["b1"]);
    const bobTeams = parsePersonalSections(bobStore.getItem(PERSONAL_SECTIONS_KEY))!;

    const aliceStore = memoryStorage();
    vi.stubGlobal("localStorage", aliceStore);
    writePersonalSections(EMPTY_PERSONAL_SECTIONS);
    writeSectionParents(EMPTY_SECTION_PARENTS);
    await createTeam(context({
      viewerId: "pr_alice",
      bots: [
        { id: "a1", name: "Aria", ownerUserId: "pr_alice" } as TeamWriteContext["bots"][number],
        { id: "b1", name: "Boris", ownerUserId: "pr_bob" } as TeamWriteContext["bots"][number],
      ],
    }), "Equipe A", ["a1"]);
    const aliceTeams = parsePersonalSections(aliceStore.getItem(PERSONAL_SECTIONS_KEY))!;

    expect(bobTeams.sections.map((section) => section.name)).toEqual(["Equipe B"]);
    expect(aliceTeams.sections.map((section) => section.name)).toEqual(["Equipe A"]);
    expect(bobTeams.sections.some((section) => section.name === "Equipe A")).toBe(false);
    expect(aliceTeams.sections.some((section) => section.name === "Equipe B")).toBe(false);
  });
});

describe("team writes: sub-teams (#2045)", () => {
  it("creates, moves and detaches a sub-team while keeping sidebar names", async () => {
    const ctx = context();
    expect(await createTeam(ctx, "Ops", ["b1"])).toBeNull();
    expect(await createTeam(ctx, "Support", [], "Ops")).toBeNull();
    expect(parentOf(readSectionParents(), "Support", teamNames(ctx))).toBe("Ops");

    expect(setTeamParent(ctx, "Support", "Sales")).toBeTruthy(); // Sales missing
    expect(await createTeam(ctx, "Sales", [])).toBeNull();
    expect(setTeamParent(ctx, "Support", "Sales")).toBeNull();
    expect(parentOf(readSectionParents(), "Support", teamNames(ctx))).toBe("Sales");

    expect(setTeamParent(ctx, "Support", "")).toBeNull();
    expect(parentOf(readSectionParents(), "Support", teamNames(ctx))).toBeUndefined();
    expect(JSON.parse(localStorage.getItem(SECTION_PARENTS_KEY)!).parents).toEqual({});
  });

  it("delete hands sub-teams to the parent and drops the team from personal folders", async () => {
    const ctx = context();
    await createTeam(ctx, "Ops", ["b1"]);
    await createTeam(ctx, "Support", [], "Ops");
    await deleteTeam(ctx, "Ops");
    expect(readPersonalSections()?.sections.map((section) => section.name)).toEqual(["Support"]);
    expect(parentOf(readSectionParents(), "Support", teamNames(ctx))).toBeUndefined();
  });
});

describe("team writes: move bot (#2045)", () => {
  it("moves an own bot and refuses to echo another person's bot", async () => {
    const ctx = context();
    await createTeam(ctx, "Equipe B", []);
    api.mockClear();
    expect(await moveBotToTeam(ctx, "b1", "Equipe B")).toBeNull();
    expect(api).toHaveBeenCalledWith("/api/sidebar-sections", {
      method: "POST",
      body: JSON.stringify({ name: "Equipe B", botIds: ["b1"] }),
    });
    api.mockClear();
    expect(await moveBotToTeam(ctx, "a1", "Equipe B")).toBeNull();
    expect(api).not.toHaveBeenCalled();
  });
});
