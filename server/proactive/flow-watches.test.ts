// Pulsatrix Flow watches (2026-11-09): the observe loop of a bot that holds a
// Pulsatrix profile. Fixture: rows of `px_flow.py proactive` (Flow #186).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { proactiveWriteCanExecuteUnprompted } from "../../shared/proactive-mode.ts";
import {
  FlowWatchLoop, WatchMemory, cadenceDue, evaluateWhen, observeCall, parseCadence, parseWatchListing, productsForApis,
  proposeTool, watchesForProducts, watchReadTools, domainLabel, type FlowHelper, type FlowWatch, type FlowWatchLoopDeps, type ObserveConnection,
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
    cadence: "15m", propose: { skill: "reporting-x" }, kind: "read", prompt: "Use reporting-x on the open tickets.", tools: [],
    ...overrides,
  };
}

type HarnessBot = { id: string; owner: string; primary?: boolean; mode?: unknown; hidden?: boolean };
type HarnessChoice = { person: string; domains: Array<{ domain: string; botId: string; watchesOff?: string[] }> };

/** `choices`: the people's chosen domains (default: person-1 chose the
 * service domain on b1). The bots are stored as the real store makes them:
 * a stored "proactive" unless a mode is given. */
function harness(opts: { choices?: HarnessChoice[]; mode?: unknown; observed?: unknown; readOnly?: string[]; watches?: unknown[]; budget?: number; now?: () => number; facts?: string; memory?: WatchMemory; bots?: HarnessBot[]; skills?: string[]; apis?: Array<{ id: string; name: string }> } = {}) {
  let access = true;
  let sessions = 0;
  let apiReads = 0;
  let inventories = 0;
  const offered: ProactiveEvent[] = [];
  const logs: string[] = [];
  const pauses: Array<{ botId: string; domain: string; cause: string }> = [];
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
  const roster: HarnessBot[] = opts.bots ?? [{ id: "b1", owner: "person-1", mode: opts.mode ?? "proactive" }];
  const choices = (opts.choices ?? [{ person: "person-1", domains: [{ domain: "service", botId: "b1" }] }])
    .map((row) => ({ person: row.person, domains: row.domains.map((domain) => ({ ...domain, watchesOff: domain.watchesOff ?? [] })) }));
  const record = (id: string) => {
    const row = roster.find((candidate) => candidate.id === id);
    return row ? { proactiveMode: row.mode ?? "proactive" } : undefined;
  };
  const session: ObserveConnection = {
    tools: new Set(["api_list", "cw_psa_service_query", "cw_psa_service_write", "flow_run", "flow_action"]),
    readOnly: new Set(opts.readOnly ?? ["cw_psa_service_query", "api_list"]),
    call: async (name, args) => {
      calls.push({ name, args });
      return { ok: true, isError: false, value: opts.observed ?? { items: [{ id: 1 }] } };
    },
    apis: async () => {
      apiReads += 1;
      return opts.apis ?? [{ id: "connectwise-psa", name: "ConnectWise PSA" }];
    },
    holdsProfile: async () => true,
  };
  const deps: FlowWatchLoopDeps = {
    choices: () => choices,
    carrier: (botId, person) => {
      const row = roster.find((candidate) => candidate.id === botId);
      if (!row) return { ok: false, cause: "bot-gone" };
      return row.owner === person && !row.hidden ? { ok: true } : { ok: false, cause: "bot-not-eligible" };
    },
    skills: () => { inventories += 1; return new Set(opts.skills ?? ["reporting-x"]); },
    owner: (botId) => roster.find((candidate) => candidate.id === botId)?.owner,
    helper: () => helper,
    session: async (_owner, _bot, fn) => {
      sessions += 1;
      return access ? fn(session) : null;
    },
    timeZone: () => ZONE,
    // as server/index.ts wires it: the person's choice passes the switch
    engine: new ProactiveEngine({
      bot: (id) => (record(id) ? { ...record(id), proactiveMode: "proactive" } : undefined),
      coveredByRules: () => false,
      budget: new ProactiveBudget({ minIntervalMs: 0, maxPerWindow: opts.budget ?? 12, windowMs: 3_600_000, now: () => clock }),
    }),
    offer: (event) => {
      offered.push(event);
      return "gathered";
    },
    log: (_bot, line) => logs.push(line),
    pause: (botId, _person, domain, cause) => pauses.push({ botId, domain, cause }),
    memory: opts.memory ?? new WatchMemory(),
    now: opts.now ?? (() => clock),
  };
  const loop = new FlowWatchLoop(deps);
  return {
    loop, offered, logs, calls, helperCalls, pauses, choices,
    advance: (ms: number) => { clock += ms; },
    setAccess: (value: boolean) => { access = value; },
    sessions: () => sessions,
    apiReads: () => apiReads,
    inventories: () => inventories,
  };
}

describe("Flow watch listing", () => {
  it("reads the Flow contract rows whole", () => {
    const listing = parseWatchListing(FIXTURE);
    expect(listing.rejected).toBe(0);
    expect(listing.watches.length).toBeGreaterThan(3);
    for (const row of listing.watches) expect(parseCadence(row.cadence)).not.toBeNull();
  });

  it("#3423: reads the domains and the declared tools of the Flow output, known fields only", () => {
    const listing = parseWatchListing(FIXTURE);
    expect(domainLabel(listing, "backup", "fr")).toBe("Sauvegardes");
    expect(listing.domains?.backup?.audience?.en).toBe("Who follows the clients' backups");
    expect(listing.watches[0]!.tools).toEqual(["axcient_x360recover_query"]);
    expect(listing.watches[1]!.tools).toEqual([]);
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

describe("the loop walks the person's choices (#3423)", () => {
  it("a bot as the real store makes it (a stored proactive) and no choice: no session, no helper call, no read, no offer", async () => {
    const h = harness({ mode: "proactive", choices: [] });
    await h.loop.tick();
    h.advance(60 * 60_000);
    await h.loop.tick();
    expect(h.sessions()).toBe(0);
    expect(h.helperCalls).toEqual([]);
    expect(h.calls).toEqual([]);
    expect(h.offered).toEqual([]);
  });
});

describe("the loop", () => {
  it("a chosen domain fires its watch into the carrying bot's conversation, as the person", async () => {
    const h = harness();
    await h.loop.tick();
    expect(h.helperCalls).toContainEqual(["connectwise"]);
    expect(h.calls.map((call) => call.name)).toEqual(["cw_psa_service_query"]);
    expect(h.offered).toHaveLength(1);
    const event = h.offered[0]!;
    expect(event.source).toBe("watch");
    expect(event.botId).toBe("b1");
    expect(event.runAs).toBe("person-1");
    expect(event.label).toBe("Pulsatrix watch: Open tickets.");
    expect(event.watch).toMatchObject({ disposition: "auto", domain: "service", chosen: true });
  });

  it("one domain is carried by the one bot the person named: one event, one wake, once (#3394)", async () => {
    const h = harness({
      bots: [
        { id: "primary", owner: "person-1", primary: true },
        { id: "coder-1", owner: "person-1" },
        { id: "other", owner: "person-2" },
      ],
      choices: [
        { person: "person-1", domains: [{ domain: "service", botId: "coder-1" }] },
        { person: "person-2", domains: [{ domain: "service", botId: "other" }] },
      ],
    });
    await h.loop.tick();
    const woken = (owner: string) => h.offered.filter((event) => event.runAs === owner).map((event) => event.botId);
    expect(woken("person-1")).toEqual(["coder-1"]);
    // another person's choice is theirs (person isolation)
    expect(woken("person-2")).toEqual(["other"]);
    h.advance(15 * 60_000);
    await h.loop.tick();
    expect(woken("person-1")).toEqual(["coder-1"]);
  });

  it("a chosen watch passes the switch: a carrying bot whose switch is off still observes", async () => {
    const h = harness({ mode: "off" });
    await h.loop.tick();
    expect(h.calls.map((call) => call.name)).toEqual(["cw_psa_service_query"]);
    expect(h.offered).toHaveLength(1);
  });

  it("a domain not chosen, or a watch switched off inside it, is never observed", async () => {
    const other = harness({ watches: [watch({ domain: "finance" })] });
    await other.loop.tick();
    expect(other.calls.filter((call) => call.name === "cw_psa_service_query")).toEqual([]);
    expect(other.offered).toEqual([]);
    const off = harness({ choices: [{ person: "person-1", domains: [{ domain: "service", botId: "b1", watchesOff: ["w-open"] }] }] });
    await off.loop.tick();
    expect(off.calls.filter((call) => call.name === "cw_psa_service_query")).toEqual([]);
    expect(off.offered).toEqual([]);
    // switched off on purpose is no pause
    expect(off.pauses).toEqual([]);
  });

  it("a watch runs only when the connection serves every product it names", async () => {
    expect(watchesForProducts([watch({ products: ["connectwise", "sentinelone"] })], ["connectwise"])).toEqual([]);
    expect(watchesForProducts([watch({ products: ["connectwise", "sentinelone"] })], ["connectwise", "sentinelone"])).toHaveLength(1);
    const h = harness({ watches: [watch({ products: ["connectwise", "sentinelone"] })] });
    await h.loop.tick();
    expect(h.calls.filter((call) => call.name === "cw_psa_service_query")).toEqual([]);
    expect(h.pauses).toEqual([{ botId: "b1", domain: "service", cause: "no-watch" }]);
  });

  it("a watch whose skill the bot lacks never runs; the domain pauses once, in the bot's chat", async () => {
    const h = harness({ skills: [] });
    await h.loop.tick();
    h.advance(15 * 60_000);
    await h.loop.tick();
    expect(h.calls.filter((call) => call.name === "cw_psa_service_query")).toEqual([]);
    expect(h.offered).toEqual([]);
    expect(h.pauses).toEqual([{ botId: "b1", domain: "service", cause: "no-watch" }]);
  });

  it("a carrying bot that is gone or no longer the person's pauses, with its cause, once", async () => {
    const gone = harness({ choices: [{ person: "person-1", domains: [{ domain: "service", botId: "deleted" }] }] });
    await gone.loop.tick();
    await gone.loop.tick();
    expect(gone.pauses).toEqual([{ botId: "deleted", domain: "service", cause: "bot-gone" }]);
    expect(gone.sessions()).toBe(0);
    const foreign = harness({ choices: [{ person: "person-2", domains: [{ domain: "service", botId: "b1" }] }] });
    await foreign.loop.tick();
    expect(foreign.pauses).toEqual([{ botId: "b1", domain: "service", cause: "bot-not-eligible" }]);
    expect(foreign.sessions()).toBe(0);
    expect(foreign.offered).toEqual([]);
  });

  it("a paused domain resumes by itself, and a later pause is told again", async () => {
    const skills: string[] = [];
    const h = harness({ skills });
    await h.loop.tick();
    expect(h.pauses).toHaveLength(1);
    skills.push("reporting-x");
    h.advance(15 * 60_000);
    await h.loop.tick();
    expect(h.offered).toHaveLength(1);
    skills.length = 0;
    h.advance(15 * 60_000);
    await h.loop.tick();
    expect(h.pauses).toHaveLength(2);
  });

  it("a chosen domain the organization's Flow does not have pauses with a line, never in silence", async () => {
    // "backups" chosen where Flow has "service" (and a product is served)
    const h = harness({ choices: [{ person: "person-1", domains: [{ domain: "backups", botId: "b1" }] }] });
    await h.loop.tick();
    await h.loop.tick();
    expect(h.pauses).toEqual([{ botId: "b1", domain: "backups", cause: "unknown-domain" }]);
    expect(h.offered).toEqual([]);
  });

  it("a chosen domain whose watches all need a product the person lacks pauses, even when the helper filters by product", async () => {
    const h = harness({ watches: [watch({ products: ["sentinelone"] }), watch({ id: "w-other", domain: "finance" })] });
    await h.loop.tick();
    expect(h.pauses).toEqual([{ botId: "b1", domain: "service", cause: "no-watch" }]);
  });

  it("lists the domains a person can choose: label, watches with summary and cadence, and whether each runs here", async () => {
    const h = harness({
      skills: ["reporting-x"],
      watches: [watch(), watch({ id: "w-s1", domain: "security", products: ["sentinelone"] }), watch({ id: "w-sk", domain: "dispatch", skill: "absent-skill" })],
    });
    const listing = await h.loop.offered("person-1", "b1");
    expect(listing).toMatchObject({ ok: true, botId: "b1" });
    if (!listing.ok) throw new Error("not listed");
    expect(listing.domains.map((row) => [row.domain, row.eligible])).toEqual([["dispatch", false], ["security", false], ["service", true]]);
    expect(listing.domains.find((row) => row.domain === "service")?.watches).toEqual([
      // #3431: the tools it reads with (here its observe tool), for the card's details
      { id: "w-open", summary: "Open tickets.", cadence: "15m", products: ["connectwise"], runs: true, tools: ["cw_psa_service_query"] },
    ]);
    expect(listing.domains.find((row) => row.domain === "security")?.watches[0]).toMatchObject({ runs: false, missing: "product" });
    expect(listing.domains.find((row) => row.domain === "dispatch")?.watches[0]).toMatchObject({ runs: false, missing: "skill" });
    expect(await h.loop.offered("person-2", "b1")).toEqual({ ok: false, botId: "b1", cause: "bot-not-eligible" });
    // asked, not ambient: no observe call
    expect(h.calls.filter((call) => call.name === "cw_psa_service_query")).toEqual([]);
  });

  it("the person's products are read once a day, not every hour", async () => {
    const h = harness({ observed: { items: [] } });
    await h.loop.tick();
    for (let hour = 0; hour < 5; hour += 1) {
      h.advance(60 * 60_000);
      await h.loop.tick();
    }
    expect(h.apiReads()).toBe(1);
    h.advance(24 * 60 * 60_000);
    await h.loop.tick();
    expect(h.apiReads()).toBe(2);
  });

  it("watch memory is the person's: the domain moved to another bot does not fire the same condition again", async () => {
    const h = harness({ bots: [{ id: "b1", owner: "person-1" }, { id: "b2", owner: "person-1" }] });
    await h.loop.tick();
    expect(h.offered.map((event) => event.botId)).toEqual(["b1"]);
    h.choices[0]!.domains[0]!.botId = "b2";
    h.advance(15 * 60_000);
    await h.loop.tick();
    expect(h.offered.map((event) => event.botId)).toEqual(["b1"]);
  });

  it("reads covered by the yes: the declared tools kept only when read-only, else the observe tool", () => {
    const readOnly = new Set(["cw_psa_service_query", "cw_psa_time_query"]);
    expect(watchReadTools([watch()], readOnly)).toEqual(["cw_psa_service_query"]);
    expect(watchReadTools([watch({ tools: ["cw_psa_time_query", "cw_psa_service_write"] })], readOnly)).toEqual(["cw_psa_time_query"]);
  });

  it("the domain's label falls back to its slug", () => {
    const listing = parseWatchListing(JSON.stringify({ watches: [watch()], domains: { service: { label: { fr: "Service", en: "Service desk" } } } }));
    expect(domainLabel(listing, "service", "en")).toBe("Service desk");
    expect(domainLabel(listing, "finance", "fr")).toBe("finance");
    expect(domainLabel(undefined, "finance", "en")).toBe("finance");
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

  it("#3432: a watch that wakes the carrying bot is the person's last alert, kept on disk; a refused one is not", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-alert-"));
    const memory = new WatchMemory(join(dir, "memory.json"));
    const h = harness({ memory });
    expect(h.loop.lastAlert("person-1", "w-open")).toBeUndefined();
    expect(h.loop.consider("b1", "person-1", watch({ id: "w-open" }), { items: [1] })).toBe("fired");
    const first = h.loop.lastAlert("Person-1 ", "w-open");
    expect(first).toBeGreaterThanOrEqual(0);
    memory.save();
    expect(new WatchMemory(join(dir, "memory.json")).get("person-1", "w-open").alertAt).toBe(first);
    const blocked = harness({ budget: 0 });
    expect(blocked.loop.consider("b1", "person-1", watch({ id: "w-open" }), { items: [1] })).toBe("budget");
    expect(blocked.loop.lastAlert("person-1", "w-open")).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
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
      expect(new WatchMemory(file).get("person-1", "w-open").due).toBeUndefined();
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

describe("#3470: one skill inventory per bot", () => {
  const BOTS = 20;
  const WATCHES = 30;
  const many = () => Array.from({ length: WATCHES }, (_, index) => watch({ id: `w-${index}`, skill: index % 2 ? "reporting-x" : "reporting-y" }));
  const roster = () => Array.from({ length: BOTS }, (_, index) => ({ id: `b${index + 1}`, owner: "person-1" }));

  it("the listing of every bot of a person builds at most one inventory per bot, whatever the number of watches", async () => {
    const h = harness({ bots: roster(), watches: many(), choices: [] });
    for (let index = 1; index <= BOTS; index += 1) {
      const listing = await h.loop.offered("person-1", `b${index}`);
      expect(listing.ok).toBe(true);
      if (listing.ok) expect(listing.domains[0]!.watches.filter((row) => row.missing === "skill")).toHaveLength(WATCHES / 2);
    }
    expect(h.inventories()).toBeLessThanOrEqual(BOTS);
  });

  it("the loop's walk of a chosen domain reads the bot's skills once, not once per watch", async () => {
    const h = harness({ watches: many() });
    await h.loop.tick();
    expect(h.inventories()).toBe(1);
  });
});
