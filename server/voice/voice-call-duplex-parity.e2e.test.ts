// Harness parity for a live call with fullDuplex on and off (issue #292,
// Quasar requirement 7). Duplex only changes admit (replace vs steer).
// The turn itself is still startTurn: spoken yes/no still settles an
// approval, MEMORY.md still reaches the engine, MCP tools still run, and
// usage is still booked to the same speaker.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";

import { launchVerificationServer } from "../../scripts/control-omb.ts";

const CALL_ID = "call-parity-012345";
const MEMORY_FACT = "DuplexParityFact-kiwi-elms";

async function callFixture(env: Record<string, string> = {}) {
  const fixture = await launchVerificationServer();
  const { url, dataDir } = fixture.info;
  const api = async (method: string, path: string, body?: unknown, status = 200, token?: string) => {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };
  const dumpPath = join(dataDir, "fake-claude-dump.json");
  const gates = join(dataDir, "gates");
  mkdirSync(gates, { recursive: true });
  const wrapper = join(dataDir, "call-claude.mjs");
  writeFileSync(wrapper, [
    "#!/usr/bin/env node",
    'import { join } from "node:path";',
    `const home = ${JSON.stringify(dataDir)};`,
    'process.env.FAKE_CLAUDE_PROMPTS = join(home, "received.jsonl");',
    `process.env.FAKE_CLAUDE_GATE_DIR = ${JSON.stringify(gates)};`,
    `process.env.FAKE_CLAUDE_DUMP = ${JSON.stringify(dumpPath)};`,
    ...Object.entries(env).map(([key, value]) =>
      `process.env[${JSON.stringify(key)}] = ${JSON.stringify(value)}.replaceAll("$DATA", home);`),
    'process.stdin.on("end", () => process.exit(0));',
    `await import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL("../testing/fake-claude-cli.ts", import.meta.url))).href)});`,
  ].join("\n"), { mode: 0o700 });
  await api("PATCH", "/api/instances/claude", { cli: wrapper });
  const bot = (await api("POST", "/api/bots", { name: "Parity" }, 201)).bot;
  const thread = bot.threadId as string;
  const messages = async () => (await api("GET", `/api/threads/${thread}/messages?limit=200`)).messages as any[];
  const busy = async () => Boolean((await api("GET", "/api/bots")).bots.find((entry: any) => entry.id === bot.id)?.busy);
  const send = (body: Record<string, unknown>, status = 202, token?: string) =>
    api("POST", `/api/bots/${bot.id}/messages`, { threadId: thread, ...body }, status, token);
  const dump = () => existsSync(dumpPath) ? JSON.parse(readFileSync(dumpPath, "utf8")) : null;
  const ledger = () => {
    const file = join(dataDir, "usage", `${new Date().toISOString().slice(0, 7)}.jsonl`);
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8").trim().split("\n").filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((row: any) => row.botId === bot.id);
  };
  return { fixture, api, bot, thread, messages, busy, send, dump, dumpPath, ledger, dataDir };
}

async function pair(api: (method: string, path: string, body?: unknown, status?: number) => Promise<any>, label: string) {
  const opened = await api("POST", "/api/auth/pairing", { label });
  const paired = await api("POST", "/api/auth/pair", { code: opened.code, label });
  expect(paired.token).toBeTypeOf("string");
  return paired.token as string;
}

it("duplex on and off: memory, MCP and billing stay identical for the same speaker", async () => {
  const t = await callFixture({
    FAKE_CLAUDE_MCP_CALLS: JSON.stringify([{ server: "agents", tool: "list_bots", arguments: {} }]),
  });
  try {
    const current = await t.api("GET", `/api/bots/${t.bot.id}/memory/file?path=MEMORY.md`);
    // no expectedHash: bot creation can rewrite MEMORY.md between GET and PUT
    await t.api("PUT", `/api/bots/${t.bot.id}/memory/file`, {
      path: "MEMORY.md",
      text: `${current.text ?? ""}\n- ${MEMORY_FACT}\n`,
    });
    const phone = await pair(t.api, "Ada's phone");
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "start" });

    const outcomes: Array<{ duplex: boolean; memory: boolean; mcp: boolean; trigger: unknown }> = [];
    for (const duplex of [false, true]) {
      const before = (await t.messages()).filter((m) => m.role === "bot" && m.turnTerminal).length;
      const beforeRows = t.ledger().length;
      rmSync(t.dumpPath, { force: true });
      await t.send({
        text: "what do you remember, and list the bots",
        sendId: `parity-${duplex ? "on" : "off"}-0000000001`,
        voiceCall: { callId: CALL_ID, duplex, utteranceId: `utt-parity-${duplex ? "on" : "off"}` },
      }, 202, phone);
      await expect.poll(async () => (await t.messages()).filter((m) => m.role === "bot" && m.turnTerminal).length, { timeout: 20_000 }).toBe(before + 1);
      const reply = (await t.messages()).filter((m) => m.role === "bot" && m.kind === "text" && m.turnTerminal).at(-1);
      const haystack = JSON.stringify(t.dump() ?? {});
      // appendUsage is fire-and-forget; wait until this turn's row is on disk.
      await expect.poll(() => t.ledger().length, { timeout: 10_000 }).toBe(beforeRows + 1);
      outcomes.push({
        duplex,
        memory: haystack.includes(MEMORY_FACT),
        mcp: String(reply?.text ?? "").includes("mcp:list_bots:ok"),
        trigger: t.ledger().at(-1)?.trigger,
      });
    }

    expect(outcomes).toHaveLength(2);
    for (const row of outcomes) {
      expect(row.memory, `memory reached the engine (duplex=${row.duplex})`).toBe(true);
      expect(row.mcp, `MCP list_bots ran (duplex=${row.duplex})`).toBe(true);
      expect(row.trigger).toMatchObject({ kind: "user", label: "Ada's phone" });
    }
    expect(outcomes[0]!.trigger).toEqual(outcomes[1]!.trigger);
    expect(t.ledger().filter((row: any) => row.trigger?.kind === "user")).toHaveLength(2);
  } finally {
    await t.fixture.close();
  }
}, 180_000);

it("duplex on and off: spoken yes still settles an approval on the call", async () => {
  const t = await callFixture({ FAKE_CLAUDE_MODE: "hang" });
  const sockets: Socket[] = [];
  try {
    await t.api("PATCH", `/api/bots/${t.bot.id}/tasks/${t.thread}`, { approvalMode: "ask" });
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "start" });

    const ask = async (socketPath: string) => {
      const socket = connect(socketPath);
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
      const id = randomUUID();
      let answer: any;
      let buffer = "";
      const reply = new Promise<any>((resolve, reject) => {
        socket.once("error", reject);
        socket.once("close", () => reject(new Error(`Permission socket closed before its reply: ${id}`)));
        socket.setTimeout(10_000, () => socket.destroy(new Error(`Permission reply timed out: ${id}`)));
        socket.on("data", (chunk) => {
          buffer += chunk;
          if (!buffer.includes("\n")) return;
          answer = JSON.parse(buffer.split("\n")[0]!);
          socket.setTimeout(0);
          resolve(answer);
        });
      });
      void reply.catch(() => {});
      socket.write(JSON.stringify({ t: "ask", id, tool: "Bash", input: { command: "printf 'parity'" } }) + "\n");
      return { id, reply };
    };

    for (const duplex of [false, true]) {
      rmSync(t.dumpPath, { force: true });
      await t.send({
        text: "please run a check",
        sendId: `parity-ask-${duplex ? "on" : "off"}-00000001`,
        voiceCall: { callId: CALL_ID, duplex },
      });
      await expect.poll(t.busy, { timeout: 15_000 }).toBe(true);
      await expect.poll(() => {
        if (!existsSync(t.dumpPath)) return false;
        const path = t.dump()?.mcpConfig?.mcpServers?.ogb?.args?.at(-1);
        return typeof path === "string" && existsSync(path);
      }, { timeout: 15_000 }).toBe(true);
      const socketPath = t.dump().mcpConfig.mcpServers.ogb.args.at(-1) as string;
      const pending = await ask(socketPath);
      const card = async () => (await t.messages()).find((m) => m.card?.requestId === pending.id)?.card;
      await expect.poll(async () => Boolean(await card()), { timeout: 15_000 }).toBe(true);
      // spoken yes on the call is POST respond allow (LiveCall decideRequest)
      const decided = await t.api("POST", `/api/threads/${t.thread}/respond`, { requestId: pending.id, behavior: "allow" });
      expect(decided.outcome).toBe("allowed-once");
      expect(await pending.reply).toMatchObject({ id: pending.id, behavior: "allow" });
      await expect.poll(async () => (await card())?.answered, { timeout: 10_000 }).toBe("allow");
      await t.api("POST", `/api/bots/${t.bot.id}/interrupt`, { threadId: t.thread });
      await expect.poll(t.busy, { timeout: 20_000 }).toBe(false);
    }
  } finally {
    for (const socket of sockets) socket.destroy();
    await t.fixture.close();
  }
}, 180_000);
