// Review of PR #939: a session Sagax opened belongs to the person (and the
// bot) who opened it. Its 12-hex id is visible in the chat card, so the id
// alone must never resolve the tunnel, publish a card, or recall a session.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { isTailcatAddress, parseRemoteSessionEnd, TAILCAT_ADDRESS_MAX } from "../shared/remote-session.ts";
import type { Message, Store } from "./store.ts";
import { TerminalResourceRegistry } from "./terminal-resources/registry.ts";
import { createRemoteSessionService } from "./remote-sessions.ts";
import { readSupportTunnel, readTunnel, type RunCommand } from "./remote-session-probe.ts";
import { createRemoteSessionRegistrar } from "./remote-session-register.ts";
import { createRemoteSessionInternalRoutes } from "./routes/remote-sessions.ts";
import { absorbStatus, handleRemoteSupportCall, recallSupportSession, rememberSession, type TailcatRun } from "./remote-support-local.ts";

const ADDRESS = "tcABCDEFGHJKMNPQRSTUVWXYZ234567890abcd";
const ID = "0123456789ab";
const CODE = "BQDHS7";
const A = "person-a";
const B = "person-b";
const BOT = "bot-1";
const BOT_B = "bot-2";
const THREAD = "thread-1";
const NOW = new Date("2026-10-21T15:00:00.000Z");
const END = "2026-10-21T17:00:00.000Z";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

const text = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

/** A support folder as remote_support_open leaves it, owned by `owner`. */
async function supportFolder(owner: { principalId?: string; botId?: string } = { principalId: A, botId: BOT }) {
  const dir = temp("sagax-support-");
  writeFileSync(path.join(dir, "technician.private.json"), "{}\n", { mode: 0o600 });
  await rememberSession(dir, CODE, ID, { rights: "standard", end_at: END, ...owner });
  writeFileSync(path.join(dir, "sessions", CODE, "address"), `${ADDRESS}\n`, { mode: 0o600 });
  return dir;
}

function fakeStore(messages: Message[]): Store {
  return {
    bot: (id: string) => ({ id, name: "Melonie", color: "#336699" }),
    appendMessage: (_thread: string, partial: Partial<Message>) => {
      const message = { id: `m${messages.length}`, at: 1, role: "bot", kind: "text", ...partial } as Message;
      messages.push(message);
      return message;
    },
    patchMessage: (_thread: string, id: string, patch: Partial<Message>) => {
      const row = messages.find((message) => message.id === id);
      if (row) Object.assign(row, patch);
      return row ?? null;
    },
  } as unknown as Store;
}

function service(supportDir: string, run: RunCommand, extra: Partial<Parameters<typeof createRemoteSessionService>[0]> = {}) {
  const messages: Message[] = [];
  const svc = createRemoteSessionService({
    dataDir: temp("sagax-data-"),
    supportDir: () => supportDir,
    store: fakeStore(messages),
    registry: new TerminalResourceRegistry(),
    sessions: { open: async () => ({ id: "term-1", status: "connecting" }) } as never,
    access: () => ({ organization: true, admin: false, ownsBot: true }),
    owner: () => A,
    run,
    home: () => temp("sagax-flow-"),
    ...extra,
  });
  return { svc, messages };
}

const quietRun: RunCommand = async () => ({ code: 0, stdout: "", stderr: "" });

describe("support tunnel ownership (finding 1)", () => {
  it("resolves the tunnel through the row's code folder, for its owner and bot only", async () => {
    const dir = await supportFolder();
    const row = { id: ID, code: CODE, principalId: A, botId: BOT };
    expect(readSupportTunnel(dir, row)).toEqual({ keyPath: path.join(dir, "technician.private.json"), address: ADDRESS });
    expect(readSupportTunnel(dir, { ...row, principalId: B })).toBeNull();
    expect(readSupportTunnel(dir, { ...row, botId: BOT_B })).toBeNull();
    expect(readSupportTunnel(dir, { ...row, code: "GVPZGU" })).toBeNull();
    expect(readSupportTunnel(dir, { ...row, id: "ffffffffffff" })).toBeNull();
    expect(readTunnel(temp("sagax-flow-"), { ...row, principalId: B }, dir)).toBeNull();
  });

  it("never resolves a folder that does not name its owner (opened before this check)", async () => {
    const dir = await supportFolder({});
    expect(readSupportTunnel(dir, { id: ID, code: CODE, principalId: A, botId: BOT })).toBeNull();
  });

  it("refuses publish_remote_session of another person's session id, on any bot", async () => {
    const dir = await supportFolder();
    const ssh: string[] = [];
    const { svc } = service(dir, async (argv) => { ssh.push(argv.at(-1) ?? ""); return { code: 0, stdout: "", stderr: "" }; });
    await expect(svc.publish({ id: ID, code: CODE, botId: BOT_B, threadId: "thread-b", principalId: B, os: "windows", elevated: false, endAt: END }))
      .rejects.toMatchObject({ status: 403 });
    await expect(svc.publish({ id: ID, code: CODE, botId: BOT, threadId: "thread-b", principalId: B, os: "windows", elevated: false, endAt: END }))
      .rejects.toMatchObject({ status: 403 });
    expect(svc.list(B, BOT_B)).toEqual([]);
    expect(svc.list(B, BOT)).toEqual([]);
    expect(ssh).toEqual([]);
    // the owner still publishes it
    const mine = await svc.publish({ id: ID, code: CODE, botId: BOT, threadId: THREAD, principalId: A, os: "windows", elevated: false, endAt: END });
    expect(mine.reachable).toBe(true);
  });

  it("writes the owner given by the server answer into open.json at remote_support_open", async () => {
    const dir = temp("sagax-support-");
    const run: TailcatRun = async (args) => {
      if (args[0] === "genkey") {
        writeFileSync(String(args[3]), "{}\n", { mode: 0o600 });
        return { code: 0, stdout: `nodekey:${"cd".repeat(32)}\n`, stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "" };
    };
    await handleRemoteSupportCall({
      name: "remote_support_open",
      args: {},
      local: { dir, technicianName: "Ada", orgName: "Acme", now: () => NOW, run, sessionId: () => ID },
      post: async () => ({ status: 200, body: { text: JSON.stringify({ code: CODE, page_url: "https://support.example.test/a" }), owner: { principalId: A, botId: BOT } } }),
    });
    expect(JSON.parse(readFileSync(path.join(dir, "sessions", CODE, "open.json"), "utf8"))).toMatchObject({ principalId: A, botId: BOT });
    expect(recallSupportSession(dir, CODE)).toMatchObject({ id: ID, code: CODE, principalId: A, botId: BOT });
  });

  it("keeps another person's address out of their folder on remote_support_status", async () => {
    const dir = await supportFolder();
    rmSync(path.join(dir, "sessions", CODE, "address"));
    const answer = await handleRemoteSupportCall({
      name: "remote_support_status",
      args: { code: CODE },
      local: { dir, run: async () => ({ code: 0, stdout: "", stderr: "" }) },
      post: async () => ({ status: 200, body: { text: JSON.stringify({ state: "started", address: ADDRESS }), owner: { principalId: B, botId: BOT } } }),
    });
    expect(answer.isError).toBe(true);
    expect(existsSync(path.join(dir, "sessions", CODE, "address"))).toBe(false);
  });
});

describe("registrar ownership (findings 2, 3, 4)", () => {
  function registrar(deps: Partial<Parameters<typeof createRemoteSessionRegistrar>[0]> = {}) {
    const published: Array<{ principalId: string; botId: string; open: { id: string } }> = [];
    const ended: unknown[] = [];
    const r = createRemoteSessionRegistrar({
      publish: async (input) => { published.push(input); },
      end: async (input) => { ended.push(input); },
      now: () => NOW.getTime(),
      ...deps,
    });
    return { r, published, ended };
  }

  it("publishes for the principal who spoke, and never for another speaker on the same code", async () => {
    const { r, published } = registrar();
    await r.observe({ threadId: THREAD, botId: BOT, principalId: A, name: "remote_support_open", args: { session: ID, end_at: END }, result: text({ code: CODE }) });
    expect(await r.observe({ threadId: THREAD, botId: BOT, principalId: B, name: "remote_support_status", args: { code: CODE }, result: text({ state: "connected" }) })).toBeNull();
    expect(await r.observe({ threadId: THREAD, botId: BOT, name: "remote_support_status", args: { code: CODE }, result: text({ state: "connected" }) })).toBeNull();
    expect(await r.observe({ threadId: THREAD, botId: BOT, principalId: A, name: "remote_support_status", args: { code: CODE }, result: text({ state: "connected" }) })).toBe("published");
    expect(published.map((row) => row.principalId)).toEqual([A]);
  });

  it("recalls a session from the support folder only for its owner and bot", async () => {
    const dir = await supportFolder();
    const { r, published } = registrar({ recall: (code) => recallSupportSession(dir, code) });
    expect(await r.observe({ threadId: THREAD, botId: BOT, principalId: B, name: "remote_support_status", args: { code: CODE }, result: text({ state: "connected" }) })).toBeNull();
    expect(await r.observe({ threadId: THREAD, botId: BOT_B, principalId: A, name: "remote_support_status", args: { code: CODE }, result: text({ state: "connected" }) })).toBeNull();
    expect(await r.observe({ threadId: THREAD, botId: BOT, principalId: A, name: "remote_support_status", args: { code: CODE }, result: text({ state: "connected" }) })).toBe("published");
    expect(published).toHaveLength(1);
  });

  it("refuses a direct open whose session id is another person's, or whose end is past the 26 h bound", async () => {
    const dir = await supportFolder();
    const { r } = registrar({ recall: (code) => recallSupportSession(dir, code), idOwners: (id) => (id === ID ? [{ principalId: A, botId: BOT }] : []) });
    expect(await r.observe({ threadId: "t-b", botId: BOT_B, principalId: B, name: "remote_support_open", args: { session: ID, end_at: END }, result: text({ code: "GVPZGU" }) })).toBeNull();
    expect(await r.observe({ threadId: "t-b", botId: BOT_B, principalId: B, name: "remote_support_open", args: { session: "aaaaaaaaaaaa", end_at: "2026-10-30T00:00:00Z" }, result: text({ code: "GVPZGU" }) })).toBeNull();
    expect(await r.observe({ threadId: "t-b", botId: BOT_B, principalId: B, name: "remote_support_open", args: { session: "aaaaaaaaaaaa", end_at: END }, result: text({ code: "GVPZGU" }) })).toBe("opened");
  });

  it("forgets what it published after a day, and keeps at most a bounded number", async () => {
    let at = NOW.getTime();
    const { r } = registrar({ now: () => at });
    for (let i = 0; i < 260; i += 1) {
      const id = i.toString(16).padStart(12, "0");
      const code = `A${"BCDEFGHJKMNPQRSTUVWXYZ"[i % 22]}${"23456789"[Math.floor(i / 22) % 8]}${"23456789"[Math.floor(i / 176) % 8]}BB`;
      await r.observe({ threadId: THREAD, botId: BOT, principalId: A, name: "remote_support_open", args: { session: id, end_at: END }, result: text({ code }) });
      await r.observe({ threadId: THREAD, botId: BOT, principalId: A, name: "remote_support_status", args: { code }, result: text({ state: "connected" }) });
    }
    expect(r.sizes().published).toBeLessThanOrEqual(200);
    at += 27 * 60 * 60 * 1000;
    await r.observe({ threadId: THREAD, botId: BOT, principalId: A, name: "remote_support_open", args: { session: ID, end_at: new Date(at + 3_600_000).toISOString() }, result: text({ code: CODE }) });
    expect(r.sizes()).toEqual({ opened: 1, published: 0 });
  });
});

describe("publish_remote_session goes to the person speaking (finding 2)", () => {
  it("publishes as the speaker, not the conversation owner, and refuses a turn nobody speaks in", async () => {
    const published: Array<{ principalId: string }> = [];
    const sessions = {
      principalFor: () => A,
      publish: async (input: { principalId: string }) => {
        published.push(input);
        return { view: { code: CODE, hostname: "POSTE-01" }, reachable: true };
      },
    } as never;
    let speaker: string | undefined = "Person-B";
    const route = createRemoteSessionInternalRoutes({ sessions, ownsThread: () => true, speaker: () => speaker, now: () => NOW.getTime() });
    const sent: Array<{ status: number }> = [];
    const send = () => route({
      res: {} as never,
      path: "/api/internal/remote-sessions/publish",
      method: "POST",
      json: ((_res: unknown, status: number) => { sent.push({ status }); }) as never,
      capability: { botId: BOT, threadId: THREAD, generation: "g" },
      readBody: async () => ({ flow_session_id: ID, code: CODE, os: "windows", rights: "standard", end_at: END }),
    } as never);
    await send();
    expect(published.map((row) => row.principalId)).toEqual([B]);
    speaker = undefined;
    await send();
    expect(sent.map((row) => row.status)).toEqual([200, 403]);
  });
});

describe("end time and address bounds", () => {
  it("shares the 26 h end bound", () => {
    const now = NOW.getTime();
    expect(parseRemoteSessionEnd(END, now)).toBe(Date.parse(END));
    expect(parseRemoteSessionEnd("2026-10-30T00:00:00Z", now)).toBeNull();
    expect(parseRemoteSessionEnd("2026-10-21T10:00:00Z", now)).toBeNull();
    expect(parseRemoteSessionEnd("nope", now)).toBeNull();
  });

  it("takes the same address length on both sides, and says so when Perspicax sends a longer one", async () => {
    const long = `tc${"a".repeat(600)}`;
    expect(isTailcatAddress(long)).toBe(true);
    expect(isTailcatAddress(`tc${"a".repeat(TAILCAT_ADDRESS_MAX)}`)).toBe(false);
    const dir = await supportFolder();
    writeFileSync(path.join(dir, "sessions", CODE, "address"), `${long}\n`);
    expect(readSupportTunnel(dir, { id: ID, code: CODE, principalId: A, botId: BOT })?.address).toBe(long);
    const tooLong = `tc${"a".repeat(TAILCAT_ADDRESS_MAX + 10)}`;
    const absorbed = await absorbStatus({ dir, raw: JSON.stringify({ state: "started", address: tooLong }), code: CODE, run: async () => ({ code: 0, stdout: "", stderr: "" }), keyPath: null });
    expect(absorbed.markConnected).toBe(false);
    expect(absorbed.text).toContain("technician_error");
    expect(absorbed.text).not.toContain(tooLong);
  });
});

describe("panel close and OS detection (low findings)", () => {
  it("closes a Sagax-opened session at Perspicax as the person, drops the address, and stays closed", async () => {
    const dir = await supportFolder();
    const closed: unknown[] = [];
    const { svc, messages } = service(dir, quietRun, { closeRemote: async (input) => { closed.push(input); } });
    await svc.publish({ id: ID, code: CODE, botId: BOT, threadId: THREAD, principalId: A, os: "windows", elevated: false, endAt: END });
    expect(await svc.close(A, BOT, ID)).toMatchObject({ state: "ended" });
    expect(closed).toEqual([{ principalId: A, botId: BOT, threadId: THREAD, code: CODE }]);
    expect(existsSync(path.join(dir, "sessions", CODE, "address"))).toBe(false);
    // a later "connected" status (a restart, a late answer) does not re-open the card
    await expect(svc.publish({ id: ID, code: CODE, botId: BOT, threadId: THREAD, principalId: A, os: "windows", elevated: false, endAt: END }))
      .rejects.toMatchObject({ status: 409 });
    expect(svc.list(A, BOT)).toEqual([]);
    expect(messages[0]?.remoteSession?.state).toBe("ended");
  });

  it("does not lock in Windows when the tunnel is down, and asks again on the next publish", async () => {
    const dir = await supportFolder();
    let down = true;
    const asked: string[] = [];
    const run: RunCommand = async (argv) => {
      const command = argv.at(-1) ?? "";
      asked.push(command);
      if (down) return { code: 255, stdout: "", stderr: "connection refused" };
      if (command === "uname -s") return { code: 0, stdout: "Darwin\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    };
    const { svc } = service(dir, run);
    const input = { id: ID, code: CODE, botId: BOT, threadId: THREAD, principalId: A, elevated: false, endAt: END };
    await svc.publish(input);
    expect(asked).toEqual(["uname -s"]);
    down = false;
    asked.length = 0;
    const second = await svc.publish(input);
    expect(asked[0]).toBe("uname -s");
    expect(second.view.os).toBe("macos");
  });

  it("does not hold other publishes and closes while it asks the remote computer", async () => {
    const dir = await supportFolder();
    mkdirSync(path.join(dir, "sessions", "GVPZGU"), { recursive: true });
    await rememberSession(dir, "GVPZGU", "aaaaaaaaaaaa", { end_at: END, principalId: A, botId: BOT });
    writeFileSync(path.join(dir, "sessions", "GVPZGU", "address"), `${ADDRESS}\n`);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const run: RunCommand = async (argv) => {
      if (argv.includes(ADDRESS) && argv.at(-1) === "uname -s") await gate;
      return { code: 0, stdout: "Linux\n", stderr: "" };
    };
    const { svc } = service(dir, run);
    await svc.publish({ id: "aaaaaaaaaaaa", code: "GVPZGU", botId: BOT, threadId: "thread-2", principalId: A, os: "linux", elevated: false, endAt: END });
    const slow = svc.publish({ id: ID, code: CODE, botId: BOT, threadId: THREAD, principalId: A, elevated: false, endAt: END });
    const closed = await Promise.race([
      svc.close(A, BOT, "aaaaaaaaaaaa"),
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 500)),
    ]);
    expect(closed).toMatchObject({ state: "ended" });
    release();
    await slow;
  });
});
