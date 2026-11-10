// The Automations page scope (2026-10-09): the scope control renders Mine,
// My teams and Everyone, leaves out what the profile lacks (#3294: hidden,
// never greyed), shows Team/Status in advanced mode, Owner under Mine in
// every mode (#1676), and the choice is remembered per person.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const memory = vi.hoisted(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  });
  return data;
});

const { RoutineScopeBar, RoutineOwnerBadge } = await import("./RoutineScopeBar");
const { readRoutineScopePrefs, writeRoutineScopePrefs, cleanRoutineScopePrefs, resetRoutineScopePrefsForTests, ROUTINE_SCOPE_PREF_KEY } = await import("@/lib/routine-scope-prefs");
const { routineScopesAllowed, routineScopeAvailable, effectiveRoutineScope, routineMatchesStatus } = await import("@/lib/use-routine-scope");
const { USER_PREFERENCE_KEYS } = await import("../../../shared/user-preferences");
const { RoutineList } = await import("./RoutineList");

type Props = Parameters<typeof RoutineScopeBar>[0];
const render = (props: Partial<Props> = {}) => renderToStaticMarkup(createElement(RoutineScopeBar, {
  prefs: { scope: "mine" },
  allowed: { mine: true, team: false, all: false },
  teams: [{ id: "T", name: "Team T" }],
  owners: [{ id: "pr_bob", name: "Bob" }],
  advanced: true,
  viewerPrincipalId: "pr_me",
  onChange: () => {},
  ...props,
}));
const button = (markup: string, scope: string) => markup.match(new RegExp(`<button[^>]*data-routine-scope="${scope}"[^>]*>`))?.[0] ?? "";
const viewer = (role: string, permissions?: string[]) => ({ viewer: { principalId: "pr_me", role, profileManagedBy: "perspicax", operator: false, ...(permissions ? { permissions } : {}) } }) as never;

beforeEach(() => { memory.clear(); resetRoutineScopePrefsForTests(); });
afterAll(() => vi.unstubAllGlobals());

describe("the scope control", () => {
  it("renders the three scopes, Mine checked", () => {
    const markup = render({ allowed: { mine: true, team: true, all: true } });
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain(">Mine</button>");
    expect(markup).toContain(">My teams</button>");
    expect(markup).toContain(">Everyone</button>");
    expect(button(markup, "mine")).toContain('aria-checked="true"');
  });

  it("leaves out a scope the profile lacks, never greyed; Mine alone hides the control (#3294)", () => {
    const markup = render();
    expect(markup).not.toContain('role="radiogroup"');
    expect(markup).not.toContain('disabled=""');
    expect(markup).not.toContain("See their teams&#x27; routines");
    const team = render({ allowed: { mine: true, team: true, all: false } });
    expect(button(team, "mine")).not.toBe("");
    expect(button(team, "team")).not.toBe("");
    expect(button(team, "all")).toBe("");
    expect(team).not.toContain('disabled=""');
  });

  it("enables what is allowed; a saved scope the person lost falls back to Mine", () => {
    const markup = render({ prefs: { scope: "all" }, allowed: { mine: true, team: true, all: true } });
    expect(button(markup, "all")).toContain('aria-checked="true"');
    expect(button(markup, "team")).not.toContain('disabled=""');
    const lost = render({ prefs: { scope: "all" }, allowed: { mine: true, team: true, all: false } });
    expect(button(lost, "mine")).toContain('aria-checked="true"');
  });

  it("shows Team and Owner in a wider scope, Status in advanced, Owner under Mine too", () => {
    const wide = render({ prefs: { scope: "team" }, allowed: { mine: true, team: true, all: false } });
    expect(wide).toContain('data-routine-filter="team"');
    expect(wide).toContain('data-routine-filter="owner"');
    expect(wide).toContain('data-routine-filter="status"');
    expect(wide).toContain(">Team T</option>");
    const mine = render();
    expect(mine).not.toContain('data-routine-filter="team"');
    expect(mine).toContain('data-routine-filter="owner"');
    expect(mine).toContain('data-routine-filter="status"');
    expect(mine).toContain(">Me</option>");
    expect(mine).toContain('value="pr_me"');
    expect(mine).toContain(">Bob</option>");
    const simpleMine = render({ advanced: false });
    expect(simpleMine).toContain('data-routine-filter="owner"');
    expect(simpleMine).toContain(">Me</option>");
    expect(simpleMine).not.toContain('data-routine-filter="status"');
    const simpleWide = render({ prefs: { scope: "team", status: "failing" }, allowed: { mine: true, team: true, all: false }, advanced: false });
    expect(simpleWide).toContain('role="radiogroup"');
    expect(simpleWide).not.toContain("data-routine-filter");
  });

  it("offers Clear filters once a filter is set", () => {
    expect(render()).not.toContain("data-routine-filter-reset");
    expect(render({ prefs: { scope: "mine", status: "paused" } })).toContain("data-routine-filter-reset");
    expect(render({ prefs: { scope: "mine", ownerId: "pr_me" }, advanced: false })).toContain("data-routine-filter-reset");
  });

  it("the owner badge shows the avatar, or the initials, and the name", () => {
    expect(renderToStaticMarkup(createElement(RoutineOwnerBadge, { owner: { id: "pr_bob", name: "Bob Tremblay" } }))).toContain(">BT</span>");
    expect(renderToStaticMarkup(createElement(RoutineOwnerBadge, { owner: { id: "pr_bob", name: "Bob", avatarUrl: "/api/people/pr_bob/avatar?v=1" } }))).toContain('src="/api/people/pr_bob/avatar?v=1"');
  });
});

describe("permission gating from the viewer", () => {
  it("a member holds Mine only; viewTeam opens My teams; viewAll both; an admin both; a solo server has no control", () => {
    expect(routineScopesAllowed(viewer("member", []))).toEqual({ mine: true, team: false, all: false });
    expect(routineScopesAllowed(viewer("member", ["routines.viewTeam"]))).toEqual({ mine: true, team: true, all: false });
    expect(routineScopesAllowed(viewer("member", ["routines.viewAll"]))).toEqual({ mine: true, team: true, all: true });
    expect(routineScopesAllowed(viewer("admin"))).toEqual({ mine: true, team: true, all: true });
    expect(routineScopeAvailable(viewer("member", []))).toBe(true);
    expect(routineScopeAvailable({ viewer: { principalId: null, operator: true } } as never)).toBe(false);
    expect(effectiveRoutineScope({ scope: "team" }, { mine: true, team: false, all: false })).toBe("mine");
  });

  it("status filter: active, paused (or paused by the server), failing", () => {
    const routine = (extra: object) => ({ enabled: true, ...extra }) as never;
    expect(routineMatchesStatus(routine({}), "active")).toBe(true);
    expect(routineMatchesStatus(routine({ enabled: false }), "paused")).toBe(true);
    expect(routineMatchesStatus(routine({ suspended: { reason: "no_right", at: 1 } }), "paused")).toBe(true);
    expect(routineMatchesStatus(routine({ failureStreak: 1 }), "failing")).toBe(true);
    expect(routineMatchesStatus(routine({}), "failing")).toBe(false);
    expect(routineMatchesStatus(routine({}), undefined)).toBe(true);
  });
});

describe("the remembered choice", () => {
  it("is kept per person, follows the person (a user preference), and survives a reload", () => {
    expect(USER_PREFERENCE_KEYS).toContain(ROUTINE_SCOPE_PREF_KEY);
    expect(readRoutineScopePrefs("pr_me")).toEqual({ scope: "mine" });
    writeRoutineScopePrefs("pr_me", { scope: "team", teamId: "T", status: "failing" });
    writeRoutineScopePrefs("pr_other", { scope: "all" });
    resetRoutineScopePrefsForTests();
    expect(readRoutineScopePrefs("pr_me")).toEqual({ scope: "team", teamId: "T", status: "failing" });
    expect(readRoutineScopePrefs("PR_OTHER")).toEqual({ scope: "all" });
  });

  it("drops what it does not understand, and keeps the session's choice when storage refuses", () => {
    expect(cleanRoutineScopePrefs({ scope: "everyone", teamId: "a b", status: "broken", botId: "bot-1" })).toEqual({ scope: "mine", botId: "bot-1" });
    memory.set(ROUTINE_SCOPE_PREF_KEY, "{not json");
    expect(readRoutineScopePrefs("pr_me")).toEqual({ scope: "mine" });
    const original = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = () => { throw new Error("quota"); };
    try {
      writeRoutineScopePrefs("pr_me", { scope: "all" });
      expect(readRoutineScopePrefs("pr_me")).toEqual({ scope: "all" });
    } finally {
      globalThis.localStorage.setItem = original;
    }
  });
});

describe("someone else's routine in the list", () => {
  const base = { id: "r1", name: "Night digest", botId: "bot-1", enabled: true, schedule: { type: "interval", everyMinutes: 60, anchorAt: 0 }, nextRunAt: null };
  const switchTag = (markup: string) => markup.match(/<button[^>]*role="switch"[^>]*>/)?.[0] ?? "";
  const list = (routine: object) => renderToStaticMarkup(createElement(RoutineList, { routines: [routine as never], runs: [], viewerPrincipalId: "pr_me", onOpen: () => {} }));

  it("shows the owner's name and avatar, and a read-only switch", () => {
    const markup = list({ ...base, owner: { id: "pr_bob", name: "Bob" }, canEdit: false, canRun: false, redacted: true });
    expect(markup).toContain('data-routine-owner="pr_bob"');
    expect(markup).toContain(">Bob</span>");
    expect(switchTag(markup)).toContain('disabled=""');
  });

  it("an own routine: no owner badge, the switch stays", () => {
    const markup = list({ ...base, owner: { id: "PR_ME", name: "Me" }, canEdit: true });
    expect(markup).not.toContain("data-routine-owner");
    expect(switchTag(markup)).not.toContain('disabled=""');
  });

  it("an own routine that runs as its owner: neither chip", () => {
    const markup = list({ ...base, owner: { id: "pr_me", name: "Alex Martin" }, runAs: { principalId: "pr_me", name: "Alex Martin" } });
    expect(markup).not.toContain("data-routine-owner");
    expect(markup).not.toContain("data-routine-run-as");
    expect(markup).not.toContain("Runs as");
  });

  it("someone else's routine that runs as its owner: owner chip once, no Runs as", () => {
    const markup = list({ ...base, owner: { id: "pr_bob", name: "Bob" }, runAs: { principalId: "pr_bob", name: "Bob" }, canEdit: false });
    expect(markup).toContain('data-routine-owner="pr_bob"');
    expect(markup).toContain(">Bob</span>");
    expect(markup).not.toContain("data-routine-run-as");
    expect(markup).not.toContain("Runs as");
  });

  it("someone else's routine that runs as a third person: owner chip, no Runs as in the row (2026-10-28)", () => {
    const markup = list({ ...base, owner: { id: "pr_bob", name: "Bob" }, runAs: { principalId: "pr_ada", name: "Ada" } });
    expect(markup).toContain('data-routine-owner="pr_bob"');
    expect(markup).not.toContain("data-routine-run-as");
    expect(markup).not.toContain("Runs as");
  });
});
