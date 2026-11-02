// What the server's own frames and requests mean for the Mastery tier
// (shared/achievements-mastery.ts, docs/achievements.md). Pure: server/index.ts
// passes each live frame and each successful request here with a few lookups
// (whose thread, which bot, what model) and records the facts that come back
// for their person. Nothing here reads the store or the clock.
import type { MasteryFact } from "../shared/achievements-mastery.ts";
import { looksFrench } from "../shared/achievements-mastery.ts";
import { isMasteryCharacter, masteryLock } from "../shared/mascot-unlocks.ts";

/** A fact for one person; `id` makes it count once. */
export interface PersonFact {
  person: string;
  fact: MasteryFact;
  id?: string;
}

/** MCP servers that are Sagax's own (the bot's tools, the browser, the computer), not integrations. */
const BUILT_IN_SERVERS: ReadonlySet<string> = new Set(["agents", "browser", "computer", "sagax", "omb"]);

/**
 * The integration a tool line used: `mcp__<server>__<tool>` names its MCP
 * server; a Perspicax profile (`perspicax_<slug>`) serves several APIs, each
 * one an integration (`mcp__perspicax_example__cw_psa_query` is perspicax:cw_psa).
 */
export function integrationOfTool(name: string): string | null {
  const parts = name.split("__");
  if (parts.length < 3 || parts[0] !== "mcp") return null;
  const server = parts[1]!.toLowerCase();
  if (!server || BUILT_IN_SERVERS.has(server)) return null;
  if (server.startsWith("perspicax") && parts.length >= 4 && parts[2]) return `perspicax:${parts[2].toLowerCase()}`;
  // one `_` since Perspicax 1.9.19: the api is what comes before the kind
  const api = server.startsWith("perspicax") && parts.length === 3 ? /^([a-z0-9][a-z0-9_]*?)_(?:read_action|query|write|action)$/i.exec(parts[2] ?? "") : null;
  if (api) return `perspicax:${api[1]!.toLowerCase()}`;
  return server;
}

/** The skill a tool line loaded (Claude and Kimi `Skill`, Hermes `skill_view`), from its redacted input. */
export function skillOfTool(name: string, input: unknown): string | null {
  if (name !== "Skill" && name !== "skill_view" && !/(?:^|__)skill_view$/.test(name)) return null;
  let fields: unknown = input;
  if (typeof input === "string") {
    try {
      fields = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (!fields || typeof fields !== "object") return null;
  const value = (fields as Record<string, unknown>).skill ?? (fields as Record<string, unknown>).name;
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase().slice(0, 80) : null;
}

/**
 * Would this tool change a system? A cheap reading of its name: Perspicax
 * `_write` and `_action` tools, file edits, shell commands, and MCP tools
 * whose verb creates, updates, deletes or sends. A read (`_query`, `Read`,
 * `Grep`, a search) is not.
 */
export function toolWrites(tool: string | undefined): boolean {
  if (!tool) return false;
  const name = tool.toLowerCase();
  // `_write` since Perspicax 1.9.19 (`cw_psa_write`), `__write` before
  if (/_(?:read_action)$/.test(name)) return false;
  if (/_(?:write|action)$/.test(name)) return true;
  if (/__(?:query|read|list|get|search|describe|lookup)$/.test(name) || name.endsWith("_query")) return false;
  if (/^(?:write|edit|multiedit|notebookedit|bash|shell|apply_patch|computer_exec)$/.test(name)) return true;
  return /(?:^|[_.-])(?:create|update|delete|remove|send|post|put|patch|write|insert|upload|move|rename|execute|run)(?:[_.-]|$)/.test(name);
}

export type ModelFamily = "anthropic" | "openai" | "xai" | "google" | "moonshot" | "meta" | "mistral" | "qwen" | "deepseek";

/** The provider family of a model id or an engine name ("claude-opus-4" and "claude" are anthropic). */
export function modelFamily(model: string | undefined | null): ModelFamily | null {
  if (!model) return null;
  const id = model.toLowerCase();
  if (/claude|opus|sonnet|haiku|fable|anthropic/.test(id)) return "anthropic";
  if (/grok|xai/.test(id)) return "xai";
  if (/gemini|google|gemma/.test(id)) return "google";
  if (/kimi|moonshot|\bk[23]\b/.test(id)) return "moonshot";
  if (/llama|meta/.test(id)) return "meta";
  if (/mistral|codestral|devstral/.test(id)) return "mistral";
  if (/qwen/.test(id)) return "qwen";
  if (/deepseek/.test(id)) return "deepseek";
  if (/gpt|codex|openai|\bo\d|astra|sol|terra|luna/.test(id)) return "openai";
  return null;
}

export interface FrameLookups {
  /** The person a thread's work counts for (its owner, else the bot's owner). */
  threadPerson(threadId: string): string | null;
  /** The bot of a thread. */
  threadBot(threadId: string): string | null;
  /** The model a thread's turn ran on (the thread's own, else the bot's), when known. */
  threadModel(threadId: string): string | null;
  /** Auto picked this thread's running turn: was it cheaper than the bot's own model? null when not Auto. */
  autoCheaper(threadId: string): boolean | null;
  /** A routine's person, bot and whether it carries its last report. */
  routine(routineId: string, run: { runAs?: unknown; botId?: unknown }): { person: string | null; botId?: string; continuity: boolean } | null;
}

const FAILED_RUNS: ReadonlySet<string> = new Set(["failed", "missed"]);

/** The Mastery facts one live frame means. */
export function masteryFrameFacts(payload: Record<string, unknown>, lookups: FrameLookups): PersonFact[] {
  // a routine run that ended: completed, or failed / missed
  if (payload.kind === "routine.run" && payload.run && typeof payload.run === "object") {
    const run = payload.run as { id?: unknown; status?: unknown; routineId?: unknown; runAs?: unknown; botId?: unknown };
    if (typeof run.id !== "string" || typeof run.routineId !== "string" || typeof run.status !== "string") return [];
    const ok = run.status === "completed";
    if (!ok && !FAILED_RUNS.has(run.status)) return [];
    const routine = lookups.routine(run.routineId, run);
    if (!routine?.person) return [];
    return [{ person: routine.person, id: `run:${run.id}`, fact: { kind: "routine.outcome", routineId: run.routineId, ok, continuity: routine.continuity, ...(routine.botId ? { botId: routine.botId } : {}) } }];
  }

  // a turn that started or ended, from the engine's runtime events
  if (payload.kind === "runtime" && payload.event && typeof payload.event === "object") {
    const event = payload.event as { type?: unknown; threadId?: unknown; ok?: unknown; provider?: unknown };
    // runtime frames are many (every delta): only a turn's start and end matter
    if (typeof event.threadId !== "string" || (event.type !== "turn.started" && event.type !== "turn.completed")) return [];
    const person = lookups.threadPerson(event.threadId);
    const botId = lookups.threadBot(event.threadId);
    if (!person || !botId) return [];
    if (event.type === "turn.started") return [{ person, fact: { kind: "turn.started", threadId: event.threadId, botId } }];
    if (event.type !== "turn.completed") return [];
    const family = modelFamily(lookups.threadModel(event.threadId)) ?? modelFamily(typeof event.provider === "string" ? event.provider : null);
    const cheaper = lookups.autoCheaper(event.threadId);
    return [{
      person,
      fact: { kind: "turn.done", threadId: event.threadId, botId, ok: event.ok === true, ...(family ? { provider: family } : {}), ...(cheaper !== null ? { auto: { cheaper } } : {}) },
    }];
  }

  if ((payload.kind !== "message" && payload.kind !== "message.patch") || typeof payload.threadId !== "string" || !payload.message || typeof payload.message !== "object") return [];
  const threadId = payload.threadId;
  const message = payload.message as {
    role?: unknown;
    kind?: unknown;
    text?: unknown;
    turnTerminal?: unknown;
    from?: unknown;
    tool?: { name?: unknown; input?: unknown; parentItemId?: unknown };
    card?: { requestId?: unknown; requestType?: unknown; answered?: unknown; dismissed?: unknown; tool?: unknown; toolHints?: { readOnly?: unknown; destructive?: unknown } };
  };
  // streamed text patches are many: decide what the frame is before looking anyone up
  const card = message.card && typeof message.card.requestId === "string" && message.card.requestType !== "question" ? message.card : null;
  const tool = message.kind === "activity" && message.tool && typeof message.tool.name === "string" ? message.tool : null;
  const answer = message.role === "bot" && message.kind === "text" && message.turnTerminal === true && typeof message.text === "string" && message.from === undefined;
  if (!card && !tool && !answer) return [];
  const person = lookups.threadPerson(threadId);
  if (!person) return [];

  // an approval card: asked of the person, then answered by them
  if (card && typeof card.requestId === "string") {
    const tool = typeof card.tool === "string" ? card.tool : undefined;
    if (card.answered === undefined && payload.kind === "message") return [{ person, id: `asked:${card.requestId}`, fact: { kind: "approval.requested" } }];
    if ((card.answered === "allow" || card.answered === "deny") && card.dismissed !== true) {
      const write = card.toolHints?.readOnly === true ? false : card.toolHints?.destructive === true || toolWrites(tool);
      return [{ person, id: `answered:${card.requestId}`, fact: { kind: "approval.answered", threadId, allow: card.answered === "allow", write } }];
    }
    return [];
  }

  // a tool line: a sub-agent at work, an integration, a skill loaded
  if (tool && typeof tool.name === "string") {
    const name = tool.name;
    const subagent = typeof tool.parentItemId === "string" && tool.parentItemId ? tool.parentItemId : undefined;
    const integration = integrationOfTool(name) ?? undefined;
    const skill = skillOfTool(name, tool.input) ?? undefined;
    if (!subagent && !integration && !skill) return [];
    return [{ person, fact: { kind: "tool.used", threadId, ...(subagent ? { subagent } : {}), ...(integration ? { integration } : {}), ...(skill ? { skill } : {}) } }];
  }

  // a bot's final answer: its language (rooms aside, where several bots answer)
  if (answer && typeof message.text === "string") return [{ person, fact: { kind: "reply", threadId, french: looksFrench(message.text) } }];
  return [];
}

export interface RequestFactLookups {
  /** Who published a catalogue bot (null when it is not published). */
  catalogPublisher(botId: string): string | null;
  /** The person's conversations right now (Ten Hands), or null to skip. */
  census(person: string): { open: number; folders: number; stale: number } | null;
}

/**
 * The Mastery facts a successful request means, from its method and path
 * only (the handler already authorized it). `person` made the request.
 */
export function masteryRequestFacts(request: { method: string; path: string; status: number }, person: string, lookups: RequestFactLookups): PersonFact[] {
  if (request.status < 200 || request.status >= 300) return [];
  const { method, path } = request;
  const routine = method === "PATCH" ? path.match(/^\/api\/routines\/([\w-]+)$/) : null;
  if (routine) return [{ person, fact: { kind: "routine.edited", routineId: routine[1]! } }];
  const stop = method === "POST" ? path.match(/^\/api\/bots\/([\w-]+)\/interrupt$/) : null;
  if (stop) return [{ person, fact: { kind: "bot.stopped", botId: stop[1]! } }];
  const memory = method === "PUT" ? path.match(/^\/api\/bots\/([\w-]+)\/memory(?:\/file)?$/) : null;
  if (memory) return [{ person, fact: { kind: "memory.written", botId: memory[1]! } }];
  const imported = method === "POST" ? path.match(/^\/api\/bot-catalog\/([\w-]+)\/import$/) : null;
  if (imported) {
    const publisher = lookups.catalogPublisher(imported[1]!);
    if (!publisher || publisher === person) return [];
    return [{ person: publisher, fact: { kind: "catalog.imported", botId: imported[1]!, importer: person } }];
  }
  // a conversation archived, moved to a folder or reopened: look at the whole picture again
  if (method === "PATCH" && /^\/api\/bots\/[\w-]+\/tasks\/[\w-]+$/.test(path)) {
    const census = lookups.census(person);
    return census ? [{ person, fact: { kind: "threads.census", ...census } }] : [];
  }
  return [];
}

/** A message sent to a bot: its language, and whether it steered the running turn. */
export function masterySendFacts(input: { threadId: string; text: string; steered: boolean }, person: string): PersonFact[] {
  return [{ person, fact: { kind: "message.sent", threadId: input.threadId, french: looksFrench(input.text), ...(input.steered ? { steered: true } : {}) } }];
}

export interface CensusTask {
  threadId: string;
  archivedAt?: number | null;
  projectId?: string | null;
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Ten Hands' look at a person's conversations: the open ones in folders, how
 * many folders they fill, and how many open ones (in a folder or not) went 30
 * days without activity. A bot's main conversation is not counted.
 */
export function threadCensus(tasks: readonly CensusTask[], mainThreads: ReadonlySet<string>, now: number, staleDays = 30): { open: number; folders: number; stale: number } {
  const limit = now - staleDays * 86_400_000;
  let open = 0;
  let stale = 0;
  const folders = new Set<string>();
  for (const task of tasks) {
    if (task.archivedAt || mainThreads.has(task.threadId)) continue;
    if ((task.updatedAt ?? task.createdAt ?? now) < limit) stale += 1;
    if (!task.projectId) continue;
    open += 1;
    folders.add(task.projectId);
  }
  return { open, folders: folders.size, stale };
}

/** A delegation that came back: the facts for the delegating thread's person. */
export function masteryDelegationFacts(input: { person: string | null; sourceThreadId: string; toBotId: string; ok: boolean; sourceModel: string | null; workerModel: string | null; id: string }): PersonFact[] {
  if (!input.person) return [];
  const from = modelFamily(input.sourceModel);
  const to = modelFamily(input.workerModel);
  return [{
    person: input.person,
    id: `delegation:${input.id}`,
    fact: { kind: "delegation.done", threadId: input.sourceThreadId, toBotId: input.toBotId, ok: input.ok, crossModel: Boolean(from && to && from !== to) },
  }];
}

/* ------------------------------------------------------------------ */
/* A locked look cannot be saved                                       */
/* ------------------------------------------------------------------ */

export interface LookRefusal {
  error: string;
  code: "look_locked";
  /** The achievement that unlocks it. */
  achievement: string;
  character: string;
  skin?: string;
}

function lookFields(value: unknown): { character?: string; skins: Record<string, string> } {
  if (!value || typeof value !== "object") return { skins: {} };
  const look = value as { character?: unknown; skins?: unknown };
  const skins: Record<string, string> = {};
  if (look.skins && typeof look.skins === "object") for (const [character, skin] of Object.entries(look.skins as Record<string, unknown>)) if (typeof skin === "string") skins[character] = skin;
  return { ...(typeof look.character === "string" ? { character: look.character } : {}), skins };
}

/**
 * Does saving `next` on a bot that wears `previous` put on a Mastery look
 * (shared/mascot-unlocks.ts) its person has not unlocked? What the bot
 * already wears stays allowed (never taken back); only a change is checked.
 * `keys` are the person's reward keys (the snapshot's `rewards`).
 */
export function lockedLookChange(previous: unknown, next: unknown, keys: ReadonlySet<string>): LookRefusal | null {
  if (next === undefined || next === null) return null;
  const before = lookFields(previous);
  const after = lookFields(next);
  const refuse = (achievement: string, character: string, skin?: string): LookRefusal => ({
    error: `This look is locked until the achievement "${achievement}" is unlocked.`,
    code: "look_locked",
    achievement,
    character,
    ...(skin ? { skin } : {}),
  });
  if (after.character && after.character !== before.character) {
    const lock = masteryLock(keys, after.character);
    if (lock.locked && lock.achievement) return refuse(lock.achievement, after.character);
  }
  for (const [character, skin] of Object.entries(after.skins)) {
    if (!isMasteryCharacter(character) || before.skins[character] === skin) continue;
    // the skin alone (its character's own lock is the check above, when it is worn)
    const lock = masteryLock(new Set([...keys, `character:${character}`]), character, skin);
    if (lock.locked && lock.achievement) return refuse(lock.achievement, character, skin);
  }
  return null;
}
