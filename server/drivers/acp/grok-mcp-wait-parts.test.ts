// #3623: the latency line names the tool servers the engine's setup waited for.
import { afterEach, describe, expect, it, vi } from "vitest";

import { grokConfigureSessionForTest, grokMcpSettled } from "./grok.ts";
import { grokMcpWaitClock, grokMountLabel } from "./grok-mcp-wait-parts.ts";
import { rememberGrokMcpSettled, resetGrokCatalogs } from "./grok-tool-catalog.ts";
import { newTurnLatency, turnLatencyLine, type TurnToolWait } from "./turn-latency.ts";

type Status = "pending" | "connecting" | "starting" | "ready" | "failed";
const catalog = (servers: Record<string, Status>, resolved = true) => ({
  sessionMcpResolved: resolved,
  servers: Object.entries(servers).map(([name, status]) => ({ name, session: { enabled: true, status } })),
});

/** A fake `request` answering `_x.ai/mcp/list` from a script, one entry per poll
 * (the last one repeats), and moving a fake clock by `stepMs` per poll. */
function scripted(polls: Array<ReturnType<typeof catalog>>, stepMs: number) {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  let calls = 0;
  const request = async (method: string) => {
    if (method !== "_x.ai/mcp/list") return {};
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

afterEach(() => {
  vi.restoreAllMocks();
  resetGrokCatalogs();
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
    });
    const line = lineWith(wait);
    expect(line).toContain(" toolsBy=perspicax:2000,browser:1500,agents:1000,connector:1000,own:1:1500 ok");
    // a person's own connection and a mount under a person's name are never written
    expect(line).not.toContain("Team Wiki");
    expect(line).not.toContain("my-private-notes");
  });

  it("counts the person's own connections as one entry, never by name", async () => {
    const { request } = scripted([
      catalog({ agents: "ready", "managed_gateway:outlook": "pending", "Private CRM": "pending" }),
      catalog({ agents: "ready", "managed_gateway:outlook": "ready", "Private CRM": "pending" }),
      catalog({ agents: "ready", "managed_gateway:outlook": "ready", "Private CRM": "ready" }),
    ], 400);
    const line = lineWith(await configure(request, { mounted: ["agents"] }));
    expect(line).toContain(" toolsBy=agents:400,own:2:1200 ok");
    expect(line).not.toMatch(/outlook|CRM/);
  });

  it("says how many servers were still connecting when the wait hit its limit, the wait unchanged", async () => {
    const { request, calls } = scripted([catalog({ agents: "ready", browser: "pending", "Own Thing": "pending" })], 5_000);
    const wait = await configure(request, { mounted: ["agents", "browser"] });
    // the 20 s limit, as before: 4 polls of 5 s, then the prompt goes
    expect(calls()).toBe(4);
    expect(wait).toEqual({ waitedMs: 20_000, mounts: [["agents", 5_000]], pending: 2 });
    expect(lineWith(wait)).toContain(" toolsBy=agents:5000,pending:2 ok");
  });

  it("times the servers on the tool-selection branch too", async () => {
    const { request } = scripted([
      catalog({ agents: "pending" }, false),
      catalog({ agents: "ready" }, true),
    ], 300);
    const wait = await configure(request, { toolScope: { tools: ["agents"] }, mounted: ["agents"] });
    expect(lineWith(wait)).toContain(" toolsBy=agents:600 ok");
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
    clock.note(catalog(Object.fromEntries(names.map((name) => [name, "ready"]))), 100);
    expect(lineWith(clock.result(100, false)).match(/toolsBy=(\S+)/)?.[1].split(",")).toHaveLength(8);
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
    expect(clock.result(100, true)).toEqual({ waitedMs: 100, mounts: [], pending: 1 });
  });
});
