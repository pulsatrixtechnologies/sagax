// #3612: the marketplaces with an installed plugin are pulled in the
// background (the existing refresh), so the existing updateAvailable is true
// without anyone pressing Update.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MARKETPLACE_REFRESH_FIRST_DELAY_MS,
  MARKETPLACE_REFRESH_INTERVAL_MS,
  MARKETPLACE_REFRESH_SPREAD_MS,
  type MarketplacePullScope,
  PluginMarketplaces,
  pickMarketplacePullScope,
  startMarketplaceBackgroundRefresh,
} from "./plugin-marketplaces.ts";

const DAY = MARKETPLACE_REFRESH_INTERVAL_MS;
/** past the first run whatever the spread drew */
const AFTER_FIRST = MARKETPLACE_REFRESH_FIRST_DELAY_MS + MARKETPLACE_REFRESH_SPREAD_MS + 10 * 60_000;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sagax-market-bg-"));
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

const bot = (owner: string): MarketplacePullScope => ({ kind: "bot", id: `bot-${owner}`, owner });

function schedule(scopes: Record<string, MarketplacePullScope[]>, pull: (name: string, scope: MarketplacePullScope) => Promise<unknown>, extra: { random?: () => number; log?: (line: string) => void } = {}) {
  return startMarketplaceBackgroundRefresh({
    marketplaces: () => Object.keys(scopes),
    record: () => ({ visibility: "org" as const }),
    scopes: (name) => scopes[name] ?? [],
    pull,
    log: extra.log ?? (() => undefined),
    ...(extra.random ? { random: extra.random } : {}),
  });
}

describe("background pull of the marketplaces with an installed plugin", () => {
  it("runs no earlier than 5 minutes after start, even at the lowest spread draw", async () => {
    const pulled: string[] = [];
    const job = schedule({ used: [bot("p1")] }, async (name) => { pulled.push(name); }, { random: () => 0 });
    expect(MARKETPLACE_REFRESH_FIRST_DELAY_MS).toBeGreaterThanOrEqual(5 * 60_000);
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expect(pulled).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pulled).toEqual(["used"]);
    job.stop();
  });

  it("pulls after start and after a day the marketplace with an installed plugin, never the one without", async () => {
    const pulled: string[] = [];
    const job = schedule({ used: [bot("p1")], unused: [] }, async (name) => { pulled.push(name); });
    await vi.advanceTimersByTimeAsync(AFTER_FIRST);
    expect(pulled).toEqual(["used"]);
    await vi.advanceTimersByTimeAsync(DAY + MARKETPLACE_REFRESH_SPREAD_MS + 10 * 60_000);
    expect(pulled).toEqual(["used", "used"]);
    job.stop();
  });

  it("spreads the start: two installations do not pull at the same instant", async () => {
    const times: number[] = [];
    const a = schedule({ one: [bot("p1")] }, async () => { times.push(Date.now()); }, { random: () => 0.1 });
    const b = schedule({ one: [bot("p1")] }, async () => { times.push(Date.now()); }, { random: () => 0.9 });
    await vi.advanceTimersByTimeAsync(AFTER_FIRST);
    expect(times).toHaveLength(2);
    expect(times[0]).not.toBe(times[1]);
    a.stop();
    b.stop();
  });

  it("logs a failed pull in one line, never throws, and goes on to the next one", async () => {
    const pulled: string[] = [];
    const lines: string[] = [];
    const job = schedule({ broken: [bot("p1")], fine: [bot("p1")] }, async (name) => {
      pulled.push(name);
      if (name === "broken") throw new Error("The repository could not be reached from the server.");
    }, { log: (line) => lines.push(line) });
    await vi.advanceTimersByTimeAsync(AFTER_FIRST);
    expect(pulled).toEqual(["broken", "fine"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("broken");
    expect(lines[0]).not.toContain("\n");
    job.stop();
  });

  it("gives up on a pull that hangs and goes on", async () => {
    const pulled: string[] = [];
    const lines: string[] = [];
    const job = schedule({ stuck: [bot("p1")], fine: [bot("p1")] }, (name) => {
      pulled.push(name);
      return name === "stuck" ? new Promise(() => undefined) : Promise.resolve();
    }, { log: (line) => lines.push(line) });
    await vi.advanceTimersByTimeAsync(AFTER_FIRST);
    expect(pulled).toEqual(["stuck", "fine"]);
    expect(lines[0]).toMatch(/stuck/);
    job.stop();
  });

  it("pulls one marketplace at a time", async () => {
    let running = 0;
    let most = 0;
    const job = schedule({ a: [bot("p1")], b: [bot("p1")], c: [bot("p1")] }, async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      running--;
    });
    await vi.advanceTimersByTimeAsync(AFTER_FIRST);
    expect(most).toBe(1);
    job.stop();
  });

  it("runs nothing after stop (shutdown)", async () => {
    const pulled: string[] = [];
    const job = schedule({ used: [bot("p1")] }, async (name) => { pulled.push(name); });
    job.stop();
    await vi.advanceTimersByTimeAsync(AFTER_FIRST + 3 * DAY);
    expect(pulled).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops between two marketplaces when stopped during a run", async () => {
    const pulled: string[] = [];
    let job: ReturnType<typeof schedule> | undefined;
    job = schedule({ first: [bot("p1")], second: [bot("p1")] }, async (name) => { pulled.push(name); job?.stop(); });
    await vi.advanceTimersByTimeAsync(AFTER_FIRST + DAY * 2);
    expect(pulled).toEqual(["first"]);
  });
});

describe("whose credentials a background pull uses", () => {
  const scopes: MarketplacePullScope[] = [bot("other"), { kind: "person", id: "author", owner: "author" }];

  it("pulls a private marketplace only as its author", () => {
    expect(pickMarketplacePullScope({ visibility: "private", addedBy: "author" }, scopes, false)).toEqual(scopes[1]);
    expect(pickMarketplacePullScope({ visibility: "private", addedBy: "author" }, [bot("other")], false)).toBeUndefined();
    expect(pickMarketplacePullScope({ visibility: "private" }, [bot("other")], false)).toBeUndefined();
  });

  it("pulls an org-wide one through the installation scope first, then any holder", () => {
    const installation: MarketplacePullScope = { kind: "installation", id: "installation", owner: "admin" };
    expect(pickMarketplacePullScope({ visibility: "org" }, [...scopes, installation], false)).toEqual(installation);
    expect(pickMarketplacePullScope({ visibility: "org" }, scopes, false)).toEqual(scopes[0]);
  });

  it("on a server of one person, any holder pulls", () => {
    expect(pickMarketplacePullScope({ visibility: "private" }, [bot("other")], true)).toEqual(bot("other"));
  });

  it("does not pull a private marketplace for another person's bot", async () => {
    const pulled: string[] = [];
    const job = startMarketplaceBackgroundRefresh({
      marketplaces: () => ["mine"],
      record: () => ({ visibility: "private", addedBy: "author" }),
      scopes: () => [bot("other")],
      pull: async (name) => { pulled.push(name); },
      log: () => undefined,
    });
    await vi.advanceTimersByTimeAsync(AFTER_FIRST);
    expect(pulled).toEqual([]);
    job.stop();
  });
});

describe("the existing badge without a click", () => {
  it("updateAvailable becomes true from the background pull alone", async () => {
    const source = join(dir, "repo");
    const manifest = (version: string) => ({
      name: "devjc",
      owner: { name: "Acme" },
      plugins: [{ name: "notes", source: "./plugins/notes", version }],
    });
    const write = (version: string) => {
      mkdirSync(join(source, ".claude-plugin"), { recursive: true });
      mkdirSync(join(source, "plugins/notes/.claude-plugin"), { recursive: true });
      writeFileSync(join(source, ".claude-plugin/marketplace.json"), JSON.stringify(manifest(version)));
      writeFileSync(join(source, "plugins/notes/.claude-plugin/plugin.json"), JSON.stringify({ name: "notes", version }));
    };
    write("1.0.0");
    let clock = 1_000;
    const markets = new PluginMarketplaces({
      dataDir: join(dir, "data"),
      gitEnvironment: () => ({}),
      policy: () => undefined,
      now: () => clock++,
      git: async (args) => { cpSync(source, args.at(-1)!, { recursive: true }); },
    });
    vi.useRealTimers();
    await markets.add({ source: "acme/marketplace" }, undefined, { visibility: "org" });
    const prepared = await markets.prepare("devjc", "notes", undefined);
    await markets.recordInstall("devjc", "notes", { version: prepared.version, revision: prepared.revision, servers: [], skills: [] });
    expect((await markets.list())[0]!.plugins[0]).not.toHaveProperty("updateAvailable");
    write("1.8.0");
    vi.useFakeTimers();

    const job = startMarketplaceBackgroundRefresh({
      marketplaces: () => markets.names(),
      record: (name) => markets.record(name),
      scopes: (name) => markets.installed().some((plugin) => plugin.marketplace === name) ? [{ kind: "installation", id: "installation" }] : [],
      pull: (name) => markets.pull(name, undefined),
      log: () => undefined,
    });
    await vi.advanceTimersByTimeAsync(AFTER_FIRST);
    job.stop();
    vi.useRealTimers();
    // the clone may still be finishing on real I/O
    await vi.waitFor(async () => expect((await markets.list())[0]!.plugins[0]).toMatchObject({ version: "1.8.0", installedVersion: "1.0.0", updateAvailable: true }));
    // the installed copy is untouched: updating stays the person's or the bot's act
    expect(markets.installed()[0]).toMatchObject({ version: "1.0.0" });
  });
});
