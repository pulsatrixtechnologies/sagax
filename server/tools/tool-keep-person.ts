// #4527 lot E: what a person sees and changes of the tools one of their bots
// keeps listed (server/tools/tool-keep.ts), from the bot's tool selection
// card and from the sagax_settings key bot.toolsLeftOut.
//
// Read: GET /api/bots/:id/capabilities carries `toolKeep` (the person's own
// left out and always listed tools for that bot). Change: PATCH
// /api/bots/:id with `{ toolKeep: { bringAllBack: true } }` or
// `{ toolKeep: { tool: "<server>/<tool>", alwaysListed: true|false } }`, a
// request of its own. Any person who may use the bot changes their own
// evidence only: one person's choice never reaches another person's list,
// so no administrator is involved.
//
// When it takes effect: at the bot's next conversation (or after a context
// renewal). A running conversation keeps the list its session started with,
// so its engine's prompt cache is never broken mid-conversation; meanwhile
// every left out tool is still one search away.
import type { ToolKeepView } from "../../shared/capabilities.ts";
import { toolIdParts } from "../../shared/searched-tool-call.ts";
import { parseLocalPromptMode, usesCompactPrompt } from "../context/compact-prompt.ts";
import { engineLeavesOut, type ListingEngine } from "./tool-keep-listing.ts";
import { bringAllToolsBack, readToolKeep, setToolAlwaysListed } from "./tool-keep.ts";

export type ToolKeepChange = { kind: "all" } | { kind: "one"; tool: string; on: boolean };

/** The person a bot's tool keeping is read and changed for: the signed-in
 * person on an organization server (a bot's act in a person's turn runs on
 * that person's own session, server/index-leaves/performBotActRoute.ts),
 * else the bot's owner (the one person of a personal server), as a turn of
 * theirs counts it. Null on an organization server for a caller who is no
 * signed-in person: nobody's list is read or changed then, so one person's
 * write never reaches another person's list. */
export function toolKeepPersonFor(deps: { organization: boolean; sessionPrincipal: (auth: unknown) => string | null | undefined; effectiveBotOwner: (bot: never) => string }, auth: unknown, bot: unknown): string | null {
  if (deps.organization) return deps.sessionPrincipal(auth)?.trim() || null;
  return deps.effectiveBotOwner(bot as never);
}

/** The engine a bot's next turn runs on, as far as its listing goes: the
 * same compact-prompt answer a turn start reads (start-turn-prompt.ts). */
export function toolKeepEngine(bot: { localPrompt?: unknown; modelSelection?: { model?: unknown } }, driverKind: string | undefined, env: Record<string, string | undefined> = process.env): ListingEngine {
  const kind = driverKind ?? "";
  const model = typeof bot.modelSelection?.model === "string" ? bot.modelSelection.model : null;
  return { driverKind: kind, compactPrompt: usesCompactPrompt({ bot: parseLocalPromptMode(bot.localPrompt), engine: parseLocalPromptMode(env.SAGAX_LOCAL_PROMPT), driverKind: kind, model }) };
}

/** The person's own view of one bot: the tools its engine really leaves out
 * of the list up front (engineLeavesOut) and the ones they keep listed
 * always, sorted. */
export function toolKeepView(botId: string, person: string, engine: ListingEngine): ToolKeepView {
  const state = readToolKeep(botId, person);
  const always = new Set(state.alwaysListed);
  return { leftOut: state.leftOut.filter((id) => !always.has(id) && engineLeavesOut(id, engine)), alwaysListed: [...state.alwaysListed] };
}

/** A change as sent, checked: bring every tool back, or keep one listed. */
export function parseToolKeepChange(value: unknown): ToolKeepChange | { error: string } {
  const change = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (change?.bringAllBack === true && Object.keys(change).length === 1) return { kind: "all" };
  if (change && typeof change.tool === "string" && typeof change.alwaysListed === "boolean" && Object.keys(change).length === 2 && toolIdParts(change.tool)) {
    return { kind: "one", tool: change.tool, on: change.alwaysListed };
  }
  return { error: "toolKeep is {bringAllBack: true} or {tool: \"<server>/<tool>\", alwaysListed: true|false}." };
}

/** Applies a change for one bot and person; the view after it. */
export function applyToolKeepChange(botId: string, person: string, change: ToolKeepChange, engine: ListingEngine): ToolKeepView {
  if (change.kind === "all") bringAllToolsBack(botId, person);
  else setToolAlwaysListed(botId, person, change.tool, change.on);
  return toolKeepView(botId, person, engine);
}
