// Pulsatrix Flow watches (2026-11-09): what a person turned on, run for a
// bot that holds a Pulsatrix profile. #4250 (S5): each chosen watch is a
// routine of the carrying bot; its code check reads it through the one probe
// engine (server/routines/routine-watch.ts). Fixture: rows of `px_flow.py
// proactive` (Flow #186).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createRoutineWatchEvaluator, RoutineWatchStates } from "../routines/routine-watch.ts";
import type { RoutinePrecheckVerdict } from "../routines/routine-precheck.ts";
import type { Routine, RoutineInput } from "../routines/routines.ts";
import {
  FLOW_WATCH_CHECK, FlowWatches, WatchMemory, cadenceSchedule, evaluateWhen, observeCall, parseCadence, parseWatchListing, productsForApis,
  WATCH_RELOAD_MS, readableName, watchesForBot, watchMissing, watchRoutineInput, domainLabel, type FlowHelper, type FlowWatch, type FlowWatchesDeps, type ObserveConnection,
} from "./flow-watches.ts";
import { ProactivePendingFile } from "./proactive-wake.ts";

const FIXTURE = readFileSync(join(import.meta.dirname, "fixtures", "flow-proactive.json"), "utf8");
const ZONE = "America/New_York";
// Monday 2026-11-09 15:00 local (20:00 UTC)
const MONDAY_15H = Date.UTC(2026, 10, 9, 20, 0);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

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
type Woken = { routineId: string; botId: string; runAs?: string; name: string; prompt: string; note: string };

/** `choices`: the people's chosen domains (default: person-1 chose the
 * service domain on b1). The routines live in a small routine manager; a
 * pass is what the scheduler does: the sync the choices ask for, then each
 * enabled watch routine's code check, as the scheduler runs it. */
function harness(opts: { choices?: HarnessChoice[]; mode?: unknown; observed?: unknown; readOnly?: string[]; watches?: unknown[]; now?: () => number; facts?: string; memory?: WatchMemory; states?: string; bots?: HarnessBot[]; skills?: string[]; apis?: Array<{ id: string; name: string }> } = {}) {
  let access = true;
  let sessions = 0;
  let apiReads = 0;
  let inventories = 0;
  let nextId = 0;
  const woken: Woken[] = [];
  const failures: string[] = [];
  const logs: string[] = [];
  const pauses: Array<{ botId: string; domain: string; cause: string }> = [];
  const calls: Array<{ name: string; args: unknown }> = [];
  const routines: Routine[] = [];
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
  const states = new RoutineWatchStates(opts.states ?? join(tempDir("flow-watch-states-"), "states"));
  // the one probe engine, as server/index.ts wires it: the read goes out as the person
  const evaluate = createRoutineWatchEvaluator({
    place: () => ({ kind: "refuse", reason: "a tool read never touches a computer" }),
    callTool: async (_routine, tool, args) => {
      if (!access) return { error: "Perspicax is not available to this person." };
      const answer = await session.call(tool, args);
      return answer.ok ? { isError: answer.isError, value: answer.value } : { error: answer.error };
    },
    states,
    now: () => clock,
  });
  const manager = {
    list: () => routines,
    create: (input: RoutineInput, runAs?: string): Routine => {
      const routine = { ...input, id: `r${++nextId}`, enabled: input.enabled !== false, ...(runAs ? { runAs } : {}) } as unknown as Routine;
      routines.push(routine);
      return routine;
    },
    update: (id: string, patch: Partial<RoutineInput>): Routine | null => {
      const routine = routines.find((row) => row.id === id);
      if (!routine) return null;
      Object.assign(routine, patch);
      return routine;
    },
  };
  const deps: FlowWatchesDeps = {
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
    routines: () => manager,
    evaluate: (routine, precheck) => evaluate(routine, precheck),
    forgetState: (routineId) => states.forget(routineId),
    log: (_bot, line) => logs.push(line),
    pause: (botId, _person, domain, cause) => pauses.push({ botId, domain, cause }),
    memory: opts.memory ?? new WatchMemory(),
    now: opts.now ?? (() => clock),
  };
  const watches = new FlowWatches(deps);
  /** The routines' code checks, as the scheduler runs them. */
  const check = async (): Promise<void> => {
    for (const routine of routines.filter((row) => row.enabled && (row.precheck as { check?: string } | undefined)?.check === FLOW_WATCH_CHECK)) {
      let verdict: RoutinePrecheckVerdict;
      try {
        verdict = await watches.check(routine);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        continue;
      }
      if (verdict.wake) woken.push({ routineId: routine.id, botId: routine.botId, runAs: routine.runAs, name: routine.name, prompt: routine.prompt, note: verdict.note ?? "" });
    }
  };
  return {
    watches, woken, failures, logs, calls, helperCalls, pauses, choices, routines,
    /** One pass: every person's routines follow their choices, then the checks run. */
    pass: async () => {
      for (const row of new Set([...choices.map((choice) => choice.person), ...deps.memory.people()])) await watches.sync(row);
      await check();
    },
    check,
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
  it("reads the cadences of the Flow contract", () => {
    expect(parseCadence("15m")).toEqual({ kind: "every", ms: 900_000 });
    expect(parseCadence("1h")).toEqual({ kind: "every", ms: 3_600_000 });
    expect(parseCadence("daily@16:00")).toEqual({ kind: "daily", minutes: 960 });
    expect(parseCadence("weekly:fri@10:00")).toEqual({ kind: "weekly", day: 5, minutes: 600 });
  });

  it("#4250: is the schedule of the watch's routine: an interval, else a daily or weekly time in the tenant's zone", () => {
    expect(cadenceSchedule(parseCadence("15m")!, ZONE, MONDAY_15H)).toEqual({ type: "interval", everyMinutes: 15, anchorAt: MONDAY_15H });
    // the routine bounds: 5 minutes to a day
    expect(cadenceSchedule(parseCadence("1m")!, ZONE, MONDAY_15H)).toMatchObject({ everyMinutes: 5 });
    expect(cadenceSchedule(parseCadence("48h")!, ZONE, MONDAY_15H)).toMatchObject({ everyMinutes: 1_440 });
    expect(cadenceSchedule(parseCadence("daily@16:05")!, ZONE, MONDAY_15H)).toEqual({ type: "cron", expression: "5 16 * * *", timeZone: ZONE });
    expect(cadenceSchedule(parseCadence("weekly:fri@10:00")!, ZONE, MONDAY_15H)).toEqual({ type: "cron", expression: "0 10 * * 5", timeZone: ZONE });
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

describe("the watches walk the person's choices (#3423)", () => {
  it("a bot as the real store makes it (a stored proactive) and no choice: no routine, no session, no helper call, no read", async () => {
    const h = harness({ mode: "proactive", choices: [] });
    await h.pass();
    h.advance(60 * 60_000);
    await h.pass();
    expect(h.routines).toEqual([]);
    expect(h.sessions()).toBe(0);
    expect(h.helperCalls).toEqual([]);
    expect(h.calls).toEqual([]);
    expect(h.woken).toEqual([]);
  });
});

describe("#4250: a chosen watch is a routine of the carrying bot", () => {
  it("the routine: the watch's summary and consigne, its cadence, the code check, as the person; listed like any routine", async () => {
    const h = harness();
    await h.watches.sync("person-1");
    expect(h.routines).toHaveLength(1);
    expect(h.routines[0]).toMatchObject({
      name: "Open tickets.", botId: "b1", runAs: "person-1", enabled: true, overlap: "skip",
      schedule: { type: "interval", everyMinutes: 15 },
      precheck: { kind: "code", check: "flow_watch" },
    });
    expect(h.routines[0]!.prompt).toContain("Use reporting-x on the open tickets.");
    expect(h.routines[0]!.prompt).toContain("Proposed step: skill reporting-x.");
    expect(watchRoutineInput("b1", watch({ cadence: "daily@07:30" }), ZONE, MONDAY_15H).schedule).toEqual({ type: "cron", expression: "30 7 * * *", timeZone: ZONE });
  });

  it("a second sync makes no second routine", async () => {
    const h = harness();
    await h.watches.sync("person-1");
    await h.watches.sync("person-1");
    await h.watches.syncAll();
    expect(h.routines).toHaveLength(1);
  });

  it("a watch switched off, or its domain turned off, pauses its routine; the yes again turns it back on", async () => {
    const h = harness();
    await h.pass();
    h.choices[0]!.domains[0]!.watchesOff = ["w-open"];
    await h.pass();
    expect(h.routines[0]!.enabled).toBe(false);
    h.choices[0]!.domains[0]!.watchesOff = [];
    await h.pass();
    expect(h.routines).toHaveLength(1);
    expect(h.routines[0]!.enabled).toBe(true);
    h.choices.splice(0);
    await h.pass();
    expect(h.routines[0]!.enabled).toBe(false);
  });

  it("a routine the person paused or deleted after their yes stays so", async () => {
    const h = harness();
    await h.pass();
    h.routines[0]!.enabled = false;
    await h.pass();
    expect(h.routines[0]!.enabled).toBe(false);
    h.routines.splice(0);
    await h.pass();
    expect(h.routines).toEqual([]);
  });

  it("a domain that cannot be read now keeps its routines as they are", async () => {
    const h = harness({ observed: { items: [] } });
    await h.pass();
    h.setAccess(false);
    h.advance(25 * 60 * 60_000);
    await h.pass();
    expect(h.routines[0]!.enabled).toBe(true);
  });

  it("there is no watch loop and no timer of its own", () => {
    expect(Object.getOwnPropertyNames(FlowWatches.prototype)).not.toContain("tick");
  });
});

describe("the watch routines", () => {
  it("a chosen domain fires its watch into the carrying bot's routine run, as the person", async () => {
    const h = harness();
    await h.pass();
    expect(h.helperCalls).toContainEqual(["connectwise"]);
    expect(h.calls.map((call) => call.name)).toEqual(["cw_psa_service_query"]);
    expect(h.woken).toHaveLength(1);
    expect(h.woken[0]).toMatchObject({ botId: "b1", runAs: "person-1", name: "Open tickets." });
    // what the watch read reaches the run as data
    expect(h.woken[0]!.note).toContain("Watched: the result of the tool cw_psa_service_query");
  });

  it("one domain is carried by the one bot the person named: one routine, one run, once (#3394)", async () => {
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
    await h.pass();
    const woken = (owner: string) => h.woken.filter((row) => row.runAs === owner).map((row) => row.botId);
    expect(woken("person-1")).toEqual(["coder-1"]);
    // another person's choice is theirs (person isolation)
    expect(woken("person-2")).toEqual(["other"]);
    h.advance(15 * 60_000);
    await h.pass();
    expect(woken("person-1")).toEqual(["coder-1"]);
  });

  it("a chosen watch passes the switch: a carrying bot whose switch is off still observes", async () => {
    const h = harness({ mode: "off" });
    await h.pass();
    expect(h.calls.map((call) => call.name)).toEqual(["cw_psa_service_query"]);
    expect(h.woken).toHaveLength(1);
  });

  it("a domain not chosen, or a watch switched off inside it, is never observed", async () => {
    const other = harness({ watches: [watch({ domain: "finance" })] });
    await other.pass();
    expect(other.calls.filter((call) => call.name === "cw_psa_service_query")).toEqual([]);
    expect(other.woken).toEqual([]);
    expect(other.routines).toEqual([]);
    const off = harness({ choices: [{ person: "person-1", domains: [{ domain: "service", botId: "b1", watchesOff: ["w-open"] }] }] });
    await off.pass();
    expect(off.calls.filter((call) => call.name === "cw_psa_service_query")).toEqual([]);
    expect(off.woken).toEqual([]);
    // switched off on purpose is no pause
    expect(off.pauses).toEqual([]);
  });

  it("a watch runs only when the connection serves every product it names", async () => {
    const skills = () => new Set(["reporting-x"]);
    expect(watchesForBot([watch({ products: ["connectwise", "sentinelone"] })], { products: ["connectwise"], skills })).toEqual([]);
    expect(watchesForBot([watch({ products: ["connectwise", "sentinelone"] })], { products: ["connectwise", "sentinelone"], skills })).toHaveLength(1);
    const h = harness({ watches: [watch({ products: ["connectwise", "sentinelone"] })] });
    await h.pass();
    expect(h.calls.filter((call) => call.name === "cw_psa_service_query")).toEqual([]);
    expect(h.pauses).toEqual([{ botId: "b1", domain: "service", cause: "no-watch" }]);
  });

  it("a watch whose skill the bot lacks never runs; the domain pauses once, in the bot's chat", async () => {
    const h = harness({ skills: [] });
    await h.pass();
    h.advance(15 * 60_000);
    await h.pass();
    expect(h.calls.filter((call) => call.name === "cw_psa_service_query")).toEqual([]);
    expect(h.woken).toEqual([]);
    expect(h.pauses).toEqual([{ botId: "b1", domain: "service", cause: "no-watch" }]);
  });

  it("a carrying bot that is gone or no longer the person's pauses, with its cause, once", async () => {
    const gone = harness({ choices: [{ person: "person-1", domains: [{ domain: "service", botId: "deleted" }] }] });
    await gone.pass();
    await gone.pass();
    expect(gone.pauses).toEqual([{ botId: "deleted", domain: "service", cause: "bot-gone" }]);
    expect(gone.sessions()).toBe(0);
    const foreign = harness({ choices: [{ person: "person-2", domains: [{ domain: "service", botId: "b1" }] }] });
    await foreign.pass();
    expect(foreign.pauses).toEqual([{ botId: "b1", domain: "service", cause: "bot-not-eligible" }]);
    expect(foreign.sessions()).toBe(0);
    expect(foreign.woken).toEqual([]);
    expect(foreign.routines).toEqual([]);
  });

  it("a paused domain resumes by itself, and a later pause is told again", async () => {
    const skills: string[] = [];
    const h = harness({ skills });
    await h.pass();
    expect(h.pauses).toHaveLength(1);
    skills.push("reporting-x");
    h.advance(15 * 60_000);
    await h.pass();
    expect(h.woken).toHaveLength(1);
    skills.length = 0;
    h.advance(15 * 60_000);
    await h.pass();
    expect(h.pauses).toHaveLength(2);
  });

  it("a chosen domain the organization's Flow does not have pauses with a line, never in silence", async () => {
    // "backups" chosen where Flow has "service" (and a product is served)
    const h = harness({ choices: [{ person: "person-1", domains: [{ domain: "backups", botId: "b1" }] }] });
    await h.pass();
    await h.pass();
    expect(h.pauses).toEqual([{ botId: "b1", domain: "backups", cause: "unknown-domain" }]);
    expect(h.woken).toEqual([]);
  });

  it("a chosen domain whose watches all need a product the person lacks pauses, even when the helper filters by product", async () => {
    const h = harness({ watches: [watch({ products: ["sentinelone"] }), watch({ id: "w-other", domain: "finance" })] });
    await h.pass();
    expect(h.pauses).toEqual([{ botId: "b1", domain: "service", cause: "no-watch" }]);
  });

  it("lists the domains a person can choose: label, watches with summary and cadence, and whether each runs here", async () => {
    const h = harness({
      skills: ["reporting-x"],
      watches: [watch(), watch({ id: "w-s1", domain: "security", products: ["sentinelone"] }), watch({ id: "w-sk", domain: "dispatch", skill: "absent-skill" })],
    });
    const listing = await h.watches.offered("person-1", "b1");
    expect(listing).toMatchObject({ ok: true, botId: "b1" });
    if (!listing.ok) throw new Error("not listed");
    expect(listing.domains.map((row) => [row.domain, row.eligible])).toEqual([["dispatch", false], ["security", false], ["service", true]]);
    expect(listing.domains.find((row) => row.domain === "service")?.watches).toEqual([
      // #3431: the tools it reads with (here its observe tool), for the card's details
      { id: "w-open", summary: "Open tickets.", cadence: "15m", products: ["connectwise"], runs: true, tools: ["cw_psa_service_query"] },
    ]);
    expect(listing.domains.find((row) => row.domain === "security")?.watches[0]).toMatchObject({ runs: false, missing: "product", lacking: ["sentinelone"] });
    expect(listing.domains.find((row) => row.domain === "dispatch")?.watches[0]).toMatchObject({ runs: false, missing: "skill", lacking: ["absent-skill"] });
    expect(await h.watches.offered("person-2", "b1")).toEqual({ ok: false, botId: "b1", cause: "bot-not-eligible" });
    // asked, not ambient: no observe call
    expect(h.calls.filter((call) => call.name === "cw_psa_service_query")).toEqual([]);
  });

  it("#3408: a team member's bot without the dispatch skill is never offered a dispatch watch, nor woken by one", async () => {
    const dispatch = watch({ id: "w-dispatch", domain: "dispatch", skill: "dispatch-x" });
    const h = harness({ skills: ["reporting-x"], watches: [watch(), dispatch], choices: [{ person: "person-1", domains: [{ domain: "dispatch", botId: "b1" }] }] });
    const listing = await h.watches.offered("person-1", "b1");
    if (!listing.ok) throw new Error("not listed");
    expect(listing.domains.find((row) => row.domain === "dispatch")).toMatchObject({ eligible: false });
    await h.pass();
    expect(h.woken).toEqual([]);
    expect(h.calls).toEqual([]);
    expect(h.routines).toEqual([]);
  });

  it("#3408: a watch whose read the person's connection cannot run is never offered", async () => {
    const h = harness({
      watches: [
        watch(),
        watch({ id: "w-unserved", domain: "billing", observe: { tool: "cw_psa_finance_query", args: {} } }),
        watch({ id: "w-writer", domain: "changes", observe: { tool: "cw_psa_service_write", args: {} } }),
      ],
    });
    const listing = await h.watches.offered("person-1", "b1");
    if (!listing.ok) throw new Error("not listed");
    expect(listing.domains.map((row) => [row.domain, row.eligible])).toEqual([["billing", false], ["changes", false], ["service", true]]);
    expect(listing.domains.find((row) => row.domain === "billing")?.watches[0]).toMatchObject({ runs: false, missing: "read", lacking: ["cw_psa_finance_query"] });
    expect(listing.domains.find((row) => row.domain === "changes")?.watches[0]).toMatchObject({ runs: false, missing: "read", lacking: ["cw_psa_service_write"] });
    // the connection is opened once for the products and the reads together
    expect(h.sessions()).toBe(1);
  });

  it("#3408: a chosen watch whose read the connection cannot run never reaches the bot: no routine, no call, no skip line, the domain pauses once", async () => {
    const h = harness({ watches: [watch({ observe: { tool: "cw_psa_finance_query", args: {} } })] });
    await h.pass();
    h.advance(WATCH_RELOAD_MS);
    await h.pass();
    expect(h.routines).toEqual([]);
    expect(h.calls).toEqual([]);
    expect(h.woken).toEqual([]);
    expect(h.logs.filter((line) => line.includes("skipped"))).toEqual([]);
    expect(h.pauses).toEqual([{ botId: "b1", domain: "service", cause: "no-watch" }]);
  });

  it("#3408: the loop and the listing say the same of a watch: one filter, products, skill and read together", async () => {
    const reads = { tools: new Set(["cw_psa_service_query"]), readOnly: new Set(["cw_psa_service_query"]) };
    const skills = new Set(["reporting-x"]);
    const run = (candidate: FlowWatch) => watchesForBot([candidate], { products: ["connectwise"], skills: () => skills, reads });
    expect(run(watch())).toHaveLength(1);
    expect(run(watch({ products: ["connectwise", "sentinelone"] }))).toEqual([]);
    expect(run(watch({ skill: "dispatch-x" }))).toEqual([]);
    expect(run(watch({ observe: { tool: "cw_psa_finance_query", args: {} } }))).toEqual([]);
    expect(watchMissing(watch({ skill: "dispatch-x" }), { products: ["connectwise"], skills: () => skills, reads })).toEqual({ missing: "skill", lacking: ["dispatch-x"] });
  });

  it("two bots of one person both eligible for a domain: the one the person chose carries it, the other is never woken (#3394)", async () => {
    const h = harness({
      bots: [{ id: "b1", owner: "person-1" }, { id: "b2", owner: "person-1" }],
      choices: [{ person: "person-1", domains: [{ domain: "service", botId: "b2" }] }],
    });
    await h.pass();
    expect(h.routines.map((row) => row.botId)).toEqual(["b2"]);
    expect(h.woken.map((event) => event.botId)).toEqual(["b2"]);
  });

  it("the person's products are read once a day, not every hour", async () => {
    const h = harness({ observed: { items: [] } });
    await h.pass();
    for (let hour = 0; hour < 5; hour += 1) {
      h.advance(60 * 60_000);
      await h.pass();
    }
    expect(h.apiReads()).toBe(1);
    h.advance(24 * 60 * 60_000);
    await h.pass();
    expect(h.apiReads()).toBe(2);
  });

  it("the domain moved to another bot: the routine moves with it, the old one pauses", async () => {
    const h = harness({ bots: [{ id: "b1", owner: "person-1" }, { id: "b2", owner: "person-1" }] });
    await h.pass();
    expect(h.woken.map((row) => row.botId)).toEqual(["b1"]);
    h.choices[0]!.domains[0]!.botId = "b2";
    h.advance(15 * 60_000);
    await h.pass();
    expect(h.routines.map((row) => [row.botId, row.enabled])).toEqual([["b1", false], ["b2", true]]);
  });

  it("the domain's label falls back to a readable name from its slug, never the raw slug (#3513)", async () => {
    const listing = parseWatchListing(JSON.stringify({ watches: [watch()], domains: { service: { label: { fr: "Service", en: "Service desk" } } } }));
    expect(domainLabel(listing, "service", "en")).toBe("Service desk");
    expect(domainLabel(listing, "finance", "fr")).toBe("Finance");
    expect(domainLabel(undefined, "backup-health", "en")).toBe("Backup health");
    expect(readableName("tailscale_audit.devices")).toBe("Tailscale audit devices");
    const h = harness({ watches: [watch({ domain: "backup-health" })] });
    const offered = await h.watches.offered("person-1", "b1");
    expect(offered.ok && offered.domains[0]?.label).toEqual({ en: "Backup health" });
  });

  it("a false condition starts nothing", async () => {
    const h = harness({ observed: { items: [] } });
    await h.pass();
    expect(h.calls.map((call) => call.name)).toContain("cw_psa_service_query");
    expect(h.woken).toEqual([]);
  });

  it("dedup: a condition still true with the same key does not fire again; false then true does", async () => {
    const observed: { items: unknown[] } = { items: [{ id: 1 }] };
    const h = harness({ observed });
    await h.pass();
    expect(h.woken).toHaveLength(1);
    h.advance(15 * 60_000);
    await h.check();
    expect(h.woken).toHaveLength(1);
    observed.items = [];
    h.advance(15 * 60_000);
    await h.check();
    expect(h.woken).toHaveLength(1);
    observed.items = [{ id: 1 }];
    h.advance(15 * 60_000);
    await h.check();
    expect(h.woken).toHaveLength(2);
  });

  it("#3432: a watch that starts its routine's run is the person's last alert, kept on disk; a quiet one is not", async () => {
    const dir = tempDir("watch-alert-");
    const memory = new WatchMemory(join(dir, "memory.json"));
    const h = harness({ memory });
    expect(h.watches.lastAlert("person-1", "w-open")).toBeUndefined();
    await h.pass();
    const first = h.watches.lastAlert("Person-1 ", "w-open");
    expect(first).toBe(MONDAY_15H);
    expect(new WatchMemory(join(dir, "memory.json")).get("person-1", "w-open").alertAt).toBe(first);
    const quiet = harness({ observed: { items: [] } });
    await quiet.pass();
    expect(quiet.watches.lastAlert("person-1", "w-open")).toBeUndefined();
  });

  // #3408 changed it on purpose: a watch whose observe is not a read never
  // reaches the bot (it was a skip line each cadence); its domain pauses once
  it("an observe that is not a read never runs: the domain pauses", async () => {
    const h = harness({ watches: [watch({ observe: { tool: "cw_psa_service_write", args: {} } })] });
    await h.pass();
    expect(h.calls.map((call) => call.name)).not.toContain("cw_psa_service_write");
    expect(h.pauses).toEqual([{ botId: "b1", domain: "service", cause: "no-watch" }]);
    expect(h.woken).toEqual([]);
  });

  it("a token the tenant does not set skips the watch: no call with a raw template", async () => {
    const h = harness({ watches: [watch({ observe: { tool: "cw_psa_service_query", args: { owner: "{{fact:team.operator_login}}" } } })] });
    await h.pass();
    expect(h.calls.map((call) => call.name)).not.toContain("cw_psa_service_query");
    expect(h.logs.join("\n")).toContain("{{fact:team.operator_login}}");
  });

  it("facts and dates are resolved before the observe call", async () => {
    const facts = "| Field | Value |\n| --- | --- |\n| operator_login | `pat` |\n";
    const h = harness({ facts, watches: [watch({ observe: { tool: "cw_psa_service_query", args: { owner: "{{fact:team.operator_login}}", since: "{{days_ago:1}}" } } })] });
    await h.pass();
    const call = h.calls.find((row) => row.name === "cw_psa_service_query");
    expect(call?.args).toEqual({ owner: "pat", since: "2026-11-08T00:00:00" });
  });

  it("a date that moves with the day keeps the condition: the same tickets do not fire again tomorrow", async () => {
    const h = harness({ watches: [watch({ observe: { tool: "cw_psa_service_query", args: { since: "{{days_ago:1}}" } } })] });
    await h.pass();
    h.advance(24 * 60 * 60_000);
    await h.check();
    expect(h.calls).toHaveLength(2);
    expect(h.woken).toHaveLength(1);
  });

  it("a read that fails fails the routine's check, as any routine's, and starts no run", async () => {
    const h = harness({ observed: { items: [] } });
    await h.pass();
    h.setAccess(false);
    h.advance(15 * 60_000);
    await h.check();
    expect(h.failures.join("\n")).toContain("Perspicax is not available");
    expect(h.woken).toEqual([]);
  });

  it("a skipped watch posts its line once per cause, then stays silent until the cause changes (#3140)", async () => {
    const unresolved = watch({ observe: { tool: "cw_psa_service_query", args: { owner: "{{fact:team.operator_login}}" } } });
    const h = harness({ watches: [unresolved] });
    await h.pass();
    h.advance(15 * 60_000);
    await h.check();
    h.advance(15 * 60_000);
    await h.check();
    expect(h.logs.filter((line) => line.includes("w-open skipped"))).toHaveLength(1);
  });

  it("a pending watch wake of a server before #4250 still reads from disk (#3140)", () => {
    const dir = tempDir("watch-pending-");
    new ProactivePendingFile(join(dir, "pending.json")).set("b1", [{ botId: "b1", source: "watch", key: "watch:w-open:k", label: "x", summary: "x", detail: "x", hops: 0, replay: { kind: "watch", watchId: "w-open" } }]);
    expect(new ProactivePendingFile(join(dir, "pending.json")).take()).toEqual([{ botId: "b1", key: "watch:w-open:k", ref: { kind: "watch", watchId: "w-open" } }]);
  });

  it("a replayed watch reads its condition as new at its routine's next check and fires again, even across a restart (#3140)", async () => {
    const dir = tempDir("watch-memory-");
    const file = join(dir, "watches.json");
    const states = join(dir, "states");
    const first = harness({ memory: new WatchMemory(file), states });
    await first.pass();
    expect(first.woken).toHaveLength(1);
    // the server restarts: the same routines, the memory and states on disk
    const second = harness({ memory: new WatchMemory(file), states });
    second.routines.push(...first.routines);
    second.advance(15 * 60_000);
    await second.check();
    expect(second.woken).toHaveLength(0);
    second.watches.replay("b1", "w-open");
    second.advance(15 * 60_000);
    await second.check();
    expect(second.woken).toHaveLength(1);
  });

  it("#4250: a condition the loop before the upgrade already told stays told: the routine's first check wakes nothing; a new key wakes", async () => {
    const ids = watch({ when: "items[].id" });
    const told = evaluateWhen(ids.when, { items: [{ id: 1 }] }).key;
    const upgraded = (observed: unknown) => {
      const file = join(tempDir("watch-upgrade-"), "watches.json");
      writeFileSync(file, JSON.stringify({ version: 2, people: { "person-1": { "w-open": { last: MONDAY_15H - 60 * 60_000, fired: told } } }, pauses: {} }));
      return harness({ watches: [ids], observed, memory: new WatchMemory(file) });
    };
    const same = upgraded({ items: [{ id: 1 }] });
    await same.pass();
    expect(same.calls.map((call) => call.name)).toEqual(["cw_psa_service_query"]);
    expect(same.woken).toEqual([]);
    same.advance(15 * 60_000);
    await same.check();
    expect(same.woken).toEqual([]);
    const moved = upgraded({ items: [{ id: 1 }, { id: 2 }] });
    await moved.pass();
    expect(moved.woken).toHaveLength(1);
  });

  it("the watch memory stays readable by a server before #4250: version 2, its fields where they were", () => {
    const dir = tempDir("watch-file-");
    const file = join(dir, "watches.json");
    const memory = new WatchMemory(file);
    memory.alerted("person-1", "w-open", 5);
    memory.link("person-1", "w-open", { routine: "r1", botId: "b1", domain: "service", cadence: "15m" });
    memory.save();
    const raw = JSON.parse(readFileSync(file, "utf8")) as { version: number; people: Record<string, Record<string, { alertAt?: number }>> };
    expect(raw.version).toBe(2);
    expect(raw.people["person-1"]!["w-open"]!.alertAt).toBe(5);
    expect(new WatchMemory(file).byRoutine("r1")).toMatchObject({ person: "person-1", watchId: "w-open" });
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
      const listing = await h.watches.offered("person-1", `b${index}`);
      expect(listing.ok).toBe(true);
      if (listing.ok) expect(listing.domains[0]!.watches.filter((row) => row.missing === "skill")).toHaveLength(WATCHES / 2);
    }
    expect(h.inventories()).toBeLessThanOrEqual(BOTS);
  });

  it("the sync of a chosen domain reads the bot's skills once, not once per watch", async () => {
    const h = harness({ watches: many() });
    await h.watches.sync("person-1");
    expect(h.inventories()).toBe(1);
  });
});

describe("#4250: the watch routines follow Flow within the hour", () => {
  it("a watch the organization adds to a chosen domain becomes a routine at the next hourly pass, not before", async () => {
    const watches: unknown[] = [watch()];
    const h = harness({ watches });
    await h.watches.syncAll();
    expect(h.routines).toHaveLength(1);
    watches.push(watch({ id: "w-late", summary: "Late tickets." }));
    h.advance(61 * 60_000);
    await h.watches.syncStale();
    // the listing is cached an hour: read again now
    expect(h.routines.map((row) => row.name)).toEqual(["Open tickets.", "Late tickets."]);
    await h.watches.syncStale();
    expect(h.routines).toHaveLength(2);
  });
});
