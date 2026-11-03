// Running an artifact's source with nobody there
// (docs/superpowers/specs/2026-10-16-artifacts-design.md, "Refresh").
//
// A source runs alone only when it needs no approval, checked on every run:
//   - workspace_read, the bot's reviewed read of a text file in its own
//     workspace (a file it keeps up to date, say stats.json);
//   - a Perspicax tool reviewed as read-only (PERSPICAX_READ_ONLY_TOOLS), in
//     the name of the person the artifact belongs to, through the delegated
//     path a routine uses;
//   - a tool of one of the bot's remote MCP servers that the person allowed
//     for good ("Always allow": mcp:<server>__<tool>) and that is not
//     switched off;
//   - a command on the bot's own Local VM while the bot runs in Full access
//     or, 2026-10-26, in Auto ("Approve for me") when the artifact is its
//     owner's own (a bot of another person stays blocked at Auto). The
//     person's server environment (cloud sandbox) is not reachable from
//     here: its shell is a tool mounted for a turn, not an exec this runner
//     can route, so a command there still waits for a turn.
// Anything else is blocked, with the reason, and no call is made. Every
// dependency comes from server/index.ts, so the rules are tested here.
import { PERSPICAX_READ_ONLY_TOOLS } from "../drivers/acp/grok-read-only-tools.ts";
import type { McpServerSpec, RemoteMcpSpec } from "../contracts.ts";
import { RemoteMcpClient } from "../mcp/mcp-http.ts";
import { parseToolId } from "../../shared/approval-describe.ts";
import type { Artifact } from "../../shared/artifacts.ts";
import type { ArtifactRun } from "./artifacts.ts";

export interface ArtifactSourceBot {
  id: string;
  /** "vm" is the bot's own Local VM. */
  computer?: string;
  /** The person who owns the bot. At Auto a command runs only for an
   * artifact of that person (unknown: blocked). */
  ownerPrincipalId?: string;
  perspicaxProfiles?: readonly string[];
}

export interface ArtifactSourceDeps {
  bot(botId: string): ArtifactSourceBot | null;
  /** The conversation whose approval settings apply: where it was saved,
   * while that conversation is still the bot's; else the bot's main one. */
  threadFor(artifact: Artifact): string;
  fullAccess(botId: string, threadId: string): boolean;
  /** The conversation's level (sourceApprovalMode). When given, Auto lets
   * an owner's command refresh too; absent, only Full does. */
  approvalLevel?(botId: string, threadId: string): string | undefined;
  alwaysAllowed(botId: string, threadId: string, key: string): boolean;
  /** The bot's MCP server by name, signed in, or undefined. */
  mcpServer(botId: string, threadId: string, server: string): Promise<McpServerSpec | undefined>;
  toolDisabled(server: string, tool: string): boolean;
  /** The text of a file in the bot's own workspace (workspace-files.ts
   * readWorkspaceText: refuses a path outside it, a link, a binary). */
  workspaceRead(botId: string, path: string): string;
  callRemote?(spec: RemoteMcpSpec, tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolAnswer>;
  /** Perspicax, on an organization server with a link; absent otherwise. */
  perspicax?: {
    call(input: { artifact: Artifact; bot: ArtifactSourceBot; tool: string; args: Record<string, unknown>; signal: AbortSignal }): Promise<ToolAnswer | { error: string }>;
  };
  vm: {
    /** running: a command can go; else why it waits. */
    state(botId: string): Promise<"running" | "stopped" | "held">;
    exec(botId: string, command: string): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut?: boolean }>;
  };
}

export interface ToolAnswer {
  isError: boolean;
  value: unknown;
}

export const SOURCE_BLOCKED = {
  gone: "The bot that saved this artifact is gone.",
  command: "A command refreshes alone only on the bot's own Local VM while the bot is in Approve for me or Full access, for its owner's own artifact. Ask the bot to use a read tool instead.",
  tool: "This tool needs your approval each time, so it cannot refresh alone. Allow it always for this bot, or ask the bot to use a read tool.",
  disabled: "This tool is turned off for this workspace.",
  unknown: "This source is not one Sagax can run alone: workspace_read, a Perspicax read tool, an allowed tool of one of the bot's MCP servers, or a command on its Local VM.",
} as const;

/** stdout as JSON when it is JSON, else its text. */
export function commandValue(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** What a tools/call result holds: its structured content, else its first
 * text block read as JSON when it is JSON. */
export function toolResultValue(result: unknown): ToolAnswer {
  const record = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const isError = record.isError === true;
  if (record.structuredContent !== undefined) return { isError, value: record.structuredContent };
  const blocks = Array.isArray(record.content) ? record.content : [];
  const text = blocks.find((block): block is { type: string; text: string } =>
    Boolean(block) && typeof block === "object" && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string");
  return { isError, value: text ? commandValue(text.text) : null };
}

/** The Perspicax tool a source names, bare or behind its bridge's server
 * (mcp__<server>__cw_psa_query), when it is one reviewed as read-only. */
export function perspicaxReadTool(tool: string): string | null {
  if (PERSPICAX_READ_ONLY_TOOLS.has(tool)) return tool;
  const stripped = tool.replace(/^mcp__[A-Za-z0-9_.-]+?__/, "");
  if (stripped !== tool && PERSPICAX_READ_ONLY_TOOLS.has(stripped)) return stripped;
  return null;
}

/** The agents catalog's own workspace_read, bare or behind its server. */
export function isWorkspaceRead(tool: string): boolean {
  return tool === "workspace_read" || /^mcp__(?:agents|sagax)__workspace_read$/.test(tool);
}

function errorText(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    const message = (value as { error?: unknown; message?: unknown }).error ?? (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

async function defaultCallRemote(spec: RemoteMcpSpec, tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolAnswer> {
  const client = new RemoteMcpClient(spec);
  try {
    await client.initialize("Sagax artifacts", signal);
    return toolResultValue(await client.request("tools/call", { name: tool, arguments: args }, signal));
  } finally {
    await client.close().catch(() => {});
  }
}

export function createArtifactSourceRunner(deps: ArtifactSourceDeps): (artifact: Artifact, signal: AbortSignal) => Promise<ArtifactRun> {
  const blocked = (error: string): ArtifactRun => ({ ok: false, blocked: true, error });
  const answer = (result: ToolAnswer): ArtifactRun => result.isError
    ? { ok: false, error: errorText(result.value, "The tool answered with an error.") }
    : { ok: true, value: result.value };
  // Full runs as before. Auto runs only the owner's own artifact on the
  // owner's own bot: never another person's.
  const commandMayRun = (bot: ArtifactSourceBot, artifact: Artifact, threadId: string): boolean => {
    if (deps.fullAccess(bot.id, threadId)) return true;
    if (deps.approvalLevel?.(bot.id, threadId) !== "auto") return false;
    return Boolean(bot.ownerPrincipalId) && (artifact.ownerPrincipalId ?? bot.ownerPrincipalId) === bot.ownerPrincipalId;
  };
  return async (artifact, signal) => {
    const source = artifact.source;
    if (!source) return blocked(SOURCE_BLOCKED.unknown);
    const bot = deps.bot(artifact.botId);
    if (!bot) return blocked(SOURCE_BLOCKED.gone);
    const threadId = deps.threadFor(artifact);

    if (source.kind === "command") {
      if (bot.computer !== "vm" || !commandMayRun(bot, artifact, threadId)) return blocked(SOURCE_BLOCKED.command);
      const state = await deps.vm.state(bot.id);
      if (state === "stopped") return { ok: false, waiting: true, error: "The bot's Local VM is not running; the next refresh tries again." };
      if (state === "held") return { ok: false, waiting: true, error: "Someone is controlling the bot's computer; the next refresh tries again." };
      const result = await deps.vm.exec(bot.id, source.command);
      if (result.timedOut) return { ok: false, error: "The command ran past its time limit." };
      if (result.exitCode !== 0) return { ok: false, error: `The command exited with ${result.exitCode}${result.stderr.trim() ? `: ${result.stderr.trim().split("\n")[0]}` : "."}` };
      return { ok: true, value: commandValue(result.stdout) };
    }

    if (isWorkspaceRead(source.tool)) {
      const path = typeof source.args.path === "string" ? source.args.path : "";
      if (!path.trim()) return { ok: false, error: "workspace_read needs args.path, a file of your workspace." };
      try {
        return { ok: true, value: commandValue(deps.workspaceRead(bot.id, path)) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "The file could not be read." };
      }
    }

    const perspicaxTool = perspicaxReadTool(source.tool);
    if (perspicaxTool && deps.perspicax && bot.perspicaxProfiles?.length) {
      const result = await deps.perspicax.call({ artifact, bot, tool: perspicaxTool, args: source.args, signal });
      return "error" in result ? { ok: false, error: result.error } : answer(result);
    }

    const parsed = parseToolId(source.tool);
    if (!parsed.server) return blocked(SOURCE_BLOCKED.unknown);
    const spec = await deps.mcpServer(bot.id, threadId, parsed.server);
    if (!spec || !("url" in spec)) return blocked(SOURCE_BLOCKED.unknown);
    if (deps.toolDisabled(parsed.server, parsed.name)) return blocked(SOURCE_BLOCKED.disabled);
    if (!deps.alwaysAllowed(bot.id, threadId, `mcp:${parsed.server}__${parsed.name}`)) return blocked(SOURCE_BLOCKED.tool);
    return answer(await (deps.callRemote ?? defaultCallRemote)(spec, parsed.name, source.args, signal));
  };
}
