// #4527 lots C and E review: a tool a bot's session leaves out of its list
// up front is reached through the agents server's call_tool, and that call
// is under EXACTLY the approvals the tool had when it was listed, on every
// engine that leaves it out (Codex, the ACP engines, Muse Code, Pi on a
// cloud model, the chat-completions engines). Each engine is driven through
// its own permission path; what it asks is then read by the rules exactly as
// Sagax reads an engine's request.opened (customRuleCallOf).
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import type { CustomRule } from "../../shared/custom-rules.ts";
import { mcpAllowKey } from "../../shared/approval-describe.ts";
import { agentsSearchedFromEnv } from "../../shared/searched-tool-call.ts";
import { reviewCustomRules } from "../rules/custom-rules-review.ts";
import { customRuleCallOf } from "../runtime-events/request-opened.ts";
import { withKeptAgentsListing } from "../tools/tool-keep-listing.ts";
import { gateServer } from "../mcp/mcp-gate-config.ts";
import { createPermissionHandler } from "./acp/session-permission.ts";
import { attachCodexTools } from "./codex/tools.ts";
import { mountChatTools, type ChatToolSession } from "./chat-mcp-tools.ts";
import { MuseCodeDriver } from "./muse-code.ts";
import { buildMcpServers } from "./pi.ts";
import { turnStdioMcpServers } from "./turn-mcp.ts";

// Muse Code runs behind its SDK's connection: a fake one, driven by the test
const muse = vi.hoisted(() => ({
  notify: undefined as undefined | ((notification: { method: string; params: unknown }) => void),
  commands: [] as Array<{ method: string; params: any }>,
}));
vi.mock("@muse-code/sdk", () => ({
  MspError: class MspError extends Error {},
  spawnMspConnection: () => {
    const connection = {
      onNotification: (listener: (notification: { method: string; params: unknown }) => void) => { muse.notify = listener; },
      onProtocolError: () => {},
      onServerRequest: () => {},
      command: async (method: string, params: unknown) => {
        muse.commands.push({ method, params });
        return method === "session/start" ? { session: { sessionId: "s-1", modelId: "muse-wonder-1.0" } } : {};
      },
      request: async () => ({ models: [] }),
      mintCommandId: () => "native-1",
    };
    return {
      initialize: async () => ({ connection, exited: new Promise(() => {}), initializeResult: { grantedCapabilities: ["sessionMcp"] }, close: async () => {} }),
      close: async () => {},
    };
  },
}));

const AGENTS = { command: "node", args: ["agents-proxy.js"], env: { SAGAX_BOT_ID: "bot-1" } as Record<string, string> };
/** The agents mount of a session that leaves out run_routine and list_rooms. */
const KEPT = withKeptAgentsListing(AGENTS, ["agents/run_routine", "agents/list_rooms"], { driverKind: "codex", compactPrompt: false })!;
const ARGS = { routine_id: "r-1", path: "~/.ssh/id_rsa" };
const HOME = "/Users/example";

const rule = (behavior: CustomRule["behavior"], org: boolean): CustomRule => ({
  id: `r-${behavior}-${org}`, ownerId: org ? "pr_admin" : "pr_alice", botId: org ? null : "bot-1",
  when: "utiliser l'outil agents__run_routine", behavior, riskScope: [], enabled: true, org, createdAt: 1, updatedAt: 1,
} as CustomRule);
/** What Sagax's rules decide for one request an engine opened. */
const decided = (event: any, rules: CustomRule[]) => reviewCustomRules(rules, customRuleCallOf(event, "engine-1"), "bot-1", HOME).decision.kind;

/** One request an engine opens, and how it answers the engine. */
type Asked = { opened?: any; answered?: unknown };
type Engine = {
  name: string;
  /** whether this engine asks Sagax about an agents tool at all (same answer listed or left out) */
  asks: boolean;
  /** a direct call of a listed tool, and the same tool through call_tool */
  ask(call: { tool: string; args: Record<string, unknown> } | { via: string; args: Record<string, unknown> }, options?: { full?: boolean }): Promise<Asked>;
};

const sleep = (ms = 0) => new Promise((done) => setTimeout(done, ms));

// ── ACP (Grok, Gemini, Copilot, Cursor...): session/request_permission ──
function acpEngine() {
  const sessionAllows = new Map<string, Set<string>>();
  const sent: any[] = [];
  const events: any[] = [];
  const handler = createPermissionHandler({
    support: {} as never, DRIVER_KIND: "grokAgent", DENY_TIMEOUT_NOTE: "", QUESTION_NO_MATCH_NOTE: "",
    threadId: "t-acp", commandCwd: undefined, send: (message) => sent.push(message), emit: (event) => events.push(event),
    base: () => ({}), sessionAllows, handleClientFileRequest: async () => {},
    getSession: () => ({ sessionId: "s-acp" }) as never, active: new Map(),
  });
  let id = 0;
  const current = (full: boolean, mount = KEPT) => ({
    turnId: "turn-acp", state: {}, flushAssistantText: () => {}, asks: new Map(), mountedServers: new Set(["agents"]),
    turn: { integrations: { agents: mount }, approvalMode: full ? undefined : "ask" }, turnConfig: { fullAuto: full },
  });
  const options = [{ optionId: "once", kind: "allow_once" }, { optionId: "always", kind: "allow_always" }, { optionId: "no", kind: "reject_once" }];
  const engine: Engine & { answer(opened: any, behavior: string, always?: boolean): unknown; current: ReturnType<typeof current> | undefined } = {
    name: "ACP", asks: true, current: undefined,
    async ask(call, opts = {}) {
      const turn = engine.current = current(opts.full === true, "via" in call ? KEPT : AGENTS);
      const toolCall = "via" in call
        ? { toolCallId: `c-${++id}`, kind: "other", title: "agents__call_tool", rawInput: { name: call.via, arguments: call.args } }
        : { toolCallId: `c-${++id}`, kind: "other", title: `agents__${call.tool}`, rawInput: call.args };
      const before = events.length;
      const sentBefore = sent.length;
      handler({ jsonrpc: "2.0", id, method: "session/request_permission", params: { toolCall, options } }, turn as never);
      return { opened: events.slice(before).find((event) => event.type === "request.opened"), answered: sent.slice(sentBefore)[0]?.result?.outcome?.optionId };
    },
    answer(opened, behavior, always) {
      const finish = engine.current!.asks.get(opened.requestId) as (behavior: string, source: string, message?: string, always?: boolean) => unknown;
      const sentBefore = sent.length;
      finish(behavior, "user", undefined, always);
      return sent.slice(sentBefore)[0]?.result?.outcome?.optionId;
    },
  };
  return engine;
}

// ── Codex: an MCP tool's elicitation, Sagax's gate answers it ──
function codexEngine(): Engine {
  const events: any[] = [];
  const sent: any[] = [];
  const session = (full: boolean) => {
    const s: any = {
      input: { threadId: "t-codex", text: "" }, approvalMode: "ask", withholdHostTools: false,
      send: (message: unknown) => sent.push(message), emit: (event: unknown) => events.push(event), base: () => ({}),
      threadId: "t-codex", turnId: "turn-codex", codexThreadId: "c-1", commandCwd: undefined, controlsHost: false,
      // prepare-launch.ts adds the agents mount here when its listing is kept
      directoryMounts: new Set(agentsSearchedFromEnv(KEPT.env) ? ["agents"] : []),
      autoAcceptPermissions: full, asks: new Map(), state: {},
    };
    attachCodexTools(s);
    return s;
  };
  let id = 0;
  return {
    name: "Codex", asks: true,
    async ask(call, opts = {}) {
      const s = session(opts.full === true);
      const tool = "via" in call ? "call_tool" : call.tool;
      const params = "via" in call ? { name: call.via, arguments: call.args } : call.args;
      const before = events.length;
      s.handleServerRequest({ jsonrpc: "2.0", id: ++id, method: "mcpServer/elicitation/request", params: {
        serverName: "agents", mode: "form", message: `Allow the agents MCP server to run tool "${tool}"?`,
        _meta: { codex_approval_kind: "mcp_tool_call", tool_params: params }, requestedSchema: { type: "object", properties: {} },
      } });
      return { opened: events.slice(before).find((event) => event.type === "request.opened") };
    },
  };
}

// ── Muse Code: approval/requested over its SDK ──
async function museEngine() {
  const instance = await MuseCodeDriver.create({ instanceId: "muse-1", displayName: undefined, environment: {}, enabled: true, config: { cli: "muse" } } as never);
  const events: any[] = [];
  instance.adapter.onEvent((event: any) => events.push(event));
  let turns = 0;
  let id = 0;
  const startTurn = async (full: boolean, mount = KEPT) => {
    const threadId = `t-muse-${++turns}`;
    const before = muse.commands.length;
    await instance.adapter.sendTurn({ threadId, text: "go", cwd: tmpdir(), approvalMode: full ? "full" : "ask", integrations: { agents: mount } } as never);
    for (let n = 0; n < 50 && !muse.commands.slice(before).some((command) => command.method === "turn/start"); n++) await sleep(5);
    return threadId;
  };
  let thread: string | undefined;
  let threadFull: boolean | undefined;
  const engine: Engine & { answer(threadId: string, opened: any, behavior: "allow" | "deny", always?: boolean): Promise<unknown>; thread(): string; fresh(): void } = {
    name: "Muse Code", asks: true,
    thread: () => thread!,
    fresh: () => { thread = undefined; },
    async ask(call, opts = {}) {
      const full = opts.full === true;
      // one Muse session per engine posture; a session allow lives in it
      if (!thread || threadFull !== full) { thread = await startTurn(full); threadFull = full; }
      const name = "via" in call ? "agents_call_tool" : `agents_${call.tool}`;
      const rawArgs = JSON.stringify("via" in call ? { name: call.via, arguments: call.args } : call.args);
      const itemId = `i-${++id}`;
      const before = events.length;
      const commandsBefore = muse.commands.length;
      muse.notify!({ method: "item/started", params: { sessionId: "s-1", item: { itemId, kind: "toolCall", status: "inProgress", turnId: "native-1", tool: name, args: rawArgs } } });
      muse.notify!({ method: "approval/requested", params: {
        approvalId: `a-${id}`, sessionId: "s-1", itemId, toolName: name, rawArgs, currentRequirementId: { approvalId: `a-${id}`, sourceIndex: 0 },
        subject: { kind: "tool", toolName: name },
        availableChoices: [
          { choiceId: "c-once", label: "Allow", decision: "approved", scope: "once" },
          { choiceId: "c-session", label: "Allow for session", decision: "approvedForSession", scope: "session" },
          { choiceId: "c-deny", label: "Deny", decision: "denied", scope: "once" },
        ],
      } });
      await sleep(1);
      const decided = muse.commands.slice(commandsBefore).find((command) => command.method === "approval/decide");
      return { opened: events.slice(before).find((event) => event.type === "request.opened"), answered: decided?.params.choiceId };
    },
    async answer(threadId, opened, behavior, always) {
      const before = muse.commands.length;
      await instance.adapter.respondToRequest(threadId, opened.requestId, { behavior, ...(always ? { always: true } : {}) } as never);
      return muse.commands.slice(before).find((command) => command.method === "approval/decide")?.params.choiceId;
    },
  };
  return engine;
}

// ── a chat-completions engine: its own MCP client over the agents server ──
const dirs: string[] = [];
const chatSessions: ChatToolSession[] = [];
afterAll(async () => {
  await Promise.all(chatSessions.map((session) => session.close()));
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
/** A stand-in agents server: the kept listing (search_tools, describe_tool,
 * call_tool and list_bots) or the whole one (run_routine listed). */
function fakeAgents(kept: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "omb-searched-call-"));
  dirs.push(dir);
  const script = join(dir, "agents.mjs");
  const object = { type: "object", properties: {}, additionalProperties: true };
  const tools = kept
    ? [{ name: "search_tools", inputSchema: object }, { name: "describe_tool", inputSchema: object }, { name: "call_tool", inputSchema: object }, { name: "list_bots", inputSchema: object }]
    : [{ name: "run_routine", inputSchema: object }, { name: "list_rooms", inputSchema: object }, { name: "list_bots", inputSchema: object }];
  writeFileSync(script, `#!/usr/bin/env node
    const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\\n")) !== -1) {
        const message = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
        if (message.method === "initialize") send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} } } });
        else if (message.method === "tools/list") send({ jsonrpc: "2.0", id: message.id, result: { tools: ${JSON.stringify(tools)} } });
        else if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "ran" }] } });
      }
    });
  `);
  chmodSync(script, 0o755);
  return { command: script, args: [], env: kept ? { ...KEPT.env } : { ...AGENTS.env } };
}
async function chatEngine(toolScope?: { allow?: string[]; deny?: string[] }) {
  const controller = new AbortController();
  const kept = await mountChatTools({ agents: fakeAgents(true) } as never, controller.signal, false, toolScope as never);
  const whole = await mountChatTools({ agents: fakeAgents(false) } as never, controller.signal, false, toolScope as never);
  chatSessions.push(kept, whole);
  const engine: Engine & { kept: ChatToolSession; whole: ChatToolSession } = {
    name: "chat-completions", asks: false, kept, whole,
    async ask(call) {
      // openai-chat-turn.ts: a view that asks goes to Sagax (request.opened)
      const view = "via" in call ? kept.view("agents_call_tool", { name: call.via, arguments: call.args }) : whole.view(`agents_${call.tool}`, call.args);
      return { opened: view.ask ? { type: "request.opened", requestType: "permission", tool: view.title, summary: view.title, mcpTool: view.mcpTool, input: JSON.stringify(view.input), grant: view.grant } : undefined };
    },
  };
  return engine;
}

// ── Pi on a cloud model: its MCP extension confirms only a gated mount ──
function piEngine(): Engine {
  return {
    name: "Pi (cloud model)", asks: false,
    async ask(call) {
      const servers = buildMcpServers({ threadId: "t-pi", text: "", integrations: { agents: "via" in call ? KEPT : AGENTS } } as never)! as Record<string, { scope?: string; searched?: boolean }>;
      // pi-mcp-extension.ts confirms a call (extension_ui_request) only on a
      // mount whose scope is approval, custom or local-computer
      const gated = ["approval", "custom", "local-computer"].includes(servers.agents?.scope ?? "");
      return { opened: gated ? { type: "request.opened" } : undefined };
    },
  };
}

describe("a left out tool through call_tool is under exactly the approvals it had listed, per engine", () => {
  const engines: Array<() => Promise<Engine>> = [async () => acpEngine(), async () => codexEngine(), () => museEngine(), () => chatEngine(), async () => piEngine()];

  it.each(engines.map((make, index) => [["ACP", "Codex", "Muse Code", "chat-completions", "Pi (cloud model)"][index]!, make] as const))("%s", async (_name, make) => {
    const engine = await make();
    const direct = await engine.ask({ tool: "run_routine", args: ARGS });
    const searched = await engine.ask({ via: "run_routine", args: ARGS });
    // the same answer to "does this engine ask Sagax about it"
    expect(Boolean(searched.opened)).toBe(Boolean(direct.opened));
    expect(Boolean(searched.opened)).toBe(engine.asks);
    if (!engine.asks) return;

    // the card and every rule read the TARGET, never call_tool
    expect(searched.opened.mcpTool).toBe("agents__run_routine");
    expect(searched.opened.mcpTool).toBe(direct.opened.mcpTool);
    expect(`${searched.opened.tool} ${searched.opened.summary}`).not.toMatch(/call_tool/);
    expect(`${searched.opened.tool} ${searched.opened.summary}`).toMatch(/run_routine/);
    // an organization Refuse rule refuses, Ask first asks, as for the listed tool
    for (const [behavior, org] of [["deny", true], ["ask", true], ["deny", false]] as const) {
      expect(decided(searched.opened, [rule(behavior, org)])).toBe(behavior);
      expect(decided(searched.opened, [rule(behavior, org)])).toBe(decided(direct.opened, [rule(behavior, org)]));
    }
    // an allow for the bot names this tool alone
    expect(mcpAllowKey(searched.opened.mcpTool)).toBe("mcp:agents__run_routine");
    // a sensitive path in the target's arguments reaches the safety review
    expect(searched.opened.input).toContain("~/.ssh/id_rsa");
  });
});

describe("Full access is not asked through call_tool when it is not asked listed", () => {
  it("ACP answers both once, with no card", async () => {
    const acp = acpEngine();
    const direct = await acp.ask({ tool: "run_routine", args: ARGS }, { full: true });
    const searched = await acp.ask({ via: "run_routine", args: ARGS }, { full: true });
    expect(direct.opened).toBeUndefined();
    expect(searched.opened).toBeUndefined();
    expect(searched.answered).toBe("once");
  });

  it("Muse Code answers both with no card", async () => {
    const engine = await museEngine();
    const direct = await engine.ask({ tool: "run_routine", args: ARGS }, { full: true });
    const searched = await engine.ask({ via: "run_routine", args: ARGS }, { full: true });
    expect(direct.opened).toBeUndefined();
    expect(searched.opened).toBeUndefined();
    expect(searched.answered).toBe("c-once");
  });

  it("Codex hands both to Sagax's gate, where Full answers them alike", async () => {
    const codex = codexEngine();
    const direct = await codex.ask({ tool: "run_routine", args: ARGS }, { full: true });
    const searched = await codex.ask({ via: "run_routine", args: ARGS }, { full: true });
    expect(searched.opened.mcpTool).toBe(direct.opened.mcpTool);
  });
});

describe("Always allow for the session covers the target only", () => {
  it("ACP: the engine is allowed once, the next call of the same tool needs no card, another left out tool asks", async () => {
    const acp = acpEngine();
    const first = await acp.ask({ via: "run_routine", args: ARGS });
    expect(first.opened).toMatchObject({ mcpTool: "agents__run_routine", allowSession: true });
    // never the engine's own allow_always: it would cover every call_tool
    expect(acp.answer(first.opened, "allow", true)).toBe("once");
    const again = await acp.ask({ via: "run_routine", args: { routine_id: "r-2" } });
    expect(again.opened).toBeUndefined();
    expect(again.answered).toBe("once");
    const other = await acp.ask({ via: "list_rooms", args: {} });
    expect(other.opened).toMatchObject({ mcpTool: "agents__list_rooms" });
    // a listed tool keeps the engine's own allow_always, as before
    const listed = await acp.ask({ tool: "list_bots", args: { q: 1 } });
    expect(acp.answer(listed.opened, "allow", true)).toBe("always");
  });

  it("Muse Code: Muse is allowed once, the next call of the same tool needs no card, another left out tool asks", async () => {
    const engine = await museEngine();
    const first = await engine.ask({ via: "run_routine", args: ARGS });
    expect(first.opened).toMatchObject({ mcpTool: "agents__run_routine", tool: "agents_run_routine", allowSession: true });
    expect(await engine.answer(engine.thread(), first.opened, "allow", true)).toBe("c-once");
    const again = await engine.ask({ via: "run_routine", args: { routine_id: "r-2" } });
    expect(again.opened).toBeUndefined();
    expect(again.answered).toBe("c-once");
    const other = await engine.ask({ via: "list_rooms", args: {} });
    expect(other.opened).toMatchObject({ mcpTool: "agents__list_rooms" });
    // a listed tool keeps Muse's own session allow, as before
    const listed = await engine.ask({ tool: "list_bots", args: {} });
    expect(listed.opened).toMatchObject({ mcpTool: "agents__list_bots" });
    expect(await engine.answer(engine.thread(), listed.opened, "allow", true)).toBe("c-session");
  });

  it("Muse Code: a call_tool whose target cannot be read is never allowed for the session", async () => {
    const engine = await museEngine();
    const unread = await engine.ask({ tool: "call_tool", args: { arguments: {} } });
    expect(unread.opened).toMatchObject({ allowSession: false });
    expect(await engine.answer(engine.thread(), unread.opened, "allow", true)).toBe("c-once");
  });

  it("a deny answers the one call, and the next one asks again", async () => {
    const acp = acpEngine();
    const first = await acp.ask({ via: "run_routine", args: ARGS });
    expect(acp.answer(first.opened, "deny")).toBe("no");
    expect((await acp.ask({ via: "run_routine", args: ARGS })).opened).toBeDefined();
  });
});

describe("a tool selection that excludes a left out tool still excludes it through call_tool", () => {
  const scope = { deny: ["mcp:agents:run_routine"] };

  it("ACP and Muse Code: the gate reads call_tool's target", () => {
    const servers = turnStdioMcpServers({ threadId: "t-scope", text: "", toolScope: scope, integrations: { agents: KEPT } } as never);
    const agents = servers.find((server) => server.name === "agents")!;
    expect(agents.env.SAGAX_GATE_DIRECTORY).toBe("1");
  });

  it("Codex and Pi: the gate they mount reads call_tool's target", () => {
    const gated = gateServer({ name: "agents", server: KEPT, threadId: "t-scope", budget: 0, toolScope: scope as never, nodeEnv: {} })!;
    expect(gated.env!.SAGAX_GATE_DIRECTORY).toBe("1");
    const pi = buildMcpServers({ threadId: "t-scope", text: "", toolScope: scope, integrations: { agents: KEPT } } as never)! as Record<string, { env?: Record<string, string>; searched?: boolean }>;
    expect(pi.agents!.searched).toBe(true);
  });

  it("a chat-completions engine refuses call_tool on the excluded tool and runs another", async () => {
    const chat = await chatEngine(scope);
    expect(() => chat.kept.validate("agents_call_tool", { name: "run_routine", arguments: {} })).toThrow("Tool selection excludes this tool");
    expect(() => chat.kept.validate("agents_call_tool", { name: "list_rooms", arguments: {} })).not.toThrow();
  });
});

// #4527 lot D: a connector's tool the session leaves out is reached through
// that connector's own call_tool (its gate's search), and that call is under
// exactly the approvals the tool had listed, on every engine.
describe("#4527 lot D: a connector's left out tool through call_tool, per engine", () => {
  const KEPT_CRM = { crm: { leftOut: ["crm/old_report"], offered: join(tmpdir(), "omb-kept-offered", "crm.json") } };
  const CRM_ARGS = { report_id: "q3", path: "~/.ssh/id_rsa" };
  const crmRule = (behavior: CustomRule["behavior"], org: boolean): CustomRule => ({ ...rule(behavior, org), when: "utiliser l'outil crm__old_report" });
  /** A connector with 14 tools and old_report: past the floor of a searched catalog. */
  function fakeCrm() {
    const dir = mkdtempSync(join(tmpdir(), "omb-kept-crm-"));
    dirs.push(dir);
    const script = join(dir, "crm.mjs");
    const object = { type: "object", properties: {}, additionalProperties: true };
    const tools = [...Array.from({ length: 14 }, (_, i) => ({ name: `crm_tool_${i}`, description: `CRM tool ${i}`, inputSchema: object })), { name: "old_report", description: "Old report", inputSchema: object }];
    writeFileSync(script, `#!/usr/bin/env node
      const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
      let buffer = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf("\\n")) !== -1) {
          const message = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
          if (message.method === "initialize") send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} } } });
          else if (message.method === "tools/list") send({ jsonrpc: "2.0", id: message.id, result: { tools: ${JSON.stringify(tools)} } });
          else if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "ran " + (message.params && message.params.name) } ] } });
        }
      });
    `);
    chmodSync(script, 0o755);
    return { command: script, args: [], env: {} as Record<string, string> };
  }

  it("ACP: the card, the rules and Always allow read the tool it runs; an unread target is never allowed for the session", () => {
    const sessionAllows = new Map<string, Set<string>>();
    const sent: any[] = [];
    const events: any[] = [];
    const handler = createPermissionHandler({
      support: {} as never, DRIVER_KIND: "geminiAgent", DENY_TIMEOUT_NOTE: "", QUESTION_NO_MATCH_NOTE: "",
      threadId: "t-acp-crm", commandCwd: undefined, send: (message) => sent.push(message), emit: (event) => events.push(event),
      base: () => ({}), sessionAllows, handleClientFileRequest: async () => {},
      getSession: () => ({ sessionId: "s-acp" }) as never, active: new Map(),
    });
    const current = {
      turnId: "turn-acp", state: {}, flushAssistantText: () => {}, asks: new Map(), mountedServers: new Set(["crm"]),
      turn: { integrations: { connectorsKept: KEPT_CRM }, approvalMode: "ask" }, turnConfig: { fullAuto: false },
    };
    const options = [{ optionId: "once", kind: "allow_once" }, { optionId: "always", kind: "allow_always" }, { optionId: "no", kind: "reject_once" }];
    let id = 0;
    const ask = (title: string, rawInput: unknown) => {
      const before = events.length;
      const sentBefore = sent.length;
      handler({ jsonrpc: "2.0", id: ++id, method: "session/request_permission", params: { toolCall: { toolCallId: `c-${id}`, kind: "other", title, rawInput }, options } }, current as never);
      return { opened: events.slice(before).find((event) => event.type === "request.opened"), answered: sent.slice(sentBefore)[0]?.result?.outcome?.optionId };
    };
    const answer = (opened: any, behavior: string, always?: boolean) => {
      const sentBefore = sent.length;
      (current.asks.get(opened.requestId) as (behavior: string, source: string, message?: string, always?: boolean) => unknown)(behavior, "user", undefined, always);
      return sent.slice(sentBefore)[0]?.result?.outcome?.optionId;
    };
    const direct = ask("crm__old_report", CRM_ARGS);
    const searched = ask("crm__call_tool", { name: "old_report", arguments: CRM_ARGS });
    expect(searched.opened).toMatchObject({ mcpTool: "crm__old_report", allowSession: true });
    expect(`${searched.opened.summary}`).not.toMatch(/call_tool/);
    for (const [behavior, org] of [["deny", true], ["ask", true], ["deny", false]] as const) {
      expect(decided(searched.opened, [crmRule(behavior, org)])).toBe(behavior);
      expect(decided(searched.opened, [crmRule(behavior, org)])).toBe(decided(direct.opened, [crmRule(behavior, org)]));
    }
    expect(mcpAllowKey(searched.opened.mcpTool)).toBe("mcp:crm__old_report");
    expect(searched.opened.input).toContain("~/.ssh/id_rsa");
    // Always allow: the engine once, the driver keeps that one tool
    expect(answer(searched.opened, "allow", true)).toBe("once");
    expect(ask("crm__call_tool", { name: "old_report", arguments: { report_id: "q4" } })).toMatchObject({ opened: undefined, answered: "once" });
    expect(ask("crm__call_tool", { name: "crm_tool_3", arguments: {} }).opened).toMatchObject({ mcpTool: "crm__crm_tool_3" });
    // a call_tool that names nothing is allowed once at most
    const unread = ask("crm__call_tool", { arguments: {} });
    expect(answer(unread.opened, "allow", true)).toBe("once");
    expect(ask("crm__call_tool", { arguments: {} }).opened).toBeDefined();
  });

  it("Muse Code: the connector is mounted behind its kept gate, and its call_tool asks as the tool it runs", async () => {
    const instance = await MuseCodeDriver.create({ instanceId: "muse-crm", displayName: undefined, environment: {}, enabled: true, config: { cli: "muse" } } as never);
    const events: any[] = [];
    instance.adapter.onEvent((event: any) => events.push(event));
    const before = muse.commands.length;
    await instance.adapter.sendTurn({ threadId: "t-muse-crm", text: "go", cwd: tmpdir(), approvalMode: "ask", integrations: { custom: { crm: fakeCrm() }, connectorsKept: KEPT_CRM } } as never);
    for (let n = 0; n < 50 && !muse.commands.slice(before).some((command) => command.method === "turn/start"); n++) await sleep(5);
    const started = muse.commands.slice(before).find((command) => command.method === "session/start");
    const mounted = JSON.stringify(started?.params ?? {});
    expect(mounted).toContain("SAGAX_GATE_SEARCH");
    expect(mounted).toContain("old_report");
    const ask = async (name: string, args: unknown, n: number) => {
      const rawArgs = JSON.stringify(args);
      const at = events.length;
      const commandsBefore = muse.commands.length;
      muse.notify!({ method: "item/started", params: { sessionId: "s-1", item: { itemId: `ci-${n}`, kind: "toolCall", status: "inProgress", turnId: "native-1", tool: name, args: rawArgs } } });
      muse.notify!({ method: "approval/requested", params: {
        approvalId: `ca-${n}`, sessionId: "s-1", itemId: `ci-${n}`, toolName: name, rawArgs, currentRequirementId: { approvalId: `ca-${n}`, sourceIndex: 0 },
        subject: { kind: "tool", toolName: name },
        availableChoices: [
          { choiceId: "c-once", label: "Allow", decision: "approved", scope: "once" },
          { choiceId: "c-session", label: "Allow for session", decision: "approvedForSession", scope: "session" },
        ],
      } });
      await sleep(1);
      return { opened: events.slice(at).find((event) => event.type === "request.opened"), answered: muse.commands.slice(commandsBefore).find((command) => command.method === "approval/decide")?.params.choiceId };
    };
    const searched = await ask("crm_call_tool", { name: "old_report", arguments: CRM_ARGS }, 1);
    expect(searched.opened).toMatchObject({ mcpTool: "crm__old_report", tool: "crm_old_report", allowSession: true });
    expect(decided(searched.opened, [crmRule("deny", true)])).toBe("deny");
    const commandsBefore = muse.commands.length;
    await instance.adapter.respondToRequest("t-muse-crm", searched.opened.requestId, { behavior: "allow", always: true } as never);
    expect(muse.commands.slice(commandsBefore).find((command) => command.method === "approval/decide")?.params.choiceId).toBe("c-once");
    expect(await ask("crm_call_tool", { name: "old_report", arguments: {} }, 2)).toMatchObject({ opened: undefined, answered: "c-once" });
    expect((await ask("crm_call_tool", { name: "crm_tool_1", arguments: {} }, 3)).opened).toMatchObject({ mcpTool: "crm__crm_tool_1" });
    expect((await ask("crm_call_tool", { arguments: {} }, 4)).opened).toMatchObject({ allowSession: false });
  });

  it("a chat-completions engine lists every connector tool but the left out one, and reads its call_tool as that tool", async () => {
    const controller = new AbortController();
    const session = await mountChatTools({ custom: { crm: fakeCrm() }, connectorsKept: KEPT_CRM } as never, controller.signal);
    chatSessions.push(session);
    const names = session.definitions.map((definition) => definition.function.name);
    expect(names).toEqual(expect.arrayContaining(["crm_crm_tool_0", "crm_crm_tool_13", "crm_search_tools", "crm_call_tool"]));
    expect(names).not.toContain("crm_old_report");
    const view = session.view("crm_call_tool", { name: "old_report", arguments: CRM_ARGS });
    expect(view).toMatchObject({ ask: true, mcpTool: "crm__old_report", toolId: "crm/old_report" });
    expect((await session.execute("crm_call_tool", { name: "old_report", arguments: {} }, controller.signal)).text).toBe("ran old_report");
    const scoped = await mountChatTools({ custom: { crm: fakeCrm() }, connectorsKept: KEPT_CRM } as never, controller.signal, false, { deny: ["mcp:crm:old_report"] } as never);
    chatSessions.push(scoped);
    // a tool selection that excludes the left out tool: its gate drops it
    // from the catalog, so it is neither listed nor one search away
    expect(scoped.definitions.map((definition) => definition.function.name)).not.toContain("crm_old_report");
    expect(() => scoped.validate("crm_call_tool", { name: "old_report", arguments: {} })).toThrow();
    expect(() => scoped.validate("crm_old_report", {})).toThrow();
  });

  it("Pi on a cloud model: the connector's gate keeps its listing and the mount reads call_tool's target", () => {
    const servers = buildMcpServers({ threadId: "t-pi-crm", text: "", integrations: { custom: { crm: { command: "node", args: ["crm.js"], env: {} } }, connectorsKept: KEPT_CRM } } as never)! as Record<string, { env: Record<string, string>; searched?: boolean; scope?: string }>;
    expect(servers.crm!.searched).toBe(true);
    expect(servers.crm!.scope).toBe("custom");
    expect(JSON.parse(servers.crm!.env.SAGAX_GATE_SEARCH!)).toEqual({ pinned: [], leftOut: ["old_report"] });
    expect(servers.crm!.env.SAGAX_GATE_OFFERED).toBe(KEPT_CRM.crm.offered);
  });
});
