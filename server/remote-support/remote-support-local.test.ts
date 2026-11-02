import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, type ToolCallContext } from "../drivers/agents-call.ts";
import { availableTools } from "../drivers/agents-catalog.ts";
import type { HarnessClient } from "../drivers/agents-client.ts";
import { GUIDES } from "../../scripts/self-knowledge/guides.ts";
import {
  CONNECTED_NOTE,
  REMOTE_SUPPORT_TEMPLATE,
  createSessionKey,
  markSessionClosed,
  prepareOpen,
  recallSupportSession,
  handleRemoteSupportCall,
  sessionKeyPath,
  type TailcatRun,
} from "./remote-support-local.ts";
import { pruneSupportSessions, readSupportTunnel } from "./remote-session-probe.ts";

const PUBLIC = `nodekey:${"cd".repeat(32)}`;
const SECOND = `nodekey:${"12".repeat(32)}`;
const OTHER = `nodekey:${"ee".repeat(32)}`;
const PRIVATE = `privkey:${"ab".repeat(32)}`;
const ADDRESS = "tcExampleAddressValue12";
const NOW = new Date("2026-10-21T15:00:00.000Z");
const CODE = "K7QMNP";
const OWNER = { principalId: "person-a", botId: "bot-1" };

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sagax-rs-"));
  dirs.push(dir);
  return dir;
}

function fakeRun(opts: { pingCode?: number; missing?: boolean; noKey?: boolean } = {}) {
  const calls: string[][] = [];
  let made = 0;
  const run: TailcatRun = async (args) => {
    calls.push([...args]);
    if (opts.missing) return { code: null, stdout: "", stderr: "", error: "missing" };
    if (args[0] === "genkey") {
      if (opts.noKey) return { code: 1, stdout: "", stderr: "failed\n" };
      const nodekey = made++ === 0 ? PUBLIC : SECOND;
      writeFileSync(String(args[3]), `{"Private":"${PRIVATE}${made}"}\n`, { mode: 0o644 });
      return { code: 0, stdout: `${nodekey}\n`, stderr: "# wrote file\n" };
    }
    if (args.includes("printpub")) return { code: 0, stdout: `${PUBLIC}\n`, stderr: "" };
    if (args.includes("ping")) return { code: opts.pingCode ?? 0, stdout: "pong\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "" };
  };
  return { calls, run };
}

function local(dir: string, run: TailcatRun) {
  return {
    dir,
    technicianName: "Ada Lovelace",
    orgName: "Acme",
    now: () => NOW,
    run,
    sessionId: () => "0123456789ab",
  };
}

/** One open answered with `code`, owned by person-a and bot-1. */
async function openSession(dir: string, run: TailcatRun, code = CODE, args: Record<string, unknown> = {}, sessionId = "0123456789ab", now = NOW) {
  const posted: Array<Record<string, unknown>> = [];
  const answer = await handleRemoteSupportCall({
    name: "remote_support_open",
    args,
    local: { ...local(dir, run), now: () => now, sessionId: () => sessionId },
    post: async (_tool, sent) => {
      posted.push(sent);
      return { status: 200, body: { owner: OWNER, text: JSON.stringify({ code, page_url: `https://support.example.test/assist/${code}` }) } };
    },
  });
  return { answer, posted };
}

describe("remote support on this computer", () => {
  it("creates a key for one session only, mode 0600 in 0700 folders, under pending", async () => {
    const dir = tempDir();
    const { calls, run } = fakeRun();
    const created = await createSessionKey(dir, "0123456789ab", run);
    const folder = join(dir, "pending", "0123456789ab");
    expect(created).toEqual({ ok: true, nodekey: PUBLIC, folder });
    expect(calls).toEqual([["genkey", "--client", "--key", join(folder, "technician.private.json")]]);
    expect(statSync(join(folder, "technician.private.json")).mode & 0o777).toBe(0o600);
    expect(statSync(join(folder, "technician.nodekey")).mode & 0o777).toBe(0o600);
    expect(statSync(folder).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "pending")).mode & 0o777).toBe(0o700);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(existsSync(join(dir, "technician.private.json"))).toBe(false);
  });

  it("does not invent a key when tailcat is missing, and leaves no pending folder", async () => {
    const dir = tempDir();
    const { run } = fakeRun({ missing: true });
    const created = await createSessionKey(dir, "0123456789ab", run);
    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.error).toContain("not installed");
      expect(created.error).not.toContain("Install tailcat");
      expect(created.error).not.toContain("/usr/bin");
      expect(created.error).not.toContain("nodekey:");
      expect(created.error).not.toMatch(/copy tailcat into/i);
    }
    expect(created.ok === false && created.error.includes(PRIVATE)).toBe(false);
    expect(readdirSync(join(dir, "pending"))).toEqual([]);
  });

  it("opens from one call: defaults, local key, link and code, private key stays put", async () => {
    const dir = tempDir();
    const { calls, run } = fakeRun();
    const posted: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const answer = await handleRemoteSupportCall({
      name: "remote_support_open",
      args: {
        nodekey: OTHER,
        template: "nope",
        session: "ffffffffffff",
        end_at: "2026-10-23T15:00:00Z",
      },
      local: local(dir, run),
      post: async (tool, args) => {
        posted.push({ tool, args });
        return {
          status: 200,
          body: {
            text: JSON.stringify({
              code: CODE,
              page_url: `https://support.example.test/assist/${CODE}`,
              line_windows: `irm https://support.example.test/tc/${CODE}/win | iex`,
              line_unix: `curl -fsSL https://support.example.test/tc/${CODE}/sh | sh`,
              address_url: `https://support.example.test/tc/${CODE}/address`,
              nodekey: PUBLIC,
            }),
          },
        };
      },
    });
    expect(answer.isError).toBeUndefined();
    expect(answer.text).toBe([
      `Link: https://support.example.test/assist/${CODE}`,
      `Code: ${CODE}`,
      `Windows: irm https://support.example.test/tc/${CODE}/win | iex`,
      `macOS or Linux: curl -fsSL https://support.example.test/tc/${CODE}/sh | sh`,
      "",
      "Put this in your first reply exactly as written, fences included. Never run it or pass it through a shell on this computer (a Mac shell eats its $ variables).",
      "",
      "Windows (PowerShell):",
      "```powershell",
      `irm https://support.example.test/tc/${CODE}/win | iex`,
      "```",
      "",
      "macOS or Linux (Terminal):",
      "```sh",
      `curl -fsSL https://support.example.test/tc/${CODE}/sh | sh`,
      "```",
    ].join("\n"));
    // what the open asked for is kept beside the session id, never the address
    expect(recallSupportSession(dir, CODE)).toEqual({ id: "0123456789ab", code: CODE, elevated: false, endAt: "2026-10-22T15:00:00.000Z" });
    // the key made for this open moved into its session folder; nothing pending, nothing shared
    expect(statSync(join(dir, "sessions", CODE, "technician.private.json")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, "sessions", CODE, "technician.nodekey"), "utf8").trim()).toBe(PUBLIC);
    expect(readdirSync(join(dir, "pending"))).toEqual([]);
    expect(existsSync(join(dir, "technician.private.json"))).toBe(false);
    expect(existsSync(join(dir, "technician.nodekey"))).toBe(false);
    expect(statSync(join(dir, "sessions", CODE, "open.json")).mode & 0o777).toBe(0o600);
    expect(answer.text).not.toContain(PUBLIC);
    expect(answer.text).not.toContain(PRIVATE);
    expect(answer.text).not.toContain("address");
    expect(posted).toEqual([{
      tool: "remote_support_open",
      args: {
        template: REMOTE_SUPPORT_TEMPLATE,
        nodekey: PUBLIC,
        session: "0123456789ab",
        rights: "standard",
        technician: "Ada Lovelace, Acme",
        end_at: "2026-10-22T15:00:00.000Z",
      },
    }]);
    expect(JSON.stringify(posted)).not.toContain(PRIVATE);
    expect(JSON.stringify(posted)).not.toContain(OTHER);
    expect(calls.map((args) => args[0])).toEqual(["genkey"]);
  });

  it("two opens create two different keys, each in its own session folder", async () => {
    const dir = tempDir();
    const { calls, run } = fakeRun();
    const first = await openSession(dir, run, CODE, {}, "0123456789ab");
    const second = await openSession(dir, run, "MNP234", { rights: "elevated", os: "windows", technician: "Ada" }, "ba9876543210");
    expect(first.answer.isError).toBeUndefined();
    expect(second.answer.isError).toBeUndefined();
    expect(calls.map((args) => args[0])).toEqual(["genkey", "genkey"]);
    expect(first.posted[0]?.nodekey).toBe(PUBLIC);
    expect(second.posted[0]?.nodekey).toBe(SECOND);
    const one = readFileSync(join(dir, "sessions", CODE, "technician.private.json"), "utf8");
    const two = readFileSync(join(dir, "sessions", "MNP234", "technician.private.json"), "utf8");
    expect(one).not.toBe(two);
    expect(readFileSync(join(dir, "sessions", "MNP234", "technician.nodekey"), "utf8").trim()).toBe(SECOND);
    expect(existsSync(join(dir, "technician.private.json"))).toBe(false);
    expect(first.answer.text + second.answer.text).not.toContain(PRIVATE);
  });

  it("deletes a legacy shared key and never uses it", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "technician.private.json"), `{"Private":"${PRIVATE}"}\n`, { mode: 0o600 });
    writeFileSync(join(dir, "technician.nodekey"), `${OTHER}\n`, { mode: 0o600 });
    const { calls, run } = fakeRun();
    const { posted } = await openSession(dir, run);
    expect(existsSync(join(dir, "technician.private.json"))).toBe(false);
    expect(existsSync(join(dir, "technician.nodekey"))).toBe(false);
    expect(posted[0]?.nodekey).toBe(PUBLIC);
    expect(JSON.stringify(posted)).not.toContain(OTHER);
    expect(calls.some((args) => args.includes(join(dir, "technician.private.json")))).toBe(false);
    // and a sweep alone deletes it too
    writeFileSync(join(dir, "technician.private.json"), "{}\n", { mode: 0o600 });
    pruneSupportSessions(dir, Date.now());
    expect(existsSync(join(dir, "technician.private.json"))).toBe(false);
  });

  it("a failed open leaves no pending folder and no session key", async () => {
    const dir = tempDir();
    const refusedRun = fakeRun();
    const refusedOpen = await handleRemoteSupportCall({
      name: "remote_support_open",
      args: {},
      local: local(dir, refusedRun.run),
      post: async () => ({ status: 403, body: { error: "remote_support_disabled" } }),
    });
    expect(refusedOpen.isError).toBe(true);
    expect(readdirSync(join(dir, "pending"))).toEqual([]);
    const invalid = await handleRemoteSupportCall({ name: "remote_support_open", args: { scope: "root" }, local: local(dir, fakeRun().run), post: async () => { throw new Error("not called"); } });
    expect(invalid.isError).toBe(true);
    expect(readdirSync(join(dir, "pending"))).toEqual([]);
    const garbled = await handleRemoteSupportCall({ name: "remote_support_open", args: {}, local: local(dir, fakeRun().run), post: async () => ({ status: 200, body: { text: "no json" } }) });
    expect(garbled.isError).toBe(true);
    expect(readdirSync(join(dir, "pending"))).toEqual([]);
    await expect(handleRemoteSupportCall({ name: "remote_support_open", args: {}, local: local(dir, fakeRun().run), post: async () => { throw new Error("offline"); } })).rejects.toThrow("offline");
    expect(readdirSync(join(dir, "pending"))).toEqual([]);
    const noKey = await handleRemoteSupportCall({ name: "remote_support_open", args: {}, local: local(dir, fakeRun({ noKey: true }).run), post: async () => { throw new Error("not called"); } });
    expect(noKey.isError).toBe(true);
    expect(readdirSync(join(dir, "pending"))).toEqual([]);
    expect(existsSync(join(dir, "sessions"))).toBe(false);
  });

  it("removes a pending folder older than an hour and keeps a fresh one", () => {
    const dir = tempDir();
    const stale = join(dir, "pending", "aaaaaaaaaaaa");
    const fresh = join(dir, "pending", "bbbbbbbbbbbb");
    mkdirSync(stale, { recursive: true });
    mkdirSync(fresh, { recursive: true });
    writeFileSync(join(stale, "technician.private.json"), "{}\n");
    const longAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    utimesSync(stale, longAgo, longAgo);
    pruneSupportSessions(dir, Date.now());
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it("closing a session deletes its key", async () => {
    const dir = tempDir();
    const { run } = fakeRun();
    await openSession(dir, run);
    expect(sessionKeyPath(dir, CODE, NOW)).toBe(join(dir, "sessions", CODE, "technician.private.json"));
    const closed = await handleRemoteSupportCall({
      name: "remote_support_close",
      args: { code: CODE, outcome: "ended" },
      local: local(dir, run),
      post: async () => ({ status: 200, body: { owner: OWNER, text: "closed" } }),
    });
    expect(closed.isError).toBeUndefined();
    expect(existsSync(join(dir, "sessions", CODE, "technician.private.json"))).toBe(false);
    expect(existsSync(join(dir, "sessions", CODE, "technician.nodekey"))).toBe(false);
    expect(sessionKeyPath(dir, CODE, NOW)).toBeNull();
    // the panel close goes through markSessionClosed too
    await openSession(dir, run, "MNP234", {}, "ba9876543210");
    await markSessionClosed(dir, "MNP234");
    expect(existsSync(join(dir, "sessions", "MNP234", "technician.private.json"))).toBe(false);
  });

  it("a session past its end has its key deleted when next seen", async () => {
    const dir = tempDir();
    const { run } = fakeRun();
    await openSession(dir, run, CODE, { end_at: "2026-10-21T16:00:00Z" });
    const keyPath = join(dir, "sessions", CODE, "technician.private.json");
    expect(sessionKeyPath(dir, CODE, new Date("2026-10-21T15:30:00Z"))).toBe(keyPath);
    expect(sessionKeyPath(dir, CODE, new Date("2026-10-21T16:00:01Z"))).toBeNull();
    expect(existsSync(keyPath)).toBe(false);
    // the periodic sweep does the same for a session nobody looks at
    await openSession(dir, run, "MNP234", { end_at: "2026-10-21T16:00:00Z" }, "ba9876543210");
    pruneSupportSessions(dir, Date.parse("2026-10-21T17:00:00Z"));
    expect(existsSync(join(dir, "sessions", "MNP234", "technician.private.json"))).toBe(false);
    // and the tunnel no longer resolves (the real clock is past that end)
    writeFileSync(join(dir, "sessions", CODE, "address"), `${ADDRESS}\n`);
    expect(readSupportTunnel(dir, { id: "0123456789ab", code: CODE, principalId: "person-a", botId: "bot-1" })).toBeNull();
  });

  it("readSupportTunnel returns the session's own key", async () => {
    const dir = tempDir();
    const { run } = fakeRun();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await openSession(dir, run, CODE, { end_at: future }, "0123456789ab", new Date());
    writeFileSync(join(dir, "sessions", CODE, "address"), `${ADDRESS}\n`);
    expect(readSupportTunnel(dir, { id: "0123456789ab", code: CODE, principalId: "person-a", botId: "bot-1" })).toEqual({
      keyPath: join(dir, "sessions", CODE, "technician.private.json"),
      address: ADDRESS,
    });
  });

  it("validates and forwards scope and call_ref", async () => {
    const base = { nodekey: PUBLIC, person: "Ada", now: NOW, sessionId: "0123456789ab" };
    const ok = prepareOpen({ ...base, args: { scope: "view-only", call_ref: "  Call 2026-10-21 10:05  " } });
    expect(ok).toMatchObject({ ok: true, args: { scope: "view-only", call_ref: "Call 2026-10-21 10:05" } });
    const omitted = prepareOpen({ ...base, args: { call_ref: "   " } });
    expect(omitted.ok && "scope" in omitted.args).toBe(false);
    expect(omitted.ok && "call_ref" in omitted.args).toBe(false);
    for (const scope of ["full-control", "view-only", "shell-only"]) expect(prepareOpen({ ...base, args: { scope } }).ok).toBe(true);
    expect(prepareOpen({ ...base, args: { scope: "admin" } }).ok).toBe(false);
    expect(prepareOpen({ ...base, args: { scope: 3 } }).ok).toBe(false);
    expect(prepareOpen({ ...base, args: { call_ref: "x".repeat(81) } }).ok).toBe(false);
    expect(prepareOpen({ ...base, args: { call_ref: "x".repeat(80) } }).ok).toBe(true);
    expect(prepareOpen({ ...base, args: { call_ref: "line one\nline two" } }).ok).toBe(false);
    expect(prepareOpen({ ...base, args: { call_ref: "tab\there" } }).ok).toBe(false);
    expect(prepareOpen({ ...base, args: { call_ref: 42 } }).ok).toBe(false);

    const dir = tempDir();
    const { posted } = await openSession(dir, fakeRun().run, CODE, { scope: "shell-only", call_ref: "Ticket 1234" });
    expect(posted[0]).toMatchObject({ scope: "shell-only", call_ref: "Ticket 1234" });
    expect(recallSupportSession(dir, CODE)?.scope).toBe("shell-only");
    expect(readFileSync(join(dir, "sessions", CODE, "open.json"), "utf8")).not.toContain("Ticket 1234");
  });

  it("an unattended open names the enrolled host by host_id, never a hostname", () => {
    const base = { nodekey: PUBLIC, person: "Ada", now: NOW, sessionId: "0123456789ab", args: {} };
    const host = `h_${"ab".repeat(16)}`;
    expect(prepareOpen({ ...base, hostId: host.toUpperCase() })).toMatchObject({ ok: true, args: { host_id: host, nodekey: PUBLIC } });
    expect(prepareOpen({ ...base, hostId: "PC-01" }).ok).toBe(false);
    expect(prepareOpen({ ...base, hostId: "h_123" }).ok).toBe(false);
    const coded = prepareOpen(base);
    expect(coded.ok && "host_id" in coded.args).toBe(false);
  });

  it("connects with the session's own key and does not hand the address back", async () => {
    const dir = tempDir();
    const { calls, run } = fakeRun();
    await openSession(dir, run);
    calls.length = 0;
    const posted: Array<Record<string, unknown>> = [];
    const answer = await handleRemoteSupportCall({
      name: "remote_support_status",
      args: { code: "K7Q-MNP" },
      local: local(dir, run),
      post: async (_tool, args) => {
        posted.push(args);
        const marked = args.mark_connected === true;
        return {
          status: 200,
          body: {
            owner: OWNER,
            text: JSON.stringify({
              state: marked ? "connected" : "started",
              fetch_ip_count: 1,
              address: marked ? null : ADDRESS,
            }),
          },
        };
      },
    });
    expect(answer.isError).toBeUndefined();
    expect(answer.text).not.toContain(ADDRESS);
    expect(answer.text).toContain("connected");
    // the bot learns the card comes by itself and the screen is in Sagax
    expect(answer.text).toContain(CONNECTED_NOTE);
    expect(CONNECTED_NOTE).toContain("Do not write a screenshot to the Desktop");
    expect(CONNECTED_NOTE).toContain("Preview");
    expect(posted[0]).toEqual({ code: "K7Q-MNP" });
    expect(posted[1]).toEqual({ code: "K7Q-MNP", mark_connected: true });
    const sessionKey = join(dir, "sessions", CODE, "technician.private.json");
    expect(calls.find((args) => args.includes("ping"))).toEqual(["--key", sessionKey, "ping", "--timeout=8s", ADDRESS]);
    const addressFile = join(dir, "sessions", "K7QMNP", "address");
    expect(readFileSync(addressFile, "utf8").trim()).toBe(ADDRESS);
    expect(statSync(addressFile).mode & 0o777).toBe(0o600);
    expect(calls.some((args) => args.includes(PRIVATE))).toBe(false);
  });

  it("does not connect when a second address fetched the script", async () => {
    const dir = tempDir();
    const { calls, run } = fakeRun();
    await openSession(dir, run);
    calls.length = 0;
    const answer = await handleRemoteSupportCall({
      name: "remote_support_status",
      args: { code: CODE },
      local: local(dir, run),
      post: async () => ({ status: 200, body: { owner: OWNER, text: JSON.stringify({ state: "fetched", fetch_ip_count: 2, address: ADDRESS }) } }),
    });
    expect(answer.text).toContain("refused");
    expect(answer.text).not.toContain(ADDRESS);
    expect(calls.some((args) => args.includes("ping"))).toBe(false);
  });

  it("the catalog and the guide no longer ask for a nodekey", () => {
    const tools = availableTools({
      externalRuntime: false, coordinating: false, ownThreadCreation: false, skillAuthoring: false,
      sharedComputers: false, voiceNotes: false, cloudHome: false, chief: false, botId: "b", perspicax: true,
    }) as Array<{ name: string; description: string; inputSchema: { properties: Record<string, unknown>; required?: string[] } }>;
    const open = tools.find((tool) => tool.name === "remote_support_open");
    expect(open?.inputSchema.properties.nodekey).toBeUndefined();
    expect(open?.inputSchema.properties.template).toBeUndefined();
    expect(open?.inputSchema.properties.session).toBeUndefined();
    expect(open?.inputSchema.required ?? []).not.toContain("nodekey");
    expect(open?.description).not.toContain("tailcat_session.py");
    expect(open?.description).toContain("private key");
    const guide = GUIDES.find((entry) => entry.id === "remote-support");
    expect(guide?.text).not.toContain("tailcat_session.py");
    expect(guide?.text).toContain("new key for this session only");
    expect(open?.description).toContain("new key for this session only");
    expect(open?.inputSchema.properties.scope).toMatchObject({ enum: ["full-control", "view-only", "shell-only"] });
    expect(open?.inputSchema.properties.call_ref).toMatchObject({ type: "string", maxLength: 80, description: "Optional reference of the phone call or ticket that records the person's consent" });
    expect(open?.description).toContain("Do not download tailcat");
    expect(guide?.text).toContain("Do not download tailcat");
    expect(guide?.text).toContain("donne-moi le lien");
    expect(guide?.text).not.toMatch(/[–—]/);
  });

  it("encodes the fast process: standard by default, three calls, script in the first reply, no jpg", () => {
    const tools = availableTools({
      externalRuntime: false, coordinating: false, ownThreadCreation: false, skillAuthoring: false,
      sharedComputers: false, voiceNotes: false, cloudHome: false, chief: false, botId: "b", perspicax: true,
    }) as Array<{ name: string; description: string }>;
    const open = tools.find((tool) => tool.name === "remote_support_open")?.description ?? "";
    const status = tools.find((tool) => tool.name === "remote_support_status")?.description ?? "";
    const publish = tools.find((tool) => tool.name === "publish_remote_session")?.description ?? "";
    const guide = GUIDES.find((entry) => entry.id === "remote-support")?.text ?? "";
    for (const text of [open, guide]) {
      expect(text).toContain("at most three calls");
      expect(text).toMatch(/without administrator rights/);
      expect(text).toContain("first reply");
      expect(text).toContain("Mac shell eats");
      expect(text).toContain("no cloud fallback");
      expect(text).toMatch(/never expose the person's own computer/i);
    }
    expect(guide).toContain("powershell code fence");
    expect(guide).toContain("fetch_ip_count must be exactly 1");
    expect(guide).toContain("do not open Preview");
    expect(guide).toContain("Sessions à distance");
    expect(status).toContain("fetch_ip_count must be exactly 1");
    expect(status).toContain("never write a screenshot to the Desktop or open Preview");
    expect(status).toContain("posts the session card and the live screen in the chat");
    expect(status).toContain("remote_session_snapshot");
    expect(publish).toContain("posted by itself");
    for (const text of [open, status, publish, guide]) expect(text).not.toMatch(/[–—]/);
  });
});

describe("callTool remote support", () => {
  it("refuses without a local directory and otherwise drops a supplied nodekey", async () => {
    const api = vi.fn<HarnessClient["api"]>(async () => ({}));
    const bare: ToolCallContext = {
      botId: "bot", threadId: "thread", depth: 0, externalRuntime: false, coordinating: false, sharedComputers: false,
      client: { api, apiResponse: vi.fn<HarnessClient["apiResponse"]>(async () => ({ ok: true, status: 200, body: {} })) },
    };
    expect((await callTool("remote_support_open", {}, bare)).isError).toBe(true);
    expect(bare.client.apiResponse).not.toHaveBeenCalled();

    const dir = tempDir();
    const { run } = fakeRun();
    const apiResponse = vi.fn<HarnessClient["apiResponse"]>(async (_path, init) => {
      const body = JSON.parse(String(init?.body)) as { tool: string; args: { nodekey?: string } };
      expect(body.args.nodekey).toBe(PUBLIC);
      return { ok: true, status: 200, body: { text: JSON.stringify({ code: CODE, page_url: `https://support.example.test/assist/${CODE}` }) } };
    });
    const context: ToolCallContext = { ...bare, client: { api, apiResponse }, remoteSupport: local(dir, run) };
    const result = await callTool("remote_support_open", { nodekey: OTHER, template: "nope", session: "ffffffffffff" }, context);
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain(`Code: ${CODE}`);
    expect(result.text).not.toContain(PRIVATE);
    expect(statSync(join(dir, "sessions", CODE, "technician.private.json")).mode & 0o777).toBe(0o600);
    expect(existsSync(join(dir, "technician.private.json"))).toBe(false);
  });
});
