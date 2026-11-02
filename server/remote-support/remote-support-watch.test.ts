// #1499: Sagax notices by itself that the end user's computer joined a
// remote support session and connects it, with no message from the person.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createRemoteSessionRegistrar, type RegisteredOpen } from "./remote-session-register.ts";
import { handleRemoteSupportCall, recallSupportSession, type TailcatRun } from "./remote-support-local.ts";
import {
  createRemoteSupportWatcher,
  parseSupportCheck,
  WATCH_FAST_MS,
  WATCH_MAX_ERRORS,
  WATCH_SLOW_MS,
  type SupportCheck,
  type SupportWatchTarget,
} from "./remote-support-watch.ts";

const PUBLIC = `nodekey:${"cd".repeat(32)}`;
const ADDRESS = "tcExampleAddressValue12";
const NOW = new Date("2026-10-21T15:00:00.000Z");
const CODE = "K7QMNP";
const PERSON = "person-a";
const BOT = "bot-1";
const THREAD = "thread-1";
const OWNER = { principalId: PERSON, botId: BOT };

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sagax-watch-"));
  dirs.push(dir);
  return dir;
}

function fakeRun(pings: number[] = []) {
  const calls: string[][] = [];
  const run: TailcatRun = async (args) => {
    calls.push([...args]);
    if (args[0] === "genkey") {
      writeFileSync(String(args[3]), "{}\n", { mode: 0o600 });
      return { code: 0, stdout: `${PUBLIC}\n`, stderr: "" };
    }
    if (args.includes("ping")) return { code: pings.shift() ?? 0, stdout: "", stderr: "" };
    return { code: 1, stdout: "", stderr: "" };
  };
  return { calls, run };
}

/** A clock and a timer queue the test advances by hand. */
function manualClock() {
  let at = NOW.getTime();
  const timers: Array<{ due: number; run: () => void; live: boolean }> = [];
  return {
    now: () => at,
    schedule: (run: () => void, ms: number) => {
      const timer = { due: at + ms, run, live: true };
      timers.push(timer);
      return () => { timer.live = false; };
    },
    pending: () => timers.filter((timer) => timer.live).length,
    /** Run the next timer, then let its promise chain settle. */
    async step() {
      const next = timers.filter((timer) => timer.live).sort((a, b) => a.due - b.due)[0];
      if (!next) return false;
      next.live = false;
      at = Math.max(at, next.due);
      next.run();
      // the status call reads and writes the support folder: let it finish
      for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
      return true;
    },
  };
}

const text = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

describe("remote support watch", () => {
  it("connects and posts the card when the computer joins, without a status call from the bot", async () => {
    const dir = tempDir();
    const { calls, run } = fakeRun();
    const clock = manualClock();
    const published: RegisteredOpen[] = [];
    // what Perspicax answers, one status after the other: nobody ran the line
    // yet, the script was fetched, the computer posted its address
    const states: Array<Record<string, unknown>> = [
      { state: "waiting", fetch_ip_count: 0 },
      { state: "fetched", fetch_ip_count: 1 },
      { state: "started", fetch_ip_count: 1, address: ADDRESS },
    ];
    const statusCalls: Array<Record<string, unknown>> = [];
    const local = { dir, technicianName: "Ada", orgName: "Exemple", now: () => NOW, run, sessionId: () => "0123456789ab" };
    let watcher: ReturnType<typeof createRemoteSupportWatcher> | null = null;
    const registrar = createRemoteSessionRegistrar({
      publish: async ({ open }) => { published.push(open); },
      opened: ({ principalId, botId, threadId, open }) => watcher?.watch({ principalId, botId, threadId, code: open.code, endAt: open.endAt }),
      end: async ({ code }) => watcher?.stop(code),
      recall: (code) => recallSupportSession(dir, code),
      now: () => clock.now(),
    });
    // every call reaches Perspicax through the relay, which hands it to the registrar
    const post = async (tool: string, args: Record<string, unknown>) => {
      let body: Record<string, unknown> = {};
      if (tool === "remote_support_open") body = { code: CODE, page_url: `https://support.example.test/assist/${CODE}` };
      if (tool === "remote_support_status") {
        statusCalls.push(args);
        body = args.mark_connected === true ? { state: "connected", fetch_ip_count: 1 } : states.shift() ?? { state: "started", fetch_ip_count: 1 };
      }
      await registrar.observe({ threadId: THREAD, botId: BOT, principalId: PERSON, name: tool, args, result: text(body) });
      return { status: 200, body: { text: JSON.stringify(body), owner: OWNER } };
    };
    const checked: SupportWatchTarget[] = [];
    watcher = createRemoteSupportWatcher({
      check: async (target) => {
        checked.push(target);
        const answer = await handleRemoteSupportCall({ name: "remote_support_status", args: { code: target.code }, local, post });
        return parseSupportCheck(answer.text, answer.isError);
      },
      now: clock.now,
      schedule: clock.schedule,
    });

    // the bot opens; the person never says it is launched and the bot makes no status call
    const opened = await handleRemoteSupportCall({ name: "remote_support_open", args: {}, local, post });
    expect(opened.isError).toBeUndefined();
    expect(watcher.active()).toEqual([CODE]);

    await clock.step(); // waiting
    await clock.step(); // fetched
    expect(published).toEqual([]);
    await clock.step(); // started: ping with the session key, then mark connected
    expect(published).toHaveLength(1);
    expect(published[0]?.code).toBe(CODE);
    expect(statusCalls.at(-1)).toEqual({ code: CODE, mark_connected: true });
    expect(calls.some((args) => args.includes("ping") && args.includes(ADDRESS))).toBe(true);
    // the watch is over, in the opener's name, on the conversation it was opened in
    expect(watcher.active()).toEqual([]);
    expect(clock.pending()).toBe(0);
    expect(checked.every((target) => target.principalId === PERSON && target.botId === BOT && target.threadId === THREAD)).toBe(true);
  });

  it("stops when the code leaked, when the session is closed, after repeated failures, and at the end", async () => {
    const clock = manualClock();
    const answers: SupportCheck[] = [];
    const released: string[] = [];
    const watcher = createRemoteSupportWatcher({
      check: async () => answers.shift() ?? { state: "fetched" },
      release: (target) => { released.push(target.code); },
      now: clock.now,
      schedule: clock.schedule,
    });
    const target = { principalId: PERSON, botId: BOT, threadId: THREAD, code: "K7Q-MNP", endAt: new Date(NOW.getTime() + 2 * 3600_000).toISOString() };

    answers.push({ state: "fetched", refused: true });
    watcher.watch(target);
    await clock.step();
    expect(watcher.active()).toEqual([]);
    expect(released).toEqual([CODE]);

    watcher.watch(target);
    watcher.stop("k7q-mnp");
    expect(watcher.active()).toEqual([]);
    expect(clock.pending()).toBe(0);

    for (let i = 0; i < WATCH_MAX_ERRORS; i += 1) answers.push({ error: true });
    watcher.watch(target);
    for (let i = 0; i < WATCH_MAX_ERRORS; i += 1) await clock.step();
    expect(watcher.active()).toEqual([]);

    // a session that ends in 30 seconds is not watched past its end
    watcher.watch({ ...target, endAt: new Date(clock.now() + 30_000).toISOString() });
    let steps = 0;
    while (watcher.active().length && steps < 50) { await clock.step(); steps += 1; }
    expect(watcher.active()).toEqual([]);
    expect(steps).toBeLessThanOrEqual(Math.ceil(30_000 / WATCH_FAST_MS) + 1);
  });

  it("polls fast at first, then slower", async () => {
    const clock = manualClock();
    const at: number[] = [];
    const watcher = createRemoteSupportWatcher({
      check: async () => { at.push(clock.now()); return { state: "waiting" }; },
      now: clock.now,
      schedule: clock.schedule,
    });
    watcher.watch({ principalId: PERSON, botId: BOT, threadId: THREAD, code: CODE, endAt: new Date(NOW.getTime() + 3600_000).toISOString() });
    for (let i = 0; i < 60; i += 1) await clock.step();
    const gaps = at.slice(1).map((value, i) => value - at[i]!);
    expect(gaps[0]).toBe(WATCH_FAST_MS);
    expect(gaps.at(-1)).toBe(WATCH_SLOW_MS);
    watcher.stop(CODE);
  });

  it("reads a status answer: the JSON line, a refused technician side, an error", () => {
    expect(parseSupportCheck(`${JSON.stringify({ state: "connected" })}\nConnected. Sagax posts the session card.`)).toEqual({ state: "connected" });
    expect(parseSupportCheck(JSON.stringify({ state: "fetched", technician_side: "refused" }))).toEqual({ state: "fetched", refused: true });
    expect(parseSupportCheck("Perspicax refused the call.")).toEqual({ error: true });
    expect(parseSupportCheck(JSON.stringify({ state: "fetched" }), true)).toEqual({ error: true });
  });

  it("a started status without an address pings the address kept from the first one", async () => {
    const dir = tempDir();
    // the first ping fails (the tunnel was not up yet), the second answers
    const { calls, run } = fakeRun([1, 0]);
    const local = { dir, technicianName: "Ada", orgName: "Exemple", now: () => NOW, run, sessionId: () => "0123456789ab" };
    const answers: Array<Record<string, unknown>> = [
      { state: "started", fetch_ip_count: 1, address: ADDRESS },
      // Perspicax hands the address out once
      { state: "started", fetch_ip_count: 1, address: null },
    ];
    const posted: Array<Record<string, unknown>> = [];
    const post = async (tool: string, args: Record<string, unknown>) => {
      if (tool === "remote_support_open") return { status: 200, body: { owner: OWNER, text: JSON.stringify({ code: CODE, page_url: `https://support.example.test/assist/${CODE}` }) } };
      posted.push(args);
      const body = args.mark_connected === true ? { state: "connected", fetch_ip_count: 1 } : answers.shift() ?? {};
      return { status: 200, body: { owner: OWNER, text: JSON.stringify(body) } };
    };
    await handleRemoteSupportCall({ name: "remote_support_open", args: {}, local, post });
    const first = await handleRemoteSupportCall({ name: "remote_support_status", args: { code: CODE }, local, post });
    expect(first.text).toContain("\"technician_side\":\"failed\"");
    const second = await handleRemoteSupportCall({ name: "remote_support_status", args: { code: CODE }, local, post });
    expect(second.text).toContain("\"state\":\"connected\"");
    expect(second.text).not.toContain(ADDRESS);
    expect(calls.filter((args) => args.includes("ping") && args.includes(ADDRESS))).toHaveLength(2);
    expect(posted.at(-1)).toEqual({ code: CODE, mark_connected: true });
  });
});
