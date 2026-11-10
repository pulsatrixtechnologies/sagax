// "Run now" (owner, 2026-10-08): the bot's owner, the person the routine runs
// as and an admin see it; disabled while a run is in flight; it starts the
// run through the store's runRoutine and shows it at once.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot } from "@/state/store";
import type { Routine, RoutineRun } from "@/lib/routines";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { state: undefined as AppState | undefined, dispatch: vi.fn() };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: fixture.state ?? original.initialState, dispatch: fixture.dispatch }) };
});

const { initialState } = await import("@/state/store");
const { RunNowButton, canRunRoutineNow, routineRunInFlight } = await import("./RunNowButton");

const bot = { id: "bot-1", ownerUserId: "pr_owner" } as Bot;
const routine = { id: "r1", name: "Dispatch", botId: "bot-1", runAs: { principalId: "pr_bob", name: "Bob" } } as unknown as Routine;
const viewer = (principalId: string | null, role: "owner" | "admin" | "member" | null = "member") =>
  ({ viewer: { operator: false, principalId, email: "", name: "", role, canCreateBots: true } }) as unknown as AppState["config"];
const run = (status: RoutineRun["status"]) => ({ id: `run-${status}`, routineId: "r1", status }) as RoutineRun;
const render = () => renderToStaticMarkup(createElement(RunNowButton, { routine, bot, className: "ui" }));

beforeEach(() => {
  fixture.dispatch.mockClear();
  fixture.state = { ...initialState, config: viewer("pr_owner"), routineRuns: [] };
});
afterAll(() => vi.unstubAllGlobals());

describe("who sees Run now", () => {
  it("the bot's owner, the person it runs as, an admin, and a solo server", () => {
    expect(canRunRoutineNow(viewer("pr_owner"), routine, bot)).toBe(true);
    expect(canRunRoutineNow(viewer("pr_bob"), routine, bot)).toBe(true);
    expect(canRunRoutineNow(viewer("pr_alice", "admin"), routine, bot)).toBe(true);
    expect(canRunRoutineNow(viewer(null, null), routine, bot)).toBe(true);
    expect(canRunRoutineNow(null, routine, bot)).toBe(true);
  });

  it("the server's canRun wins when the listing sent it (a routine seen through a wider scope)", () => {
    expect(canRunRoutineNow(viewer("pr_owner"), { ...routine, canRun: false }, bot)).toBe(false);
    expect(canRunRoutineNow(viewer("pr_carol"), { ...routine, canRun: true }, bot)).toBe(true);
  });

  it("nobody else: the button is not rendered", () => {
    expect(canRunRoutineNow(viewer("pr_carol"), routine, bot)).toBe(false);
    fixture.state = { ...fixture.state!, config: viewer("pr_carol") };
    expect(render()).toBe("");
  });
});

describe("the Run now button", () => {
  it("is enabled when no run is in flight", () => {
    const markup = render();
    expect(markup).toContain("data-run-now");
    expect(markup).toContain("<span>Run now</span>");
    // Icon-only in a narrow action bar: the name and tooltip stay.
    expect(markup).toContain('aria-label="Run now" title="Run now"');
    expect(markup).not.toContain("disabled");
  });

  it("is hidden while a run of the routine is queued, running or waiting, never greyed (#3294)", () => {
    for (const status of ["queued", "running", "waiting"] as const) {
      fixture.state = { ...fixture.state!, routineRuns: [run(status)] };
      expect(render()).toBe("");
    }
    expect(routineRunInFlight([run("completed"), run("failed")], "r1")).toBe(false);
    expect(routineRunInFlight([{ ...run("running"), routineId: "other" }], "r1")).toBe(false);
  });
});
