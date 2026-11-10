// Pulsatrix Flow watches (2026-11-09): the observe loop of a bot that holds a
// Pulsatrix profile. Fixture: rows of `px_flow.py proactive` (Flow #186).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { proactiveWriteCanExecuteUnprompted } from "../../shared/proactive-mode.ts";
import {
  FlowWatchLoop, WatchMemory, cadenceDue, evaluateWhen, observeCall, parseCadence, parseWatchListing, productsForApis,
  proposeTool, type FlowHelper, type FlowWatch, type FlowWatchLoopDeps, type ObserveSession,
} from "./flow-watches.ts";
import { ProactiveBudget, ProactiveEngine, classifyProactiveActionKind } from "./proactive.ts";
import { ProactivePendingFile, proactiveWakePrompt, type ProactiveEvent } from "./proactive-wake.ts";

const FIXTURE = readFileSync(join(import.meta.dirname, "fixtures", "flow-proactive.json"), "utf8");
const ZONE = "America/New_York";
// Monday 2026-11-09 15:00 local (20:00 UTC)
const MONDAY_15H = Date.UTC(2026, 10, 9, 20, 0);

function watch(overrides: Partial<FlowWatch> = {}): FlowWatch {
  return {
    id: "w-open", skill: "reporting-x", products: ["connectwise"], domain: "service", summary: "Open tickets.",
    observe: { tool: "cw_psa_service_query", args: { resource: "tickets" } }, when: "length(items) > `0`",
    cadence: "15m", propose: { skill: "reporting-x" }, kind: "read", prompt: "Use reporting-x on the open tickets.",
    ...overrides,
  };
}

function harness(opts: { mode?: unknown; stored?: boolean; observed?: unknown; readOnly?: string[]; watches?: unknown[]; budget?: number; now?: () => number; facts?: string; memory?: WatchMemory } = {}) {
  let access = true;
  let sessions = 0;
  const offered: ProactiveEvent[] = [];
  const logs: string[] = [];
  const calls: Array<{ name: string; args: unknown }> = [];
  let clock = MONDAY_15H;
  const helperCalls: string[][] = [];
  const helper: FlowHelper = {
    root: "/plugins/pulsatrix-flow",
    proactive: async (products) => {
      helperCalls.push([...products]);
      return JSON.stringify({ watches: opts.watches ?? [watch()] });
    },
    reference: async () => JSON.stringify({ topic: "team", body: opts.facts ?? "" }),
  };
  const bot = opts.stored === false ? {} : { proactiveMode: opts.mode ?? "proactive" };
  const session: ObserveSession & { apis(): Promise<Array<{ id: string; name: string }>>; holdsProfile(): Promise<boolean> } = {
    tools: new Set(["api_list", "cw_psa_service_query", "cw_psa_service_write", "flow_run", "flow_action"]),
    readOnly: new Set(opts.readOnly ?? ["cw_psa_service_query", "api_list"]),
    call: async (name, args) => {
      calls.push({ name, args });
      return { ok: true, isError: false, value: opts.observed ?? { items: [{ id: 1 }] } };
    },
    apis: async () => [{ id: "connectwise-psa", name: "ConnectWise PSA" }],
    holdsProfile: async () => true,
  };
  const deps: FlowWatchLoopDeps = {
    bots: () => [{ id: "b1", owner: "person-1" }],
    bot: (id) => (id === "b1" ? bot : undefined),
    helper: () => helper,
    session: async (_owner, _bot, fn) => {
      sessions += 1;
      return access ? fn(session) : null;
    },
    timeZone: () => ZONE,
    engine: new ProactiveEngine({
      bot: (id) => (id === "b1" ? bot : undefined),
      coveredByRules: () => false,
      budget: new ProactiveBudget({ minIntervalMs: 0, maxPerWindow: opts.budget ?? 12, windowMs: 3_600_000, now: () => clock }),
    }),
    offer: (event) => {
      offered.push(event);
      return "gathered";
    },
    log: (_bot, line) => logs.push(line),
    memory: opts.memory ?? new WatchMemory(),
    now: opts.now ?? (() => clock),
  };
  const loop = new FlowWatchLoop(deps);
  return {
    loop, offered, logs, calls, helperCalls,
    advance: (ms: number) => { clock += ms; },
    setAccess: (value: boolean) => { access = value; },
    sessions: () => sessions,
  };
}

describe("Flow watch listing", () => {
  it("reads the Flow contract rows whole", () => {
    const listing = parseWatchListing(FIXTURE);
    expect(listing.rejected).toBe(0);
    expect(listing.watches.length).toBeGreaterThan(3);
    for (const row of listing.watches) expect(parseCadence(row.cadence)).not.toBeNull();
  });

  it("drops a row with a bad cadence or a broken condition, and bad JSON is no watch", () => {
    const listing = parseWatchListing(JSON.stringify({ watches: [watch({ cadence: "sometimes" }), watch({ id: "w2", when: "length(" }), watch({ id: "w3" })] }));
    expect(listing.watches.map((row) => row.id)).toEqual(["w3"]);
    expect(listing.rejected).toBe(2);
    expect(parseWatchListing("not json").watches).toEqual([]);
  });

  it("an unknown kind is a write", () => {
    const listing = parseWatchListing(JSON.stringify({ watches: [{ ...watch(), kind: "maybe" }] }));
    expect(listing.watches[0]!.kind).toBe("write");
  });
});

describe("cadence", () => {
  it("an interval runs on first sight, then after its period", () => {
    const every = parseCadence("15m")!;
    expect(cadenceDue(every, undefined, MONDAY_15H, ZONE)).toBe(true);
    expect(cadenceDue(every, MONDAY_15H, MONDAY_15H + 14 * 60_000, ZONE)).toBe(false);
    expect(cadenceDue(every, MONDAY_15H, MONDAY_15H + 15 * 60_000, ZONE)).toBe(true);
    expect(parseCadence("1h")).toEqual({ kind: "every", ms: 3_600_000 });
  });

  it("daily runs once the local time passed, in the tenant's zone", () => {
    const daily = parseCadence("daily@16:00")!;
    // never catches up on a first sight
    expect(cadenceDue(daily, undefined, MONDAY_15H, ZONE)).toBe(false);
    expect(cadenceDue(daily, MONDAY_15H, MONDAY_15H + 59 * 60_000, ZONE)).toBe(false);
    expect(cadenceDue(daily, MONDAY_15H, MONDAY_15H + 60 * 60_000, ZONE)).toBe(true);
    // already ran after 16:00: not again until tomorrow 16:00
    const after = MONDAY_15H + 61 * 60_000;
    expect(cadenceDue(daily, after, after + 20 * 3_600_000, ZONE)).toBe(false);
    expect(cadenceDue(daily, after, after + 24 * 3_600_000, ZONE)).toBe(true);
  });

  it("weekly runs on its day only", () => {
    const friday = parseCadence("weekly:fri@10:00")!;
    expect(cadenceDue(friday, MONDAY_15H, MONDAY_15H + 2 * 86_400_000, ZONE)).toBe(false);
    // Friday 2026-11-13 10:00 local is 15:00 UTC
    expect(cadenceDue(friday, MONDAY_15H, Date.UTC(2026, 10, 13, 15, 0), ZONE)).toBe(true);
    expect(cadenceDue(friday, MONDAY_15H, Date.UTC(2026, 10, 13, 14, 59), ZONE)).toBe(false);
  });

  it("rejects what is out of format", () => {
    for (const bad of ["0m", "daily@25:00", "weekly:xyz@10:00", "hourly"]) expect(parseCadence(bad)).toBeNull();
  });
});

describe("when", () => {
  it("true and false follow JMESPath truth", () => {
    expect(evaluateWhen("length(items) > `0`", { items: [{ id: 1 }] }).holds).toBe(true);
    expect(evaluateWhen("length(items) > `0`", { items: [] }).holds).toBe(false);
    expect(evaluateWhen("items[?late]", { items: [{ late: false }] }).holds).toBe(false);
    expect(evaluateWhen("length(", { items: [] }).holds).toBe(false);
  });

  it("the key follows the result, so a new ticket is a new condition", () => {
    const one = evaluateWhen("items[].id", { items: [{ id: 1 }] }).key;
    expect(evaluateWhen("items[].id", { items: [{ id: 1 }] }).key).toBe(one);
    expect(evaluateWhen("items[].id", { items: [{ id: 1 }, { id: 2 }] }).key).not.toBe(one);
  });
});

describe("profiles to products", () => {
  it("maps the served APIs to Flow products", () => {
    const universe = ["connectwise", "connectwise-rmm", "sentinelone", "axcient-x360", "bookstack", "twilio"];
    expect(productsForApis([{ id: "connectwise-psa", name: "ConnectWise PSA" }], universe)).toEqual(["connectwise"]);
    expect(productsForApis([{ id: "x360recover", name: "X360Recover API" }], universe)).toEqual(["axcient-x360"]);
    expect(productsForApis([{ id: "s1", name: "SentinelOne" }, { id: "bookstack", name: "BookStack API" }], universe)).toEqual(["bookstack", "sentinelone"]);
  });
});

describe("observe is a read", () => {
  const session = { tools: new Set(["cw_psa_service_query", "cw_psa_service_write", "flow_action", "flow_run"]), readOnly: new Set(["cw_psa_service_query"]) };
  it("a served read-only tool runs; a writer never does", () => {
    expect(observeCall({ tool: "cw_psa_service_query", args: {} }, session)).toEqual({ name: "cw_psa_service_query", args: {} });
    expect(observeCall({ tool: "cw_psa_service_write", args: {} }, session)).toHaveProperty("refused");
    expect(observeCall({ tool: "not_served_list", args: {} }, session)).toHaveProperty("refused");
  });
  it("a Flow action is called without confirm", () => {
    const call = observeCall({ action: "dispatch-day-listing", params: { a: 1 } }, session);
    expect(call).toEqual({ name: "flow_action", args: { action: "dispatch-day-listing", params: { a: 1 } } });
    expect(JSON.stringify(call)).not.toContain("confirm");
  });
});

describe("the loop", () => {
  it("a bot with no stored mode or an old value gets no watch: nothing observed, nothing offered", async () => {
    for (const opts of [{ stored: false }, { mode: "propose" }, { mode: "follow-rules" }]) {
      const h = harness(opts);
      await h.loop.tick();
      expect(h.calls).toEqual([]);
      expect(h.helperCalls).toEqual([]);
      expect(h.offered).toEqual([]);
    }
  });

  it("a profile bot with a stored proactive mode fires a watch into its conversation", async () => {
    const h = harness({ mode: "proactive" });
    await h.loop.tick();
    expect(h.helperCalls).toContainEqual(["connectwise"]);
    expect(h.calls.map((call) => call.name)).toEqual(["cw_psa_service_query"]);
    expect(h.offered).toHaveLength(1);
    const event = h.offered[0]!;
    expect(event.source).toBe("watch");
    expect(event.runAs).toBe("person-1");
    expect(event.label).toBe("Pulsatrix watch: Open tickets.");
    expect(event.watch?.disposition).toBe("auto");
  });

  it("a chosen off is respected: nothing observed, nothing offered", async () => {
    const h = harness({ mode: "off" });
    await h.loop.tick();
    expect(h.calls).toEqual([]);
    expect(h.helperCalls).toEqual([]);
    expect(h.offered).toEqual([]);
  });

  it("a garbage mode fails closed", async () => {
    const h = harness({ mode: "sometimes" });
    await h.loop.tick();
    expect(h.offered).toEqual([]);
  });

  it("a false condition offers nothing", async () => {
    const h = harness({ observed: { items: [] } });
    await h.loop.tick();
    expect(h.calls.map((call) => call.name)).toContain("cw_psa_service_query");
    expect(h.offered).toEqual([]);
  });

  it("dedup: a condition still true with the same key does not fire again; false then true does", async () => {
    let observed: unknown = { items: [{ id: 1 }] };
    const h = harness();
    const loop = h.loop;
    const fire = (value: unknown) => loop.consider("b1", "person-1", watch(), value);
    expect(fire(observed)).toBe("fired");
    expect(fire(observed)).toBe("duplicate");
    observed = { items: [] };
    expect(fire(observed)).toBe("false");
    expect(fire({ items: [{ id: 1 }] })).toBe("fired");
    expect(h.offered).toHaveLength(2);
  });

  it("budget: past the hour's limit a watch waits and may fire later", async () => {
    const h = harness({ budget: 1 });
    expect(h.loop.consider("b1", "person-1", watch({ id: "a" }), { items: [1] })).toBe("fired");
    expect(h.loop.consider("b1", "person-1", watch({ id: "b" }), { items: [1] })).toBe("budget");
    expect(h.offered).toHaveLength(1);
    h.advance(3_600_001);
    // the waiting condition was not marked as fired
    expect(h.loop.consider("b1", "person-1", watch({ id: "b" }), { items: [1] })).toBe("fired");
  });

  it("a write is never executed unprompted: it goes to the ordinary approval path", () => {
    const h = harness();
    const write = watch({ id: "w-write", kind: "write", propose: { action: "assign-ticket", params: {} } });
    expect(classifyProactiveActionKind({ tool: proposeTool(write) })).toBe("write");
    expect(h.loop.consider("b1", "person-1", write, { items: [1] })).toBe("fired");
    const event = h.offered[0]!;
    expect(event.watch?.disposition).toBe("defer");
    expect(proactiveWriteCanExecuteUnprompted("defer")).toBe(false);
    const prompt = proactiveWakePrompt({ mode: "proactive", events: [event], more: 0 });
    expect(prompt).toContain("ordinary approval");
    expect(prompt).toContain(write.prompt);
  });

  it("a declared read whose propose runs a routine is still a write", () => {
    expect(classifyProactiveActionKind({ tool: proposeTool(watch({ propose: { routine: "nightly" } })) })).toBe("write");
    expect(classifyProactiveActionKind({ tool: proposeTool(watch()) })).toBe("read");
  });

  it("an observe that is not a read is skipped and logged", async () => {
    const h = harness({ watches: [watch({ observe: { tool: "cw_psa_service_write", args: {} } })] });
    await h.loop.tick();
    expect(h.calls.map((call) => call.name)).not.toContain("cw_psa_service_write");
    expect(h.logs.join("\n")).toContain("is not a read");
    expect(h.offered).toEqual([]);
  });

  it("the cadence holds between ticks", async () => {
    const h = harness({ observed: { items: [] } });
    await h.loop.tick();
    await h.loop.tick();
    expect(h.calls.filter((call) => call.name === "cw_psa_service_query")).toHaveLength(1);
    h.advance(15 * 60_000);
    await h.loop.tick();
    expect(h.calls.filter((call) => call.name === "cw_psa_service_query")).toHaveLength(2);
  });

  it("a token the tenant does not set skips the watch: no call with a raw template", async () => {
    const h = harness({ watches: [watch({ observe: { tool: "cw_psa_service_query", args: { owner: "{{fact:team.operator_login}}" } } })] });
    await h.loop.tick();
    expect(h.calls.map((call) => call.name)).not.toContain("cw_psa_service_query");
    expect(h.logs.join("\n")).toContain("{{fact:team.operator_login}}");
  });

  it("facts and dates are resolved before the observe call", async () => {
    const facts = "| Field | Value |\n| --- | --- |\n| operator_login | `pat` |\n";
    const h = harness({ facts, watches: [watch({ observe: { tool: "cw_psa_service_query", args: { owner: "{{fact:team.operator_login}}", since: "{{days_ago:1}}" } } })] });
    await h.loop.tick();
    const call = h.calls.find((row) => row.name === "cw_psa_service_query");
    expect(call?.args).toEqual({ owner: "pat", since: "2026-11-08T00:00:00" });
  });

  it("no Pulsatrix access: the ready watches wait for their next cadence, not every tick (#3140)", async () => {
    const h = harness({ observed: { items: [] } });
    await h.loop.tick();
    h.setAccess(false);
    h.advance(15 * 60_000);
    await h.loop.tick();
    const tried = h.sessions();
    h.advance(60_000);
    await h.loop.tick();
    h.advance(60_000);
    await h.loop.tick();
    expect(h.sessions()).toBe(tried);
    h.advance(15 * 60_000);
    await h.loop.tick();
    expect(h.sessions()).toBe(tried + 1);
    expect(h.logs.filter((line) => line.includes("no Pulsatrix access"))).toHaveLength(1);
  });

  it("a skipped watch posts its line once per cause, then stays silent until the cause changes (#3140)", async () => {
    const unresolved = watch({ observe: { tool: "cw_psa_service_query", args: { owner: "{{fact:team.operator_login}}" } } });
    const h = harness({ watches: [unresolved] });
    await h.loop.tick();
    h.advance(15 * 60_000);
    await h.loop.tick();
    h.advance(15 * 60_000);
    await h.loop.tick();
    expect(h.logs.filter((line) => line.includes("w-open skipped"))).toHaveLength(1);
  });

  it("a cause that changes posts again; an observe that succeeds resets it (#3140)", async () => {
    const h = harness({ observed: { items: [] } });
    await h.loop.tick();
    h.setAccess(false);
    h.advance(15 * 60_000);
    await h.loop.tick();
    h.setAccess(true);
    h.advance(15 * 60_000);
    await h.loop.tick();
    h.setAccess(false);
    h.advance(15 * 60_000);
    await h.loop.tick();
    expect(h.logs.filter((line) => line.includes("no Pulsatrix access"))).toHaveLength(2);
  });

  it("a pending watch event carries a replay ref that survives a restart (#3140)", async () => {
    const h = harness();
    await h.loop.tick();
    const event = h.offered[0]!;
    expect(event.replay).toEqual({ kind: "watch", watchId: "w-open" });
    const dir = mkdtempSync(join(tmpdir(), "watch-pending-"));
    try {
      new ProactivePendingFile(join(dir, "pending.json")).set("b1", [event]);
      expect(new ProactivePendingFile(join(dir, "pending.json")).take()).toEqual([{ botId: "b1", key: event.key, ref: { kind: "watch", watchId: "w-open" } }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a replayed watch is observed again at the next tick and fires again, even across a restart (#3140)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-memory-"));
    try {
      const file = join(dir, "watches.json");
      const first = harness({ memory: new WatchMemory(file) });
      await first.loop.tick();
      expect(first.offered).toHaveLength(1);
      // the server restarts before the wake: the pending file replays the watch
      const second = harness({ memory: new WatchMemory(file) });
      second.loop.replay("b1", "w-open");
      await second.loop.tick();
      expect(second.offered).toHaveLength(1);
      expect(new WatchMemory(file).get("b1", "w-open").due).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a dropped watch event is released: the condition may fire again (#3140)", async () => {
    const h = harness();
    await h.loop.tick();
    expect(h.offered).toHaveLength(1);
    h.loop.released("b1", "w-open");
    h.advance(15 * 60_000);
    await h.loop.tick();
    expect(h.offered).toHaveLength(2);
  });
});
