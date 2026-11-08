import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny hook runtime: state slots that survive "renders", effects that run
// when their dependencies change. Enough to drive one sidebar row.
const runtime = vi.hoisted(() => ({
  slots: [] as unknown[],
  deps: [] as Array<unknown[] | undefined>,
  index: 0,
  effect: 0,
}));

vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const i = runtime.index++;
    if (!(i in runtime.slots)) runtime.slots[i] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [runtime.slots[i], (next: unknown) => { runtime.slots[i] = typeof next === "function" ? (next as (v: unknown) => unknown)(runtime.slots[i]) : next; }];
  },
  useEffect: (run: () => void, deps?: unknown[]) => {
    const i = runtime.effect++;
    const previous = runtime.deps[i];
    if (!previous || !deps || deps.some((dep, at) => dep !== previous[at])) {
      runtime.deps[i] = deps;
      run();
    }
  },
}));

const saved = vi.hoisted(() => new Map<string, string>());
vi.stubGlobal("localStorage", {
  getItem: (key: string) => saved.get(key) ?? null,
  setItem: (key: string, value: string) => { saved.set(key, value); },
  removeItem: (key: string) => { saved.delete(key); },
});

const { forgetSearchDisclosuresForTests, reloadSearchDisclosuresForTests, searchMatchesThreads, useSearchDisclosure } = await import("./search-disclosure");

/** One row: render with a query, return [open, set]. Renders twice so an
 * effect's state change is visible, as React would show it. */
const row = (key: string, initial = false) => (query: string, matches: boolean) => {
  let result!: ReturnType<typeof useSearchDisclosure>;
  for (let pass = 0; pass < 2; pass++) {
    runtime.index = 0;
    runtime.effect = 0;
    result = useSearchDisclosure(key, query, matches, initial);
  }
  return result;
};

beforeEach(() => {
  runtime.slots = [];
  runtime.deps = [];
  forgetSearchDisclosuresForTests();
});

describe("sidebar search disclosure (ticket 293)", () => {
  it("opens only rows with a matching thread, and clearing puts every row back", () => {
    const writer = row("bot:writer");
    const [, open] = writer("", false);
    open(true); // the person opened Writer before searching
    expect(writer("", false)[0]).toBe(true);
    expect(writer("post", true)[0]).toBe(true);
    expect(writer("", false)[0]).toBe(true);

    runtime.slots = [];
    runtime.deps = [];
    const chief = row("bot:chief");
    expect(chief("", false)[0]).toBe(false);
    // listed by its role, with no matching thread: stays closed
    expect(chief("post", false)[0]).toBe(false);
    expect(chief("", false)[0]).toBe(false);

    runtime.slots = [];
    runtime.deps = [];
    const brand = row("bot:brand");
    expect(brand("", false)[0]).toBe(false);
    expect(brand("post", true)[0]).toBe(true);
    // clearing used to leave it open with every thread showing
    expect(brand("", false)[0]).toBe(false);
  });

  it("keeps a row's own state across the remount a search causes", () => {
    const first = row("bot:cosmo");
    first("", false)[1](true);
    // Cosmo does not match, leaves the list, and comes back as a new row
    runtime.slots = [];
    runtime.deps = [];
    expect(row("bot:cosmo")("", false)[0]).toBe(true);
  });

  it("lets the person toggle a row during a search until the query changes", () => {
    const scout = row("bot:scout");
    scout("", false);
    scout("post", true)[1](false);
    expect(scout("post", true)[0]).toBe(false);
    expect(scout("posts", true)[0]).toBe(true);
    expect(scout("", false)[0]).toBe(false);
  });

  it("restores a selected room's explicit closed choice after search remounts it", () => {
    const room = row("group:engineering", true);
    expect(room("", false)[0]).toBe(true);
    room("", false)[1](false);
    runtime.slots = [];
    runtime.deps = [];
    expect(row("group:engineering", true)("", false)[0]).toBe(false);
  });

  it("matches thread titles and folders, not routine runs", () => {
    const tasks = [{ title: "LinkedIn post: launch story" }, { title: "post run", routineRunId: "r1" }];
    expect(searchMatchesThreads("POST", tasks)).toBe(true);
    expect(searchMatchesThreads("post run", tasks)).toBe(false);
    expect(searchMatchesThreads("launch", [], [{ name: "Launch week" }])).toBe(true);
    expect(searchMatchesThreads("  ", tasks)).toBe(false);
  });
});

// Conversation threads > In the sidebar: a bot folded open or shut stays so
// across a reload, a list refresh (the row remounts) and another bot's
// selection (no auto-open writes over the choice).
describe("a bot's fold in the sidebar mode", () => {
  it("survives a remount and a reload, per bot", () => {
    const atlas = row("bot:atlas", true);
    const [, set] = atlas("", false);
    set(false);
    expect(atlas("", false)[0]).toBe(false);
    // the list refreshed: the row mounts again
    runtime.slots = []; runtime.deps = [];
    expect(row("bot:atlas", true)("", false)[0]).toBe(false);
    // the app reloaded: the choice comes back from this device
    reloadSearchDisclosuresForTests();
    runtime.slots = []; runtime.deps = [];
    expect(row("bot:atlas", true)("", false)[0]).toBe(false);
    // another bot keeps its own (open by default)
    runtime.slots = []; runtime.deps = [];
    expect(row("bot:iris", true)("", false)[0]).toBe(true);
  });
});
