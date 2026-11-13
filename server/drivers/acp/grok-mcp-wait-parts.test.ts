// #3623: the latency line names the tool servers the engine's setup waited for.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { grokConfigureSessionForTest, grokMcpSettled } from "./grok.ts";
import { grokMcpWaitClock, grokMountLabel } from "./grok-mcp-wait-parts.ts";
import { rememberGrokMcpSettled, resetGrokCatalogs } from "./grok-tool-catalog.ts";
import { newTurnLatency, turnLatencyLine, type TurnToolWait } from "./turn-latency.ts";
import { clearTurnCounters, isToolListRequest, noteTurnServed, turnServedMount } from "../../turns/turn-trace.ts";

type Status = "pending" | "connecting" | "starting" | "initializing" | "ready" | "failed" | "unavailable" | undefined;
const catalog = (servers: Record<string, Status>, resolved = true) => ({
  sessionMcpResolved: resolved,
  servers: Object.entries(servers).map(([name, status]) => ({ name, session: { enabled: true, ...(status ? { status } : {}) } })),
});

/** A fake `request` answering `_x.ai/mcp/list` from a script, one entry per poll
 * (the last one repeats), and moving a fake clock by `stepMs` per poll. */
function scripted(polls: Array<ReturnType<typeof catalog>>, stepMs: number, beforePoll?: (poll: number, now: number) => void) {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  let calls = 0;
  const request = async (method: string) => {
    if (method !== "_x.ai/mcp/list") return {};
    beforePoll?.(calls, now);
    now += stepMs;
    const reply = polls[Math.min(calls, polls.length - 1)];
    calls += 1;
    return { result: reply };
  };
  return { request, calls: () => calls };
}

async function configure(request: (method: string) => Promise<unknown>, extra: { reused?: boolean; toolScope?: unknown; mounted?: string[] } = {}) {
  let wait: TurnToolWait | undefined;
  await grokConfigureSessionForTest({
    request,
    sessionId: "s1",
    env: {},
    config: { cli: "grok", fullAuto: false },
    turn: { threadId: "t1", ...(extra.toolScope !== undefined ? { toolScope: extra.toolScope } : {}) } as never,
    sessionModels: [],
    configOptions: [],
    reused: extra.reused === true,
    mcpServerNames: extra.mounted ?? ["agents", "browser", "perspicax", "my-private-notes"],
    noteToolWait: (value) => { wait = value; },
    notice: () => undefined,
  });
  return wait;
}

const lineWith = (wait: TurnToolWait | undefined) => {
  const trace = newTurnLatency(0);
  trace.path = "spawn";
  trace.promptAt = 3_000;
  if (wait) trace.toolWait = wait;
  return turnLatencyLine("grok", "t1", trace, 5_000, "ok");
};

/** The server's main thread busy `activeMs` between the wait's start and its
 * result (performance.eventLoopUtilization, read twice by the clock). */
const mainThreadBusy = (activeMs: number) =>
  vi.spyOn(performance, "eventLoopUtilization").mockImplementation(((since?: unknown) =>
    since ? { idle: 0, active: activeMs, utilization: 1 } : { idle: 0, active: 0, utilization: 0 }) as never);

beforeEach(() => {
  mainThreadBusy(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetGrokCatalogs();
  clearTurnCounters();
});

describe("toolsBy on the latency line (#3623)", () => {
  it("times each server to the first poll it answered, Sagax's mounts by name, slowest first", async () => {
    const { request } = scripted([
      catalog({ agents: "pending", browser: "pending", perspicax: "pending", "my-private-notes": "pending", "Team Wiki": "pending" }, false),
      catalog({ agents: "ready", browser: "pending", perspicax: "connecting", "my-private-notes": "ready", "Team Wiki": "pending" }),
      catalog({ agents: "ready", browser: "failed", perspicax: "starting", "my-private-notes": "ready", "Team Wiki": "ready" }),
      catalog({ agents: "ready", browser: "failed", perspicax: "ready", "my-private-notes": "ready", "Team Wiki": "ready" }),
    ], 500);
    const wait = await configure(request);
    expect(wait).toEqual({
      waitedMs: 2_000,
      mounts: [["perspicax", 2_000], ["browser", 1_500], ["agents", 1_000], ["connector", 1_000]],
      own: { count: 1, longestMs: 1_500 },
      resolvedMs: 1_000,
    });
    const line = lineWith(wait);
    expect(line).toContain(" toolsBy=perspicax:2000,browser:1500,agents:1000,connector:1000,own:1:1500,resolved:1000 ok");
    // a person's own connection and a mount under a person's name are never written
    expect(line).not.toContain("Team Wiki");
    expect(line).not.toContain("my-private-notes");
  });

  it("times a server the engine reports as initializing, the status Grok 1.0.77 gives one it is still starting", async () => {
    // the shape of a fixture turn with the installed engine: every mount
    // starts as initializing, then turns ready one by one
    const { request } = scripted([
      catalog({ agents: "initializing", browser: "initializing", connector: "initializing" }, false),
      catalog({ agents: "ready", browser: "initializing", connector: "initializing" }, false),
      catalog({ agents: "ready", browser: "ready", connector: "initializing" }, false),
      catalog({ agents: "ready", browser: "ready", connector: "ready" }, true),
    ], 400);
    const line = lineWith(await configure(request, { mounted: ["agents", "browser", "connector"] }));
    expect(line).toContain(" toolsBy=connector:1600,browser:1200,agents:800,resolved:1600 ok");
  });

  it("does not take the turn's tools as settled while a server is still initializing", () => {
    expect(grokMcpSettled(catalog({ agents: "ready", browser: "initializing" }, true))).toBe(false);
    expect(grokMcpSettled(catalog({ agents: "ready", browser: "unavailable" }, true))).toBe(true);
  });

  it("counts the person's own connections as one entry, never by name", async () => {
    const { request } = scripted([
      catalog({ agents: "ready", "managed_gateway:outlook": "pending", "Private CRM": "pending" }),
      catalog({ agents: "ready", "managed_gateway:outlook": "ready", "Private CRM": "pending" }),
      catalog({ agents: "ready", "managed_gateway:outlook": "ready", "Private CRM": "ready" }),
    ], 400);
    const line = lineWith(await configure(request, { mounted: ["agents"] }));
    // agents was never seen waiting: it prints nothing for itself (it printed
    // the first poll's time, 400, before the correction)
    expect(line).toContain(" toolsBy=own:2:1200,resolved:400 ok");
    expect(line).not.toMatch(/outlook|CRM/);
  });

  it("says how many servers were still connecting when the wait hit its limit, the wait unchanged", async () => {
    const { request, calls } = scripted([catalog({ agents: "ready", browser: "pending", "Own Thing": "pending" })], 5_000);
    const wait = await configure(request, { mounted: ["agents", "browser"] });
    // the 20 s limit, as before: 4 polls of 5 s, then the prompt goes
    expect(calls()).toBe(4);
    // agents never waited: no time of its own (the first poll's 5000 before)
    expect(wait).toEqual({ waitedMs: 20_000, mounts: [], pending: 2, resolvedMs: 5_000 });
    expect(lineWith(wait)).toContain(" toolsBy=resolved:5000,pending:2 ok");
  });

  it("stops waiting when the engine never started any of its servers, instead of at the 20 s limit", async () => {
    // a stalled engine start (#3623): every mount stays initializing, none
    // ever gets a request, and the session says it resolved them
    const { request, calls } = scripted([catalog({ agents: "initializing", browser: "initializing", "Own Thing": "initializing" })], 1_000);
    const wait = await configure(request, { mounted: ["agents", "browser"] });
    expect(calls()).toBe(12);
    expect(wait).toMatchObject({ waitedMs: 12_000, pending: 3 });
    expect(lineWith(wait)).toContain("pending:3 ok");
  });

  it("keeps waiting for a loaded start that serves its first server late (9 s), and gets its tools", async () => {
    // production on a loaded server: every mount starts late at once
    const late = catalog({ agents: "initializing", browser: "initializing" }, false);
    const { request, calls } = scripted([...Array(9).fill(late), catalog({ agents: "ready", browser: "ready" })], 1_000);
    const wait = await configure(request, { mounted: ["agents", "browser"] });
    expect(calls()).toBe(10);
    expect(wait).toMatchObject({ waitedMs: 10_000 });
    expect(wait?.pending ?? 0).toBe(0);
  });

  it("keeps waiting for a slow server while another one of the turn already started", async () => {
    const { request, calls } = scripted([
      catalog({ agents: "initializing", browser: "initializing" }, false),
      catalog({ agents: "ready", browser: "initializing" }, false),
    ], 1_000);
    const wait = await configure(request, { mounted: ["agents", "browser"] });
    // the 20 s limit, as before
    expect(calls()).toBe(20);
    expect(wait).toMatchObject({ waitedMs: 20_000, pending: 1 });
  });

  it("reads a stalled start only from servers still starting at every poll", () => {
    const clock = grokMcpWaitClock(["agents"], 0);
    clock.note(catalog({ agents: undefined }, false), 100);
    expect(clock.stalled(13_000)).toBe(false);
    clock.note(catalog({ agents: "initializing" }, false), 200);
    expect(clock.stalled(11_999)).toBe(false);
    expect(clock.stalled(12_000)).toBe(true);
    clock.note(catalog({ agents: "failed" }, true), 12_100);
    expect(clock.stalled(15_000)).toBe(false);
  });

  it("times the servers on the tool-selection branch too", async () => {
    const { request } = scripted([
      catalog({ agents: "pending" }, false),
      catalog({ agents: "ready" }, true),
    ], 300);
    const wait = await configure(request, { toolScope: { tools: ["agents"] }, mounted: ["agents"] });
    expect(lineWith(wait)).toContain(" toolsBy=agents:600,resolved:600 ok");
  });

  it("holds a tool-selection prompt until Sagax's own mounts are ready, even once the engine says resolved", async () => {
    const { request, calls } = scripted([
      catalog({ agents: "initializing", "Team Wiki": "pending" }, true),
      catalog({ agents: "initializing", "Team Wiki": "pending" }, true),
      catalog({ agents: "ready", "Team Wiki": "pending" }, true),
    ], 300);
    const wait = await configure(request, { toolScope: { tools: ["agents"] }, mounted: ["agents"] });
    // the person's own connection still pending never holds it (2026-11-06)
    expect(calls()).toBe(3);
    expect(wait).toMatchObject({ waitedMs: 900, mounts: [["agents", 900]] });
    expect(wait?.pending).toBeUndefined();
  });

  it("sends a tool-selection prompt after 10 s when one of Sagax's mounts never leaves its start", async () => {
    const { request, calls } = scripted([catalog({ agents: "initializing" }, true)], 1_000);
    const wait = await configure(request, { toolScope: { tools: ["agents"] }, mounted: ["agents"] });
    expect(calls()).toBe(10);
    expect(wait).toMatchObject({ waitedMs: 10_000, pending: 1 });
  });

  it("ends the wait at once on an answer without a list of servers", async () => {
    const { request, calls } = scripted([{ unexpected: true } as never], 300);
    await configure(request, { mounted: ["agents"] });
    expect(calls()).toBe(1);
  });

  it("prints nothing for a reused session that skips the wait", async () => {
    rememberGrokMcpSettled("s1");
    const { request, calls } = scripted([catalog({ agents: "ready" })], 300);
    const wait = await configure(request, { reused: true });
    expect(calls()).toBe(0);
    expect(wait).toBeUndefined();
    expect(lineWith(wait)).not.toContain("toolsBy=");
  });

  it("prints nothing for a wait under 50 ms", async () => {
    const { request } = scripted([catalog({ agents: "ready" })], 10);
    const wait = await configure(request);
    expect(wait?.waitedMs).toBe(10);
    expect(lineWith(wait)).not.toContain("toolsBy=");
  });

  it("prints at most eight of Sagax's mounts", () => {
    const names = ["agents", "browser", "data", "messages", "computer", "perspicax", "sagax-environment", "sagax-desktop", "sagax-computer"];
    const clock = grokMcpWaitClock(names, 0);
    clock.note(catalog(Object.fromEntries(names.map((name) => [name, "connecting"])), false), 50);
    clock.note(catalog(Object.fromEntries(names.map((name) => [name, "ready"]))), 100);
    expect(lineWith(clock.result(100, false)).match(/toolsBy=(\S+)/)?.[1].split(",").filter((entry) => !entry.startsWith("resolved:"))).toHaveLength(8);
  });

  it("names a mount by its product name, and by its kind otherwise", () => {
    expect(grokMountLabel("agents")).toBe("agents");
    expect(grokMountLabel("perspicax_some-profile")).toBe("perspicax");
    expect(grokMountLabel("sagax-environment")).toBe("sagax-environment");
    expect(grokMountLabel("bot-1234-notes")).toBe("connector");
  });

  it("keeps one reading of a server's state with grokMcpSettled", () => {
    expect(grokMcpSettled(catalog({ a: "starting" }))).toBe(false);
    const clock = grokMcpWaitClock([], 0);
    clock.note(catalog({ a: "starting" }), 100);
    expect(clock.result(100, true)).toEqual({ waitedMs: 100, mounts: [], pending: 1, resolvedMs: 100 });
  });

  it("times each server to the poll after its last wait when the engine connects them one after the other", async () => {
    // no state at the first poll, then one server connecting at a time, then
    // the engine says resolved two polls after the last server is ready
    const { request } = scripted([
      catalog({ agents: undefined, data: undefined, perspicax: undefined }, false),
      catalog({ agents: "connecting", data: undefined, perspicax: undefined }, false),
      catalog({ agents: "ready", data: "connecting", perspicax: undefined }, false),
      catalog({ agents: "ready", data: "ready", perspicax: "starting" }, false),
      catalog({ agents: "ready", data: "ready", perspicax: "ready" }, false),
      catalog({ agents: "ready", data: "ready", perspicax: "ready" }, false),
      catalog({ agents: "ready", data: "ready", perspicax: "ready" }, true),
    ], 300);
    const wait = await configure(request, { mounted: ["agents", "data", "perspicax"] });
    expect(wait).toEqual({
      waitedMs: 2_100,
      mounts: [["perspicax", 1_500], ["data", 1_200], ["agents", 900]],
      resolvedMs: 2_100,
    });
    const line = lineWith(wait);
    expect(line).toContain(" toolsBy=perspicax:1500,data:1200,agents:900,resolved:2100 toolsGap=after:600 ok");
    // never the first poll's time
    expect(line).not.toMatch(/(agents|data|perspicax):300\b/);
  });

  it("prints nothing for a server never seen waiting, only resolved", async () => {
    const { request } = scripted([
      catalog({ agents: undefined, browser: undefined }, false),
      catalog({ agents: "ready", browser: "ready" }, false),
      catalog({ agents: "ready", browser: "ready" }, true),
    ], 400);
    const wait = await configure(request, { mounted: ["agents", "browser"] });
    expect(wait).toEqual({ waitedMs: 1_200, mounts: [], resolvedMs: 1_200 });
    expect(lineWith(wait)).toContain(" toolsBy=resolved:1200 ok");
  });

  it("prints what Sagax's own endpoints served during the wait, in order of arrival", async () => {
    const { request } = scripted([
      catalog({ data: undefined, browser: undefined }, false),
      catalog({ data: "connecting", browser: undefined }, false),
      catalog({ data: "ready", browser: "connecting" }, false),
      catalog({ data: "ready", browser: "ready" }, true),
    ], 250, (poll, now) => {
      // the engine reaches the data endpoint, then the browser one
      if (poll === 1) noteTurnServed("t1", "data", "in", now + 20);
      if (poll === 2) { noteTurnServed("t1", "data", "out", now + 10); noteTurnServed("t1", "browser", "in", now + 30); }
      if (poll === 3) { noteTurnServed("t1", "browser", "out", now + 40); noteTurnServed("t1", "browser", "in", now + 60); }
    });
    // a request before the wait (another turn's) is not noted
    noteTurnServed("t1", "agents", "in");
    const wait = await configure(request, { mounted: ["data", "browser"] });
    expect(wait?.served).toEqual([["data", 270, 510], ["browser", 530, 790]]);
    expect(lineWith(wait)).toContain(" toolsBy=browser:1000,data:750,resolved:1000 toolsServed=data:270-510,browser:530-790 toolsGap=first:270 ok");
    // the wait is over: a later request is not noted
    noteTurnServed("t1", "agents", "in");
    expect(wait?.served).toHaveLength(2);
  });

  it("says how long the server's own main thread was busy during a wait with a gap (#3623)", async () => {
    // a production shape: the first list is asked late, the thread busy 2.3 s
    const { request } = scripted([
      catalog({ data: undefined }, false),
      catalog({ data: "initializing" }, false),
      catalog({ data: "ready" }, true),
    ], 1_300, (poll, now) => {
      if (poll === 2) { noteTurnServed("t1", "data", "in", now + 10); noteTurnServed("t1", "data", "out", now + 20); }
    });
    mainThreadBusy(2_310);
    const wait = await configure(request, { mounted: ["data"] });
    expect(wait?.busyMs).toBe(2_310);
    expect(lineWith(wait)).toContain(" toolsServed=data:2610-2620 toolsGap=first:2610,busy:2310 ok");
    // a thread that was free leaves the gap to the engine: nothing more
    vi.restoreAllMocks();
    const free = scripted([catalog({ data: undefined }, false), catalog({ data: "initializing" }, false), catalog({ data: "ready" }, true)], 1_300, (poll, now) => {
      if (poll === 2) { noteTurnServed("t1", "data", "in", now + 10); noteTurnServed("t1", "data", "out", now + 20); }
    });
    mainThreadBusy(40);
    expect(lineWith(await configure(free.request, { mounted: ["data"] }))).toContain(" toolsGap=first:2610 ok");
  });

  it("prints neither toolsBy nor toolsServed for a reused session", async () => {
    rememberGrokMcpSettled("s1");
    const { request } = scripted([catalog({ agents: "ready" })], 300);
    noteTurnServed("t1", "agents", "in");
    const line = lineWith(await configure(request, { reused: true }));
    expect(line).not.toContain("toolsBy=");
    expect(line).not.toContain("toolsServed=");
  });

  it("names an endpoint's mount by its capability, and reads a tool list request", () => {
    expect(turnServedMount("workplace")).toBe("sagax-computer");
    expect(turnServedMount("desktop")).toBe("sagax-desktop");
    expect(turnServedMount("personal-mcp")).toBe("connector");
    expect(turnServedMount("hooks")).toBeUndefined();
    expect(isToolListRequest({ method: "tools/list" })).toBe(true);
    expect(isToolListRequest({ message: { method: "tools/list" } })).toBe(true);
    expect(isToolListRequest({ method: "tools/call" })).toBe(false);
    expect(isToolListRequest(null)).toBe(false);
  });
});
