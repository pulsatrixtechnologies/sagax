import { describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  chatToolsFingerprint,
  chatToolsTurnLimit,
  createWarmToolSessions,
  PREWARM_MCP_PER_PERSON,
  withWarmTokens,
} from "./openai-chat-tools-warm.ts";
import { commsTokenFile } from "./spawn-contract.ts";
import { MiB, WarmResourceBudget } from "../resources/warm-resources.ts";

describe("openai-chat tools warm cache", () => {
  const fixtureSession = () => ({ definitions: [], skipped: [], validate() {}, view() { return { title: "Fixture", input: {}, ask: false }; },
    async execute() { return { text: "ok", ok: true }; }, async close() {} });

  it("uses the shared LRU and never evicts mounts claimed by an active turn", async () => {
    const budget = new WarmResourceBudget({ intervalMs: 0, limits: { count: 1, bytes: 1000 * MiB, personCount: 10, personBytes: 1000 * MiB } });
    const cache = createWarmToolSessions({ budget });
    const active = fixtureSession(), idle = fixtureSession();
    cache.set("active", "same", active, { person: "osprey", active: true });
    cache.keep("idle", idle, "same", { person: "wren" });
    await budget.settled(); expect(cache.get("active", "same", "osprey")).toBe(active); expect(cache.has("idle")).toBe(false);
    cache.keep("active", active, "same", { person: "osprey" });
    await cache.releaseAll(); expect(budget.stats().resources).toBe(0);
  });

  it("never returns a mount to another person on the same thread and fingerprint", async () => {
    const budget = new WarmResourceBudget({ intervalMs: 0 }); const cache = createWarmToolSessions({ budget });
    cache.keep("shared-ids", fixtureSession(), "same", { person: "osprey" });
    expect(cache.get("shared-ids", "same", "wren")).toBeUndefined();
    await cache.releaseAll(); expect(budget.stats().resources).toBe(0);
  });

  it("keeps capability files separate for people sharing a payer, thread and bot", () => {
    const turn = { threadId: "same-thread", botId: "same-bot", text: "", access: { via: "org-key" as const, identity: "shared-payer" } };
    const mount = (principalId: string, token: string) => withWarmTokens({ ...turn, principalId,
      integrations: { agents: { command: "node", args: [], env: { SAGAX_COMMS_TOKEN: token } } } }, turn.threadId);
    const a = mount("osprey", "fixture-osprey"), b = mount("wren", "fixture-wren");
    const first = a.integrations!.agents!.env.SAGAX_COMMS_TOKEN_FILE!, second = b.integrations!.agents!.env.SAGAX_COMMS_TOKEN_FILE!;
    try {
      expect(first).not.toBe(second); expect(readFileSync(first, "utf8")).toBe("fixture-osprey"); expect(readFileSync(second, "utf8")).toBe("fixture-wren");
    } finally { rmSync(dirname(first), { recursive: true, force: true }); rmSync(dirname(second), { recursive: true, force: true }); }
  });

  it("skips prewarming before a changed fingerprint can touch an active mount", async () => {
    const budget = new WarmResourceBudget({ intervalMs: 0 }); const cache = createWarmToolSessions({ budget });
    const session = fixtureSession(); cache.set("active", "old", session, { person: "osprey", active: true });
    expect(await cache.prewarm({ threadId: "active", principalId: "wren", text: "", integrations: {} }, { computerUse: false, driverKind: "fixture" })).toBe("skipped");
    expect(cache.get("active", "old", "osprey")).toBe(session); await cache.releaseAll();
  });

  it("a slow prewarm cannot replace a mount adopted by a real turn during its handshake", async () => {
    const budget = new WarmResourceBudget({ intervalMs: 0 });
    let ready!: (session: ReturnType<typeof fixtureSession>) => void;
    const mounted = new Promise<ReturnType<typeof fixtureSession>>(resolve => { ready = resolve; });
    const cache = createWarmToolSessions({ budget, mount: async () => mounted });
    const warming = cache.prewarm({ threadId: "racing", principalId: "osprey", text: "", integrations: {} }, { computerUse: false, driverKind: "fixture" });
    const active = fixtureSession(); cache.set("racing", "real", active, { person: "osprey", active: true });
    const slow = fixtureSession(); let closes = 0; slow.close = async () => { closes++; }; ready(slow);
    expect(await warming).toBe("skipped"); expect(closes).toBe(1);
    expect(cache.get("racing", "real", "osprey")).toBe(active); await cache.releaseAll();
  });
  it("writes the comms token file so a kept agents process can change turns", () => {
    const turn = {
      threadId: `thread-warm-${process.pid}-${Date.now()}`,
      botId: "bot-1",
      text: "hi",
      integrations: {
        agents: {
          command: "node",
          args: ["agents.js"],
          env: { SAGAX_COMMS_TOKEN: "token-a", SAGAX_TURN_DEPTH: "0", SAGAX_BOT_ID: "bot-1" },
        },
      },
    };
    const warmed = withWarmTokens(turn as never, turn.threadId);
    const file = warmed.integrations!.agents!.env.SAGAX_COMMS_TOKEN_FILE;
    expect(file).toBe(commsTokenFile(turn.threadId, turn.botId));
    expect(readFileSync(file!, "utf8")).toBe("token-a");
    const again = withWarmTokens({
      ...turn,
      integrations: {
        agents: {
          ...turn.integrations.agents,
          env: { ...turn.integrations.agents.env, SAGAX_COMMS_TOKEN: "token-b", SAGAX_TURN_DEPTH: "0" },
        },
      },
    } as never, turn.threadId);
    expect(again.integrations!.agents!.env.SAGAX_COMMS_TOKEN_FILE).toBe(file);
    expect(readFileSync(file!, "utf8")).toBe("token-b");
    // Fingerprint ignores the token value when the file is present.
    const fpA = chatToolsFingerprint(warmed.integrations, { computerUse: true, toolLimit: 128 });
    const fpB = chatToolsFingerprint(again.integrations, { computerUse: true, toolLimit: 128 });
    expect(fpA).toBe(fpB);
    rmSync(dirname(file!), { recursive: true, force: true });
  });

  it("reuses a session for the same fingerprint and drops it on mismatch", async () => {
    const cache = createWarmToolSessions();
    const closed: string[] = [];
    const session = {
      definitions: [],
      skipped: [],
      validate() {},
      view() { return { title: "t", input: {}, ask: false }; },
      async execute() { return { text: "ok", ok: true }; },
      async close() { closed.push("close"); },
    };
    cache.keep("thread-1", session as never, "fp-a");
    expect(cache.get("thread-1", "fp-a")).toBe(session);
    expect(cache.get("thread-1", "fp-b")).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).toContain("close");
    await cache.releaseAll();
  });

  it("chatToolsTurnLimit reserves a slot for ask_user when tools are on", () => {
    const withAsk = chatToolsTurnLimit({
      toolsEnabled: true,
      toolLimit: 128,
      driverKind: "openai-compat",
    });
    expect(withAsk.ok).toBe(true);
    if (withAsk.ok) expect(withAsk.toolLimit).toBe(127);
    const toolsOff = chatToolsTurnLimit({
      toolsEnabled: false,
      toolLimit: 128,
      driverKind: "openai-compat",
    });
    expect(toolsOff.ok).toBe(true);
    if (toolsOff.ok) expect(toolsOff.toolLimit).toBe(128);
  });
});

describe("openai-chat MCP prewarm (#1975)", () => {
  const dirs: string[] = [];
  const cleanup = () => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  };

  const fakeMcp = (label: string): { command: string; args: string[]; env: Record<string, string> } => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-mcp-prewarm-"));
    dirs.push(dir);
    const script = join(dir, "server.mjs");
    writeFileSync(script, `
import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin });
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
rl.on("line", (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") return reply(msg.id, { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: ${JSON.stringify(label)}, version: "0" } });
  if (msg.method === "notifications/initialized") return;
  if (msg.method === "tools/list") return reply(msg.id, { tools: [{ name: "ping", description: "ping", inputSchema: { type: "object", properties: {} } }] });
  if (msg.method === "tools/call") return reply(msg.id, { content: [{ type: "text", text: "pong-" + ${JSON.stringify(label)} }] });
});
`);
    chmodSync(script, 0o700);
    return { command: process.execPath, args: [script], env: {} };
  };

  it("prewarm mounts once; the first turn reuses that session", async () => {
    cleanup();
    const cache = createWarmToolSessions();
    const agents = fakeMcp("agents");
    const turn = {
      threadId: `t-reuse-${process.pid}`,
      botId: "bot-osprey",
      text: "",
      warmOnly: true,
      integrations: {
        agents: {
          ...agents,
          env: { ...agents.env, SAGAX_COMMS_TOKEN: "tok-1", SAGAX_TURN_DEPTH: "0", SAGAX_BOT_ID: "bot-osprey" },
        },
      },
    };
    const mounted = await cache.prewarm(turn as never, {
      computerUse: false,
      driverKind: "openai-compat",
      person: "person-osprey",
    });
    expect(mounted).toBe("mounted");
    expect(cache.has(turn.threadId)).toBe(true);
    expect(cache.isPrewarmed(turn.threadId)).toBe(true);
    expect(cache.personOf(turn.threadId)).toBe("person-osprey");

    const limit = chatToolsTurnLimit({
      toolsEnabled: true,
      toolLimit: undefined,
      driverKind: "openai-compat",
    });
    expect(limit.ok).toBe(true);
    if (!limit.ok) return;
    const warmTurn = withWarmTokens(turn as never, turn.threadId);
    const fp = chatToolsFingerprint(warmTurn.integrations, {
      computerUse: false,
      toolLimit: limit.toolLimit,
      callTimeoutMs: undefined,
    });
    const reused = cache.get(turn.threadId, fp);
    expect(reused).toBeDefined();
    cache.claim(turn.threadId);
    expect(cache.isPrewarmed(turn.threadId)).toBe(false);
    // Second prewarm with the same fingerprint is a keep, not a remount.
    expect(await cache.prewarm(turn as never, {
      computerUse: false,
      driverKind: "openai-compat",
      person: "person-osprey",
    })).toBe("skipped"); // A claimed mount belongs to the active turn.
    await cache.releaseAll();
    cleanup();
  });

  it("idle release drops an unused prewarmed mount", async () => {
    cleanup();
    const cache = createWarmToolSessions();
    const agents = fakeMcp("idle");
    const threadId = `t-idle-${process.pid}`;
    const turn = {
      threadId,
      botId: "bot-wren",
      text: "",
      integrations: { agents: { ...agents, env: { ...agents.env, SAGAX_COMMS_TOKEN: "tok", SAGAX_TURN_DEPTH: "0", SAGAX_BOT_ID: "bot-wren" } } },
    };
    expect(await cache.prewarm(turn as never, {
      computerUse: false,
      driverKind: "openai-compat",
      person: "person-wren",
    })).toBe("mounted");
    expect(cache.has(threadId)).toBe(true);
    await cache.release(threadId);
    expect(cache.has(threadId)).toBe(false);
    cleanup();
  });

  it("isolates prewarmed mounts between persons", async () => {
    cleanup();
    const cache = createWarmToolSessions({ maxPerPerson: PREWARM_MCP_PER_PERSON });
    const agentsA = fakeMcp("a");
    const agentsB = fakeMcp("b");
    const turnA = {
      threadId: `t-a-${process.pid}`,
      botId: "bot-a",
      text: "",
      integrations: { agents: { ...agentsA, env: { ...agentsA.env, SAGAX_COMMS_TOKEN: "a", SAGAX_TURN_DEPTH: "0", SAGAX_BOT_ID: "bot-a" } } },
    };
    const turnB = {
      threadId: `t-b-${process.pid}`,
      botId: "bot-b",
      text: "",
      integrations: { agents: { ...agentsB, env: { ...agentsB.env, SAGAX_COMMS_TOKEN: "b", SAGAX_TURN_DEPTH: "0", SAGAX_BOT_ID: "bot-b" } } },
    };
    expect(await cache.prewarm(turnA as never, { computerUse: false, driverKind: "openai-compat", person: "osprey" })).toBe("mounted");
    expect(await cache.prewarm(turnB as never, { computerUse: false, driverKind: "openai-compat", person: "wren" })).toBe("mounted");
    expect(cache.personOf(turnA.threadId)).toBe("osprey");
    expect(cache.personOf(turnB.threadId)).toBe("wren");
    expect(cache.prewarmedCount("osprey")).toBe(1);
    expect(cache.prewarmedCount("wren")).toBe(1);
    // Person A cannot read person B's session through B's thread id with A's fingerprint.
    const limit = chatToolsTurnLimit({ toolsEnabled: true, toolLimit: undefined, driverKind: "openai-compat" });
    expect(limit.ok).toBe(true);
    if (!limit.ok) return;
    const fpA = chatToolsFingerprint(withWarmTokens(turnA as never, turnA.threadId).integrations, {
      computerUse: false, toolLimit: limit.toolLimit,
    });
    expect(cache.get(turnB.threadId, fpA)).toBeUndefined();
    expect(cache.get(turnA.threadId, fpA)).toBeDefined();
    await cache.releaseAll();
    cleanup();
  });

  it("caps concurrent waiting prewarms per person", async () => {
    cleanup();
    const cache = createWarmToolSessions({ maxPerPerson: 2 });
    const mk = (n: number) => {
      const agents = fakeMcp(`cap-${n}`);
      return {
        threadId: `t-cap-${n}-${process.pid}`,
        botId: "bot-cap",
        text: "",
        integrations: {
          agents: {
            ...agents,
            env: { ...agents.env, SAGAX_COMMS_TOKEN: `tok-${n}`, SAGAX_TURN_DEPTH: "0", SAGAX_BOT_ID: "bot-cap" },
          },
        },
      };
    };
    const t1 = mk(1);
    const t2 = mk(2);
    const t3 = mk(3);
    expect(await cache.prewarm(t1 as never, { computerUse: false, driverKind: "openai-compat", person: "osprey" })).toBe("mounted");
    expect(await cache.prewarm(t2 as never, { computerUse: false, driverKind: "openai-compat", person: "osprey" })).toBe("mounted");
    expect(cache.prewarmedCount("osprey")).toBe(2);
    // A third waiting prewarm evicts the oldest of this person.
    expect(await cache.prewarm(t3 as never, { computerUse: false, driverKind: "openai-compat", person: "osprey" })).toBe("mounted");
    expect(cache.has(t1.threadId)).toBe(false);
    expect(cache.has(t2.threadId)).toBe(true);
    expect(cache.has(t3.threadId)).toBe(true);
    expect(cache.prewarmedCount("osprey")).toBe(2);
    await cache.releaseAll();
    cleanup();
  });

  it("aborts a prewarm when the idle signal fires before mount finishes", async () => {
    cleanup();
    const cache = createWarmToolSessions();
    const controller = new AbortController();
    controller.abort();
    const agents = fakeMcp("abort");
    const turn = {
      threadId: `t-abort-${process.pid}`,
      botId: "bot-abort",
      text: "",
      integrations: { agents: { ...agents, env: { ...agents.env, SAGAX_COMMS_TOKEN: "x", SAGAX_TURN_DEPTH: "0", SAGAX_BOT_ID: "bot-abort" } } },
    };
    expect(await cache.prewarm(turn as never, {
      computerUse: false,
      driverKind: "openai-compat",
      person: "osprey",
      signal: controller.signal,
    })).toBe("aborted");
    expect(cache.has(turn.threadId)).toBe(false);
    cleanup();
  });

  it("skips prewarm when there are no integrations", async () => {
    const cache = createWarmToolSessions();
    expect(await cache.prewarm({ threadId: "t", text: "" } as never, {
      computerUse: false,
      driverKind: "openai-compat",
    })).toBe("skipped");
  });
});

