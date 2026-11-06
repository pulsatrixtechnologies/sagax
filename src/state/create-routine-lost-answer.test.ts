// @vitest-environment happy-dom
// #1753: createRoutine (/loop) recovers a create whose answer was lost.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, t } from "@/lib/i18n";
import type { Routine } from "@/lib/routines";
import type { Action, AppState } from "./store";

class FixtureEventSource {
  static opened: FixtureEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string; lastEventId?: string }) => void) | null = null;
  constructor(readonly url: string) { FixtureEventSource.opened.push(this); }
  close() {}
}

const json = (body: unknown, status = 200, statusText = "OK") =>
  new Response(status >= 400 && !Object.keys(body as object).length ? "" : JSON.stringify(body), {
    status,
    statusText,
    headers: { "content-type": "application/json" },
  });

const created: Routine = {
  id: "loop-1",
  name: "Loop 5m: check the board",
  prompt: "check the board",
  target: "bot",
  botId: "scout",
  runOn: "maus",
  enabled: true,
  schedule: { type: "interval", everyMinutes: 5, anchorAt: 1 },
  durationMinutes: 30,
  createdAt: 10,
  updatedAt: 10,
} as Routine;

const { StoreProvider, useStore } = await import("./store");

let state: AppState;
let dispatch: (action: Action) => void;
function Probe() {
  ({ state, dispatch } = useStore());
  return null;
}

let root: Root;
let container: HTMLDivElement;
let request: ReturnType<typeof vi.fn<typeof fetch>>;
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

beforeEach(async () => {
  setLocale("en");
  FixtureEventSource.opened = [];
  request = vi.fn<typeof fetch>(async (path) => {
    if (typeof path === "string" && path.startsWith("/api/bots?")) return json({ bots: [], groups: [] });
    if (typeof path === "string" && path.startsWith("/api/routines")) return json({ routines: [], runs: [] });
    if (path === "/api/webhooks") return json({ webhooks: [], attempts: [] });
    if (path === "/api/instances") return json({ instances: [] });
    return json({});
  });
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("fetch", request);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root.render(createElement(StoreProvider, null, createElement(Probe))));
  await settle();
});

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("createRoutine lost-answer recovery (#1753)", () => {
  it("keeps the routine and shows no raw 499 when the answer is lost", async () => {
    request.mockImplementation(async (path, init) => {
      if (path === "/api/routines" && init?.method === "POST") return json({}, 499, "Unknown Status Code");
      if (typeof path === "string" && path.startsWith("/api/routines")) return json({ routines: [created], runs: [] });
      if (typeof path === "string" && path.startsWith("/api/bots?")) return json({ bots: [], groups: [] });
      return json({});
    });
    flushSync(() => {
      dispatch({
        type: "createRoutine",
        input: {
          name: created.name,
          prompt: created.prompt,
          botId: created.botId,
          schedule: created.schedule,
          postResults: true,
          continuity: true,
        },
      });
    });
    await settle();
    expect(request.mock.calls.some(([path, init]) => path === "/api/routines" && init?.method === "POST")).toBe(true);
    expect(request.mock.calls.filter(([path, init]) => typeof path === "string" && path.startsWith("/api/routines") && (!init || !init.method || init.method === "GET")).length).toBeGreaterThan(0);
    expect(state.routines.some((routine) => routine.id === "loop-1")).toBe(true);
    expect(state.error).toBeNull();
  });

  it("shows the readable lost-answer line when the routine is not found", async () => {
    request.mockImplementation(async (path, init) => {
      if (path === "/api/routines" && init?.method === "POST") return json({}, 499, "Unknown Status Code");
      if (typeof path === "string" && path.startsWith("/api/routines")) return json({ routines: [], runs: [] });
      return json({});
    });
    flushSync(() => {
      dispatch({
        type: "createRoutine",
        input: {
          name: created.name,
          prompt: created.prompt,
          botId: created.botId,
          schedule: created.schedule,
        },
      });
    });
    await settle();
    expect(state.error).toBe(t("routineCalendar.saveAnswerLost"));
    expect(state.routines.some((routine) => routine.id === "loop-1")).toBe(false);
  });

  it("keeps a real server refusal as-is, without a recovery re-list", async () => {
    const postsBefore = request.mock.calls.filter(([path, init]) => path === "/api/routines" && init?.method === "POST").length;
    const getsBefore = request.mock.calls.filter(([path, init]) => typeof path === "string" && path.startsWith("/api/routines") && (!init || !init.method || init.method === "GET")).length;
    request.mockImplementation(async (path, init) => {
      if (path === "/api/routines" && init?.method === "POST") return json({ error: "Give the routine a name" }, 400);
      if (typeof path === "string" && path.startsWith("/api/routines")) return json({ routines: [], runs: [] });
      return json({});
    });
    flushSync(() => {
      dispatch({
        type: "createRoutine",
        input: {
          name: "",
          prompt: "x",
          botId: "scout",
          schedule: { type: "interval", everyMinutes: 5, anchorAt: 1 },
        },
      });
    });
    await settle();
    const postsAfter = request.mock.calls.filter(([path, init]) => path === "/api/routines" && init?.method === "POST").length;
    const getsAfter = request.mock.calls.filter(([path, init]) => typeof path === "string" && path.startsWith("/api/routines") && (!init || !init.method || init.method === "GET")).length;
    expect(postsAfter - postsBefore).toBe(1);
    expect(getsAfter - getsBefore).toBe(0);
    expect(state.error).toBe("Give the routine a name");
  });
});
