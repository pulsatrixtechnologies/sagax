// call_connector through the hub (#3348, connectors across engines L5): the
// real server with the test connector host (server/connectors/hosts/
// test-host.ts) standing for one provider, and two fake engines:
// - the fake Claude CLI, whose turns really call the agents MCP server;
// - the fake ACP CLI (grokAgent), the same call from an ACP engine.
//
// Proof: a direct turn on each engine, a room turn and a peer turn call
// call_connector and receive the host's marker; a send at the "ask" level
// opens a held card on the calling turn, and a denied send reaches no host.
//
// POSIX-gated like the other CLI e2es (the fakes are shebang scripts).
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isHeldRequestId } from "../harness/held-requests.ts";
import { freePortBlock } from "../testing/ports.ts";
import { TEST_HOST_CONNECTOR, TEST_HOST_MARKER } from "./hosts/test-host.ts";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const FAKE_ACP = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");

interface HostCall { principalId: string; engine: string; connector: string; tool: string; arguments: Record<string, unknown> }

posixOnly("call_connector through the hub e2e", () => {
  let child: ChildProcess;
  let home: string;
  let callsFile: string;
  let dumpFile: string;
  let base = "";
  let stderr = "";

  const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: any = text;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: parsed };
  };
  const messages = async (threadId: string): Promise<any[]> =>
    (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).body.messages ?? [];
  const botText = async (threadId: string): Promise<string> =>
    (await messages(threadId)).filter((m) => m.role === "bot" && m.kind === "text").map((m) => String(m.text ?? "")).join("\n");
  const waitFor = async (predicate: () => Promise<boolean>, what: string, ms = 45_000) => {
    const deadline = Date.now() + ms;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}. stderr: ${stderr.slice(-3000)}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  const hostCalls = (): HostCall[] =>
    existsSync(callsFile) ? readFileSync(callsFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as HostCall) : [];
  const dumpCalls = (): Array<{ tool: string; ok: boolean; text: string }> => {
    try { return (JSON.parse(readFileSync(dumpFile, "utf8")) as { calls: Array<{ tool: string; ok: boolean; text: string }> }).calls; } catch { return []; }
  };
  const newBot = async (instanceId: string, name: string, model: string) => {
    const created = await api("POST", "/api/bots", { name });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    const bot = created.body.bot as { id: string; threadId: string };
    const picked = await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId, model } });
    expect(picked.status, JSON.stringify(picked.body)).toBe(200);
    return bot;
  };
  const read = (query: string) => ({ connector: TEST_HOST_CONNECTOR, tool: "search_messages", arguments: { query } });
  const claudeCall = (when: string, args: Record<string, unknown>, tool = "call_connector") => ({ server: "agents", tool, when, arguments: args });

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    chmodSync(FAKE_ACP, 0o755);
    home = mkdtempSync(join(tmpdir(), "sagax-connector-hub-"));
    callsFile = join(home, "host-calls.jsonl");
    dumpFile = join(home, "claude-mcp.json");
    mkdirSync(join(home, ".sagax"), { recursive: true });
    writeFileSync(join(home, ".sagax", "config.json"), JSON.stringify({
      instances: {
        claude: {
          driver: "claudeAgent",
          environment: {
            FAKE_CLAUDE_MCP_DUMP: dumpFile,
            FAKE_CLAUDE_MCP_DUMP_CALLS_ONLY: "1",
            FAKE_CLAUDE_MCP_CALLS: JSON.stringify([
              claudeCall("DIRECT_READ", read("direct")),
              claudeCall("DIRECT_SEND", { connector: TEST_HOST_CONNECTOR, tool: "send_message", arguments: { to: "someone", body: "hello" } }),
              claudeCall("ROOM_READ", read("room")),
              claudeCall("PEER_READ", read("peer")),
              claudeCall("ASK_PEER", { bot_ids: ["Peer Reader"], message: "PEER_READ the inbox for me", thread: "new", reply: "none" }, "coordinate_bots"),
            ]),
          },
          config: { cli: FAKE_CLAUDE, permissionMode: "bypassPermissions" },
        },
        grok: {
          driver: "grokAgent",
          environment: {
            FAKE_ACP_MODE: "mcp-call",
            FAKE_ACP_MCP_CALLS: "agents:call_connector",
            FAKE_ACP_MCP_CALL_ARGS: JSON.stringify({ "agents:call_connector": read("acp") }),
          },
          config: { cli: FAKE_ACP, fullAuto: true },
        },
      },
    }));
    const port = await freePortBlock([0, 1]);
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home,
        USERPROFILE: home,
        SAGAX_PORT: String(port),
        SAGAX_TEST_CONNECTOR_HOST: callsFile,
        SAGAX_TEST_INTERNAL_CAPABILITY_KEY: "connector-hub-e2e-capability-key-0123456789",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr!.on("data", (c) => (stderr += c));
    child.stdout!.on("data", (c) => (stderr += c));
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`server never came up. stderr:\n${stderr}`);
      if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}. stderr:\n${stderr}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }, 30_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (!child || child.exitCode !== null) return resolve();
      child.on("close", () => resolve());
      setTimeout(() => (child.kill("SIGKILL"), resolve()), 5_000).unref?.();
    });
    rmSync(home, { recursive: true, force: true });
  });

  it("a direct turn on the Claude engine calls call_connector and gets the host's marker", async () => {
    const bot = await newBot("claude", "Direct Reader", "claude-fake");
    rmSync(dumpFile, { force: true });
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "DIRECT_READ the inbox", threadId: bot.threadId })).status).toBe(202);
    await waitFor(async () => (await botText(bot.threadId)).includes("mcp:call_connector:"), "the direct reply");
    expect(await botText(bot.threadId)).toContain("mcp:call_connector:ok");
    const call = dumpCalls().find((c) => c.tool === "call_connector");
    expect(call?.ok, JSON.stringify(dumpCalls())).toBe(true);
    expect(call?.text).toContain(TEST_HOST_MARKER);
    expect(call?.text).toContain("untrusted data");
    const reached = hostCalls().find((c) => c.arguments.query === "direct");
    expect(reached, JSON.stringify(hostCalls())).toMatchObject({ engine: "claudeAgent", connector: TEST_HOST_CONNECTOR, tool: "search_messages" });
    // the principal comes from the turn, never from the arguments
    expect(reached?.principalId).toBeTruthy();
  });

  it("a direct turn on an ACP engine calls call_connector and gets the host's marker", async () => {
    const bot = await newBot("grok", "Acp Reader", "fake-model");
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "read the inbox", threadId: bot.threadId })).status).toBe(202);
    await waitFor(async () => (await botText(bot.threadId)).includes("agents:call_connector ->"), "the ACP reply");
    expect(await botText(bot.threadId)).toContain(TEST_HOST_MARKER);
    expect(hostCalls().find((c) => c.arguments.query === "acp"), JSON.stringify(hostCalls())).toMatchObject({ engine: "grokAgent", tool: "search_messages" });
  });

  it("a denied send at the ask level shows a held card and reaches no host", async () => {
    const bot = await newBot("claude", "Careful Sender", "claude-fake");
    for (const path of [`/api/bots/${bot.id}`, `/api/bots/${bot.id}/tasks/${bot.threadId}`]) {
      const level = await api("PATCH", path, { approvalMode: "ask" });
      expect(level.status, JSON.stringify(level.body)).toBe(200);
    }
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "DIRECT_SEND a note", threadId: bot.threadId })).status).toBe(202);
    let card: any;
    await waitFor(async () => {
      card = (await messages(bot.threadId)).find((m) => m.card?.requestType === "permission" && isHeldRequestId(String(m.card?.requestId ?? "")));
      return Boolean(card);
    }, "the held card");
    expect(hostCalls().some((c) => c.tool === "send_message")).toBe(false);
    const answered = await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: card.card.requestId, behavior: "deny" });
    expect(answered.status, JSON.stringify(answered.body)).toBeLessThan(300);
    await waitFor(async () => (await botText(bot.threadId)).includes("mcp:call_connector:"), "the reply after the deny");
    expect(await botText(bot.threadId)).toContain("mcp:call_connector:error");
    expect(hostCalls().some((c) => c.tool === "send_message"), JSON.stringify(hostCalls())).toBe(false);
  });

  it("a room turn calls call_connector", async () => {
    const bot = await newBot("claude", "Room Reader", "claude-fake");
    const made = await api("POST", "/api/groups", { name: "Connector room", memberIds: [bot.id], setup: { bulletin: "", defaultResponder: { kind: "member", botId: bot.id } } });
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
    const group = made.body.group as { id: string; threadId: string };
    expect((await api("POST", `/api/groups/${group.id}/messages`, { text: "ROOM_READ the inbox", threadId: group.threadId })).status).toBeLessThan(300);
    await waitFor(async () => hostCalls().some((c) => c.arguments.query === "room"), "the room call to reach the host");
    await waitFor(async () => (await botText(group.threadId)).includes("mcp:call_connector:"), "the room reply");
    expect(await botText(group.threadId)).toContain("mcp:call_connector:ok");
  });

  it("a peer turn calls call_connector", async () => {
    await newBot("claude", "Peer Reader", "claude-fake");
    const asker = await newBot("claude", "Peer Asker", "claude-fake");
    expect((await api("POST", `/api/bots/${asker.id}/messages`, { text: "ASK_PEER about the inbox", threadId: asker.threadId })).status).toBe(202);
    await waitFor(async () => hostCalls().some((c) => c.arguments.query === "peer"), "the peer call to reach the host", 60_000);
    expect(hostCalls().find((c) => c.arguments.query === "peer")).toMatchObject({ engine: "claudeAgent", tool: "search_messages" });
  }, 90_000);
});
