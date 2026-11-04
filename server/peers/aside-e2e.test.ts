// The aside lane, end to end: a peer ask that lands while its target is
// mid-turn on a seam-capable engine folds into the RUNNING turn. The
// envelope physically enters the live session through Adapter.steer, the
// transcript records it as peer context (never steering, never a
// delegation), the external asker gets an honest receipt, and the turn settles with
// the aside folded into its reply — once, not replayed at the settle
// boundary. The no-seam degradation (busy peer to runtime consultation)
// stays pinned by the busy-peer e2e in comms.test.ts.
//
// POSIX-gated like the other CLI e2es (the fakes are shebang scripts).
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { freePortBlock } from "../testing/ports.ts";
import { withoutTurnClock } from "../testing/turn-clock-text.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "..", "testing", "fake-claude-cli.ts");
const FAKE_ACP = join(SERVER_DIR, "..", "testing", "fake-acp-cli.ts");
const PORT = await freePortBlock([0, 1]);
const BASE = `http://127.0.0.1:${PORT}`;
const posixOnly = describe.skipIf(process.platform === "win32");

const ENVELOPE_OPEN = "[aside from @Asker — peer context, not steering; continue your current plan unless this directly changes a fact you are using]";
const ASIDE_TEXT = "ping from fake";

posixOnly("peer aside lane e2e", () => {
  let child: ChildProcess;
  let home: string;
  let stderr = "";
  let finishGate: string;

  const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const getBot = async (id: string) => (await api("GET", "/api/bots")).body.bots.find((b: any) => b.id === id);
  const waitUntil = async (predicate: () => Promise<boolean>, timeout: number, what: string): Promise<void> => {
    const deadline = Date.now() + timeout;
    for (;;) {
      if (await predicate()) return;
      if (Date.now() > deadline) throw new Error(`${what}. stderr: ${stderr.slice(-2000)}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  };
  // 84841aeed: routine asks are runtime consultations. The aside lane is
  // an external caller's real agents MCP call into a turn already running.
  const externalBridge = (botId: string, threadId: string) => {
    const token = `aside-runtime-${randomUUID()}`;
    writeFileSync(join(home, ".sagax", "external-runtimes.json"), JSON.stringify({ [botId]: { token, threadId } }), { mode: 0o600 });
    const proxy = spawn(process.execPath, [join(SERVER_DIR, "..", "drivers", "agents-proxy.ts")], {
      env: { ...(process.env.PATH ? { PATH: process.env.PATH } : {}), HOME: home, USERPROFILE: home,
        SAGAX_HARNESS_URL: BASE, SAGAX_BOT_ID: botId, SAGAX_THREAD_ID: threadId,
        SAGAX_COMMS_TOKEN: token, SAGAX_EXTERNAL_RUNTIME: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    proxy.stderr.resume();
    const lines = createInterface({ input: proxy.stdout });
    let id = 0;
    return {
      async rpc(method: string, params: unknown = {}) {
        const reply = once(lines, "line", { signal: AbortSignal.timeout(20_000) });
        proxy.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params })}\n`);
        const value = JSON.parse(String((await reply)[0]));
        expect(value.id).toBe(id);
        expect(value.error).toBeUndefined();
        return value.result;
      },
      async close() { await waitForExit(proxy, { signal: "SIGTERM" }); lines.close(); },
    };
  };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    chmodSync(FAKE_ACP, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-aside-"));
    mkdirSync(join(home, ".sagax"), { recursive: true });
    finishGate = join(home, "finish-aside-turn.gate");
    writeFileSync(
      join(home, ".sagax", "config.json"),
      JSON.stringify({
        instances: {
          // the busy target: a slow fake claude turn parked in its
          // post-tool gap, held open until the test drops the gate
          claudeSteer: {
            driver: "claudeAgent",
            environment: { FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: finishGate },
            config: { cli: FAKE_CLAUDE, permissionMode: "bypassPermissions" },
          },
          // the asker: asks the FIRST visible bot through the agents proxy
          grok: {
            driver: "grokAgent",
            environment: { FAKE_ACP_MODE: "ask-peer" },
            config: { cli: FAKE_ACP, fullAuto: true },
          },
        },
      }),
    );
    child = spawn(process.execPath, [join(SERVER_DIR, "..", "index.ts")], {
      cwd: join(SERVER_DIR, "..", ".."),
      env: { ...(process.env.PATH ? { PATH: process.env.PATH } : {}), HOME: home, USERPROFILE: home, SAGAX_PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr!.on("data", (c) => (stderr += c));
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        if ((await fetch(`${BASE}/api/health`)).ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`server never came up. stderr:\n${stderr}`);
      if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}. stderr:\n${stderr}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }, 30_000);

  afterAll(async () => {
    await waitForExit(child, { signal: "SIGTERM" });
    await removeTempDir(home);
  });

  it(
    "folds a peer ask into a busy Claude turn as an aside: honest receipt, enveloped transcript line, no delegation, folded reply, no replay",
    async () => {
      rmSync(finishGate, { force: true });
      // determinism: the ask-peer CLI asks the FIRST visible bot, so hide
      // the seeded profile bot before creating the pair
      const seeded = (await api("GET", "/api/bots")).body.bots[0];
      await api("PATCH", `/api/bots/${seeded.id}`, { hidden: true });
      const helper = (await api("POST", "/api/bots")).body.bot;
      await api("PATCH", `/api/bots/${helper.id}`, {
        name: "Helper",
        modelSelection: { instanceId: "claudeSteer", model: "claude-fake" },
      });
      const asker = (await api("POST", "/api/bots")).body.bot;
      await api("PATCH", `/api/bots/${asker.id}`, {
        name: "Asker",
        modelSelection: { instanceId: "grok", model: "fake-model" },
      });

      // Helper's turn opens and parks in the slow gap after its tool result
      expect((await api("POST", `/api/bots/${helper.id}/messages`, { text: "first" })).status).toBe(202);
      await waitUntil(async () => (await getBot(helper.id))?.busy === true, 15_000, "helper turn never started");
      await waitUntil(
        async () => (await getBot(helper.id))?.messages.some((m: any) => m.kind === "activity"),
        15_000,
        "helper tool chip never landed",
      );

      const helperThreads = (await getBot(helper.id)).tasks.map((task: { threadId: string }) => task.threadId);
      const bridge = externalBridge(asker.id, asker.threadId);
      try {
        await bridge.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "aside-fixture", version: "0" } });
        const catalog = await bridge.rpc("tools/list");
        expect(catalog.tools.map((tool: { name: string }) => tool.name)).toContain("ask_bot");
        const asked = await bridge.rpc("tools/call", { name: "ask_bot", arguments: { bot_id: helper.id, message: ASIDE_TEXT } });
        expect(asked.isError).not.toBe(true);
        const receipt = asked.content.map((part: { text?: string }) => part.text ?? "").join("\n");
        // The receipt is immediate aside delivery, never a queued consultation.
        expect(receipt).toContain("Helper is mid-turn");
        expect(receipt).toContain("aside");
        expect(receipt).not.toContain("Task id:");
        expect(receipt).not.toContain("queued as a delegation");
        const askerBot = await getBot(asker.id);
        expect(
          askerBot.messages.some(
            (m: any) => m.kind === "activity" && m.tool?.name === "Delegated to @Helper: asked while busy",
          ),
        ).toBe(false);

        // Helper's transcript already shows the folded context: user-role,
        // enveloped, marked aside (never steered), attributed to the peer
        const midTurn = await getBot(helper.id);
        expect(midTurn.busy).toBe(true); // an aside is not an interruption
        const asideLine = midTurn.messages.find((m: any) => m.aside === true);
        expect(asideLine).toBeTruthy();
        expect(asideLine.role).toBe("user");
        expect(asideLine.kind).toBe("text");
        expect(asideLine.text).toBe(`${ENVELOPE_OPEN}\n${ASIDE_TEXT}\n[end aside]`);
        // The old durable aside queue is gone; an injected row has no queue id.
        expect(asideLine.queueId).toBeUndefined();
        expect(asideLine.peerAsk).toEqual({ botId: asker.id, name: "Asker" });
        expect(asideLine.steered).toBeUndefined();
        expect(midTurn.tasks.map((task: { threadId: string }) => task.threadId)).toEqual(helperThreads);
        expect(askerBot.tasks.map((task: { threadId: string }) => task.threadId)).toEqual([asker.threadId]);

        // release the turn: its reply physically carries the envelope, which
        // is the proof the words entered the live session
        writeFileSync(finishGate, "finish");
        await waitUntil(async () => (await getBot(helper.id))?.busy === false, 20_000, "helper turn never settled");
        const settled = await getBot(helper.id);
        const finalReply = settled.messages.findLast((m: any) => m.kind === "text" && m.role === "bot");
        expect(withoutTurnClock(finalReply.text)).toContain(`reply to: first + steered: ${ENVELOPE_OPEN}`);
        expect(finalReply.text).toContain(ASIDE_TEXT);
        // one injection, no replay: the settle boundary retired the row, it
        // did not fold the same words a second time
        expect(settled.messages.filter((m: any) => m.aside === true)).toHaveLength(1);
        expect(settled.messages.filter((m: any) => m.role === "bot" && m.kind === "text" && m.text?.startsWith("reply to:"))).toHaveLength(1);
      } finally {
        writeFileSync(finishGate, "finish");
        await bridge.close();
      }
    },
    60_000,
  );
});
