// A session the bot opened with remote_support_open becomes a Sagax session:
// a row in the bot panel (list) and message.remoteSession in the chat.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Message, Store } from "./store.ts";
import { TerminalResourceRegistry } from "./terminal-resources/registry.ts";
import { createRemoteSessionService, osFromUname } from "./remote-sessions.ts";
import { decodeWindowsScript, OS_PROBE_WINDOWS, readSupportTunnel, readTunnel, type RunCommand } from "./remote-session-probe.ts";
import { createRemoteSessionRegistrar, toolResultObject } from "./remote-session-register.ts";
import { handleRemoteSupportCall, recallSupportSession, type TailcatRun } from "./remote-support-local.ts";

const ADDRESS = "tcABCDEFGHJKMNPQRSTUVWXYZ234567890abcd";
const ID = "0123456789ab";
const CODE = "BQDHS7";
const PERSON = "person-1";
const BOT = "bot-1";
const THREAD = "thread-1";
const PUBLIC = `nodekey:${"cd".repeat(32)}`;
const NOW = new Date("2026-10-21T15:00:00.000Z");

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

describe("tool result object", () => {
  it("reads structuredContent, then the first JSON text block, and skips errors", () => {
    expect(toolResultObject({ structuredContent: { state: "connected" } })).toEqual({ state: "connected" });
    expect(toolResultObject(text({ code: CODE }))).toEqual({ code: CODE });
    expect(toolResultObject({ ...text({ code: CODE }), isError: true })).toBeNull();
    expect(toolResultObject({ content: [{ type: "text", text: "not json" }] })).toBeNull();
  });

  it("names the OS from uname, and never Windows by default", () => {
    expect(osFromUname("Darwin\n")).toBe("macos");
    expect(osFromUname("Linux")).toBe("linux");
    // 8F2NZU: a Mac shown as Windows because a failed uname meant Windows
    expect(osFromUname("")).toBeNull();
  });
});

describe("remote session registrar", () => {
  it("publishes once when the status says connected, from what the open asked for", async () => {
    const published: unknown[] = [];
    const ended: unknown[] = [];
    const registrar = createRemoteSessionRegistrar({
      publish: async (input) => { published.push(input); },
      end: async (input) => { ended.push(input); },
      now: () => NOW.getTime(),
    });
    const call = { threadId: THREAD, botId: BOT, principalId: PERSON };
    expect(await registrar.observe({
      ...call,
      name: "remote_support_open",
      args: { session: ID, rights: "standard", end_at: "2026-10-21T17:00:00Z", template: "tailcat-0.7.0/2", nodekey: PUBLIC },
      result: text({ code: CODE, page_url: "https://support.example.test/assist/BQDHS7" }),
    })).toBe("opened");
    expect(await registrar.observe({ ...call, name: "remote_support_status", args: { code: CODE }, result: text({ state: "started", address: ADDRESS }) })).toBeNull();
    expect(published).toEqual([]);
    expect(await registrar.observe({ ...call, name: "remote_support_status", args: { code: "BQD-HS7", mark_connected: true }, result: text({ state: "connected", fetch_ip_count: 1 }) })).toBe("published");
    expect(await registrar.observe({ ...call, name: "remote_support_status", args: { code: CODE }, result: text({ state: "connected" }) })).toBeNull();
    expect(published).toEqual([{ principalId: PERSON, botId: BOT, threadId: THREAD, open: { id: ID, code: CODE, elevated: false, endAt: "2026-10-21T17:00:00.000Z" } }]);
    expect(JSON.stringify(published)).not.toContain(ADDRESS);
    expect(JSON.stringify(published)).not.toContain(PUBLIC);
    expect(await registrar.observe({ ...call, name: "remote_support_close", args: { code: CODE, outcome: "ended" }, result: text({ state: "ended" }) })).toBe("ended");
    expect(ended).toEqual([{ principalId: PERSON, botId: BOT, threadId: THREAD, code: CODE }]);
  });

  it("keeps elevated rights and a named OS, and recalls a session opened before a restart", async () => {
    const published: Array<{ open: { elevated: boolean; os?: string } }> = [];
    const registrar = createRemoteSessionRegistrar({
      publish: async (input) => { published.push(input); },
      end: async () => undefined,
      recall: (code) => (code === "GVPZGU" ? { id: "aaaaaaaaaaaa", code, elevated: true, endAt: "2026-10-21T17:00:00.000Z", principalId: PERSON, botId: BOT } : null),
      now: () => NOW.getTime(),
    });
    await registrar.observe({
      threadId: THREAD, botId: BOT, principalId: PERSON, name: "remote_support_open",
      args: { session: ID, rights: "elevated", os: "macos", end_at: "2026-10-21T17:00:00Z" },
      result: text({ code: CODE }),
    });
    await registrar.observe({ threadId: THREAD, botId: BOT, principalId: PERSON, name: "remote_support_status", args: { code: CODE }, result: text({ state: "connected" }) });
    await registrar.observe({ threadId: THREAD, botId: BOT, principalId: PERSON, name: "remote_support_status", args: { code: "GVPZGU" }, result: text({ state: "connected" }) });
    expect(published.map((row) => row.open)).toEqual([
      { id: ID, code: CODE, elevated: true, endAt: "2026-10-21T17:00:00.000Z", os: "macos" },
      { id: "aaaaaaaaaaaa", code: "GVPZGU", elevated: true, endAt: "2026-10-21T17:00:00.000Z" },
    ]);
  });

  it("takes the OS the support page detected from the connected status, never a default", async () => {
    const published: Array<{ open: { os?: string } }> = [];
    const registrar = createRemoteSessionRegistrar({ publish: async (input) => { published.push(input); }, end: async () => undefined, now: () => NOW.getTime() });
    const call = { threadId: THREAD, botId: BOT, principalId: PERSON };
    await registrar.observe({ ...call, name: "remote_support_open", args: { session: ID, end_at: "2026-10-21T17:00:00Z" }, result: text({ code: CODE }) });
    await registrar.observe({ ...call, name: "remote_support_status", args: { code: CODE }, result: text({ state: "connected", os: "macos" }) });
    expect(published[0]?.open.os).toBe("macos");
    await registrar.observe({ ...call, name: "remote_support_open", args: { session: "bbbbbbbbbbbb", end_at: "2026-10-21T17:00:00Z" }, result: text({ code: "GVPZGU" }) });
    await registrar.observe({ ...call, name: "remote_support_status", args: { code: "GVPZGU" }, result: text({ state: "connected", os: "beos" }) });
    expect(published[1]?.open.os).toBeUndefined();
  });

  it("ignores an unknown code, a refused call and another tool", async () => {
    const published: unknown[] = [];
    const registrar = createRemoteSessionRegistrar({ publish: async (input) => { published.push(input); }, end: async () => undefined, now: () => NOW.getTime() });
    expect(await registrar.observe({ threadId: THREAD, botId: BOT, principalId: PERSON, name: "remote_support_status", args: { code: CODE }, result: text({ state: "connected" }) })).toBeNull();
    expect(await registrar.observe({ threadId: THREAD, botId: BOT, principalId: PERSON, name: "remote_support_open", args: { session: ID, end_at: "2026-10-21T17:00:00Z" }, result: { ...text({ code: CODE }), isError: true } })).toBeNull();
    expect(await registrar.observe({ threadId: THREAD, botId: BOT, principalId: PERSON, name: "api_search", args: {}, result: text({}) })).toBeNull();
    expect(published).toEqual([]);
  });
});

describe("a session the bot opened through the sagax tool path", () => {
  function fakeTailcat(): TailcatRun {
    return async (args) => {
      if (args[0] === "genkey") {
        writeFileSync(String(args[3]), "{}\n", { mode: 0o600 });
        return { code: 0, stdout: `${PUBLIC}\n`, stderr: "" };
      }
      if (args.includes("ping")) return { code: 0, stdout: "pong\n", stderr: "" };
      return { code: 1, stdout: "", stderr: "" };
    };
  }

  it("shows in the bot panel and as message.remoteSession, with the tunnel read from the support folder", async () => {
    const dataDir = temp("sagax-remote-");
    const flowHome = temp("sagax-flow-");
    const supportDir = path.join(dataDir, "remote-support");
    const messages: Message[] = [];
    const ssh: string[] = [];
    const run: RunCommand = async (argv) => {
      ssh.push(argv.at(-1) ?? "");
      const command = argv.at(-1) ?? "";
      if (command === "uname -s") return { code: 1, stdout: "", stderr: "'uname' is not recognized" };
      if (command === OS_PROBE_WINDOWS) return { code: 0, stdout: "Win32NT\r\n", stderr: "" };
      if ((decodeWindowsScript(command) ?? "").includes("Win32_ComputerSystem")) {
        return { code: 0, stdout: ["hostname=POSTE-01", "user=exemple\\usager", "model=PowerEdge", "serial=SN40", "cpu=Xeon", "ramBytes=34359738368", "diskFreeKb=209715200", "diskTotalKb=524288000"].join("\n"), stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    const store = {
      bot: () => ({ id: BOT, name: "Melonie", color: "#336699" }),
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
    const service = createRemoteSessionService({
      dataDir,
      supportDir: () => supportDir,
      store,
      registry: new TerminalResourceRegistry(),
      sessions: { open: async () => ({ id: "term-1", status: "connecting" }) } as never,
      access: () => ({ organization: true, admin: false, ownsBot: true }),
      owner: () => PERSON,
      run,
      home: () => flowHome,
    });
    const registrar = createRemoteSessionRegistrar({
      publish: async ({ principalId, botId, threadId, open }) => { await service.publish({ ...open, botId, threadId, principalId }); },
      end: async ({ principalId, botId, code }) => { await service.endByCode(principalId, botId, code); },
      recall: (code) => recallSupportSession(supportDir, code),
      now: () => NOW.getTime(),
    });

    // The relay sees every call the tool path makes (PerspicaxMcp.relay -> onRemoteSupport).
    const local = { dir: supportDir, technicianName: "Ada", orgName: "Exemple", now: () => NOW, run: fakeTailcat(), sessionId: () => ID, principalId: PERSON, botId: BOT };
    let fetches = 0;
    const post = async (tool: string, args: Record<string, unknown>) => {
      let body: Record<string, unknown> = {};
      if (tool === "remote_support_open") body = { code: CODE, page_url: `https://support.example.test/assist/${CODE}`, line_windows: `irm https://support.example.test/tc/${CODE}/win | iex` };
      if (tool === "remote_support_status") {
        fetches += 1;
        body = args.mark_connected === true ? { state: "connected", fetch_ip_count: 1, address: null } : { state: "started", fetch_ip_count: 1, address: ADDRESS };
      }
      await registrar.observe({ threadId: THREAD, botId: BOT, principalId: PERSON, name: tool, args, result: text(body) });
      return { status: 200, body: { text: JSON.stringify(body), owner: { principalId: PERSON, botId: BOT } } };
    };

    const opened = await handleRemoteSupportCall({ name: "remote_support_open", args: {}, local, post });
    expect(opened.text).toContain("```powershell");
    expect(service.list(PERSON, BOT)).toEqual([]);

    const status = await handleRemoteSupportCall({ name: "remote_support_status", args: { code: CODE }, local, post });
    expect(fetches).toBe(2);
    expect(status.text).not.toContain(ADDRESS);

    // the panel row
    const rows = service.list(PERSON, BOT);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: ID, code: CODE, state: "connected", elevated: false, os: "windows", hostname: "POSTE-01", user: "exemple\\usager", serial: "SN40", model: "PowerEdge", cpu: "Xeon" });
    // the chat card
    expect(messages).toHaveLength(1);
    expect(messages[0]?.remoteSession).toMatchObject({ id: ID, code: CODE, hostname: "POSTE-01", state: "connected" });
    // the tunnel came from the support folder, never from an API field
    const row = { id: ID, code: CODE, principalId: PERSON, botId: BOT };
    expect(readTunnel(flowHome, row, supportDir)).toEqual({ keyPath: path.join(supportDir, "technician.private.json"), address: ADDRESS });
    expect(readTunnel(flowHome, row)).toBeNull();
    expect(readSupportTunnel(supportDir, { ...row, id: "ffffffffffff" })).toBeNull();
    expect(ssh[0]).toBe("uname -s");
    expect(JSON.stringify(messages)).not.toContain(ADDRESS);
    expect(JSON.stringify(rows)).not.toContain(ADDRESS);
    expect(readFileSync(path.join(dataDir, "remote-sessions.json"), "utf8")).not.toContain(ADDRESS);

    // closing from the tool marks the card closed and empties the panel
    await handleRemoteSupportCall({ name: "remote_support_close", args: { code: CODE, outcome: "ended" }, local, post });
    expect(service.list(PERSON, BOT)).toEqual([]);
    expect(messages[0]?.remoteSession?.state).toBe("ended");
  });

  it("reads a Flow session folder first", () => {
    const home = temp("sagax-flow-");
    const dir = path.join(home, "tailcat", ID);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "address"), `${ADDRESS}\n`);
    writeFileSync(path.join(dir, "client.private.json"), "{}\n");
    expect(readTunnel(home, { id: ID }, temp("sagax-support-"))?.keyPath).toBe(path.join(dir, "client.private.json"));
  });
});
