// The engines' own slash commands in the chat (shared/harness-commands.ts).
//
// GET /api/bots/:id/harness-commands[?refresh=1] lists what the bot's engine
// offers for its turns: read by the engine itself (ProviderInstance.
// listCommands) in the folder and isolation those turns get, so a command
// shows only when a turn will load it. Cached per bot, engine and scope;
// `refresh=1` reads again. On an organization server the scope is the
// SPEAKER's: their own subscription and claude.ai connectors change the
// list, so it is cached per bot and person then (commandListAccess).
//
// A message whose first word is one of them reaches the engine verbatim
// (resolveTypedCommand): Sagax's own commands win a name collision, the
// engine's is then /engine:<name>; one the chat cannot run is refused. In a
// group the command goes to one bot only (groupCommandTarget).
import {
  isSagaxCommandName,
  parseTypedCommand,
  resolveTypedCommand,
  type CommandResolution,
  type HarnessCommand,
  type HarnessCommandList,
} from "../shared/harness-commands.ts";
import type { HarnessCommandScope, TurnAccessInput } from "./contracts.ts";
import type { RequestAuth } from "./auth/request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

export const HARNESS_COMMANDS_PATH = /^\/api\/bots\/([\w-]+)\/harness-commands$/;
const TTL_MS = 10 * 60_000;

export type HarnessEngine = HarnessCommandList["engine"];

/** The engines whose commands Sagax lists and passes through. */
export function harnessEngineFor(driverKind: string): HarnessEngine | null {
  if (driverKind === "claudeAgent") return "claude";
  if (driverKind === "codex") return "codex";
  return null;
}

export interface HarnessCommandSource {
  botId: string;
  instanceId: string;
  engine: HarnessEngine;
  scope: HarnessCommandScope;
  list(scope: HarnessCommandScope): Promise<HarnessCommand[]>;
}

/** Commands per bot, engine and scope, read at most once at a time. */
export class HarnessCommandCatalog {
  private readonly cache = new Map<string, HarnessCommandList>();
  private readonly inflight = new Map<string, Promise<HarnessCommandList>>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: { now?: () => number; ttlMs?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? TTL_MS;
  }

  private key(source: HarnessCommandSource): string {
    const { cwd, withholdHostTools, mcpFromUserConfig, access, claudeAiConnectors, pluginDirs } = source.scope;
    // per bot and, where it changes the list, per person: a subscription's
    // login directory and the claude.ai connectors of that account; and the
    // bot's plugins (their commands and skills)
    return JSON.stringify([source.botId, source.instanceId, cwd ?? null, Boolean(withholdHostTools), Boolean(mcpFromUserConfig), access?.identity ?? null, Boolean(claudeAiConnectors), pluginDirs ?? []]);
  }

  /** The last list read for this source, at any age. */
  cached(source: HarnessCommandSource): HarnessCommandList | undefined {
    return this.cache.get(this.key(source));
  }

  read(source: HarnessCommandSource, force = false): Promise<HarnessCommandList> {
    const key = this.key(source);
    const cached = this.cache.get(key);
    if (!force && cached && this.now() - cached.at < this.ttlMs) return Promise.resolve(cached);
    const running = this.inflight.get(key);
    if (running) return running;
    const work = source.list(source.scope)
      .then((commands) => {
        const list: HarnessCommandList = { engine: source.engine, commands, at: this.now() };
        this.cache.set(key, list);
        return list;
      })
      // a failed read keeps the last good list
      .catch((error: unknown) => {
        if (cached) return cached;
        throw error;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, work);
    return work;
  }
}

/** What of a turn's credentials shapes the engine's command list: a
 * person's own subscription (their login directory) only. A key, the
 * organization's or the server's access lists what the server's engine
 * lists, so those speakers share one list. Never carries a secret. */
export function commandListAccess(access: TurnAccessInput | undefined): TurnAccessInput | undefined {
  if (access?.via !== "subscription") return undefined;
  if (!access.claudeConfigDir && !access.codexHome) return undefined;
  return {
    via: "subscription",
    identity: access.identity,
    ...(access.claudeConfigDir ? { claudeConfigDir: access.claudeConfigDir } : {}),
    ...(access.codexHome ? { codexHome: access.codexHome } : {}),
  };
}

/** What a person's message is for its turn: the engine command it runs, a
 * refusal, or nothing special. Only a message that starts with a command
 * name Sagax does not own ever asks the engine for its list. */
export async function typedCommandForTurn(
  text: string,
  source: HarnessCommandSource | null,
  catalog: HarnessCommandCatalog,
): Promise<CommandResolution> {
  const typed = parseTypedCommand(text);
  if (!source || !typed) return { kind: "none" };
  if (isSagaxCommandName(typed.name)) return { kind: "sagax", name: typed.name.toLowerCase() };
  let commands: readonly HarnessCommand[];
  try {
    commands = (await catalog.read(source)).commands;
  } catch {
    commands = catalog.cached(source)?.commands ?? [];
  }
  return resolveTypedCommand(text, commands);
}

/** The refusal shown when a typed command cannot run from the chat. */
export function unavailableCommandError(resolution: Extract<CommandResolution, { kind: "unavailable" }>): { error: string; code: string } {
  const label = `/${resolution.command.name}`;
  return resolution.reason === "interactive"
    ? { code: "harness_command_interactive", error: `${label} needs the engine's own terminal and cannot run from the chat.` }
    : { code: "harness_command_managed", error: `${label} is managed by Sagax (model, effort, conversations, approvals and MCP servers have their own settings).` };
}

// ── route ────────────────────────────────────────────────────────────────

export interface HarnessCommandRouteDeps {
  /** The bot's command source for the caller, a refusal, or null when its
   * engine lists no commands. */
  sourceFor(auth: RequestAuth, botId: string, threadId: string | null, groupId?: string | null): { status: number; error: string } | HarnessCommandSource | null;
  catalog: HarnessCommandCatalog;
}

/** GET /api/bots/:id/harness-commands[?threadId=…][&groupId=…][&refresh=1]
 * (`groupId`: the bot as a member of that group, `threadId` then one of
 * the group's conversations). */
export function createHarnessCommandRoutes(deps: HarnessCommandRouteDeps): RouteHandler {
  return async ({ res, url, path, method, auth, json }) => {
    const match = HARNESS_COMMANDS_PATH.exec(path);
    if (!match) return PASS;
    res.setHeader("cache-control", "no-store");
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    const threadId = url.searchParams.get("threadId");
    if (threadId !== null && !/^[\w-]{1,128}$/.test(threadId)) return json(res, 400, { error: "threadId must be a task id" });
    const groupId = url.searchParams.get("groupId");
    if (groupId !== null && !/^[\w-]{1,128}$/.test(groupId)) return json(res, 400, { error: "groupId must be a group id" });
    const source = deps.sourceFor(auth, match[1] ?? "", threadId, groupId);
    if (source && "status" in source) return json(res, source.status, { error: source.error });
    if (!source) return json(res, 200, { available: false, reason: "not_supported", commands: [] });
    try {
      const list = await deps.catalog.read(source, url.searchParams.get("refresh") === "1");
      return json(res, 200, { available: true, ...list });
    } catch {
      return json(res, 200, { available: false, reason: "unavailable", engine: source.engine, commands: [] });
    }
  };
}
