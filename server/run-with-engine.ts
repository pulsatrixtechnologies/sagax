// run_with_engine (2026-10-28): a bot runs one part of its work on another
// engine or model it may use, then carries on with the result. Example: a
// Claude bot reads the person's Microsoft Teams through their own Grok
// account's connectors, then answers in Claude.
//
// The sub-turn is the same bot, in a fresh thread of its own, for the same
// person: the turn's speaker (peerSpeaker of the source thread) keeps that
// person's credentials, routine lineage and connectors; the thread keeps
// the bot's approval level and rules, so the organization's Refuse and Ask
// first rules apply as on any turn. The engines offered are the ones this
// turn's payer may run here (index.ts relayEnginesFor): the organization's
// engine list and the payer's own sign-ins and keys are the only limit.
//
// Pure: the server passes the engines and the request.
import { modelSwitchNeedsAsk, type ApprovalMode } from "../shared/approval-mode.ts";
import { handoffModel } from "../shared/handoff-model.ts";

export const RUN_WITH_ENGINE_TOOL_NAME = "run_with_engine";

export interface RelayEngine {
  instanceId: string;
  driverKind: string;
  displayName: string;
  models: { default?: string; options: ReadonlyArray<{ id: string; label?: string }> };
  /** 2026-10-29: the person's second sign-in on this engine (their other
   * Grok account), with what it is. Its displayName names it ("Grok
   * (personal account)"), and it is addressed as `<instanceId>#second`. */
  account?: "second";
  accountKind?: "personal" | "team";
}

export type RelayChoice =
  | { ok: true; instanceId: string; model: string; engineLabel: string; driverKind: string; account?: "second" }
  | { ok: false; error: string };

/** How a second sign-in is addressed by id (`grok#second`). */
export function relayEngineId(engine: Pick<RelayEngine, "instanceId" | "account">): string {
  return engine.account === "second" ? `${engine.instanceId}#second` : engine.instanceId;
}

/** The name of a sign-in beside the engine's: "Grok (personal account)". */
export function relayAccountLabel(engineName: string, kind: "personal" | "team" | undefined): string {
  return `${engineName} (${kind === "personal" ? "personal account" : kind === "team" ? "team account" : "second account"})`;
}

/** What a person or a model calls an engine, mapped to its driver. */
const DRIVER_ALIASES: ReadonlyArray<[RegExp, string]> = [
  [/^(?:grok|grok build|xai|x\.ai)$/, "grokAgent"],
  [/^(?:claude|claude code|anthropic)$/, "claudeAgent"],
  [/^(?:codex|chatgpt|openai codex)$/, "codex"],
  [/^(?:gemini|gemini cli)$/, "geminiAgent"],
  [/^(?:cursor)$/, "cursorAgent"],
  [/^(?:kimi|kimi code)$/, "kimiAgent"],
  [/^(?:qwen|qwen code)$/, "qwenAgent"],
];

const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
/** "Grok (personal account)", "grok personal", "personal grok account" all
 * name the same sign-in: parentheses and the word account dropped. */
const normAccount = (value: string) => norm(value.replace(/[()]/g, " ").replace(/\baccount\b/gi, " ").replace(/\s+/g, " "));

/** The engines this turn may hand a part to, one line each, for the model. */
export function relayEngineList(engines: readonly RelayEngine[]): string {
  if (!engines.length) return "none";
  return engines.map((engine) => {
    const models = engine.models.options.slice(0, 8).map((option) => option.id).join(", ");
    return `${engine.displayName} (engine "${relayEngineId(engine)}"${models ? `; models: ${models}` : ""})`;
  }).join("; ");
}

/** The engine and model a run_with_engine call asked for, among the ones
 * this turn may use. The engine is named by its instance id, its display
 * name or its family ("grok", "claude"); the model must be one that engine
 * lists (handoffModel), else its default. */
export function chooseRelayEngine(input: {
  engine: string;
  model?: string;
  engines: readonly RelayEngine[];
  /** The engine the calling turn runs on: running the same engine and model
   * again is no relay, unless a part there loads account connectors the
   * calling turn does not (relayAddsAccountConnectors true: a bot on Grok
   * without the opt-in, connectors/turn-plan.ts relayAddsAccountConnectors).
   * That part loads them (engineRelay), so it is a real relay (#3344: the bot
   * is told of its own Grok sign-in's connectors). */
  current?: { instanceId: string; model: string; account?: "second"; relayAddsAccountConnectors?: boolean };
}): RelayChoice {
  const asked = norm(input.engine);
  if (!asked) return { ok: false, error: `Name the engine. Engines you may use here: ${relayEngineList(input.engines)}.` };
  const driver = DRIVER_ALIASES.find(([pattern]) => pattern.test(asked))?.[1];
  const byId = input.engines.find((engine) => norm(relayEngineId(engine)) === asked);
  const byName = input.engines.filter((engine) => norm(engine.displayName) === asked);
  // a sign-in by what it is: "grok personal", "Grok (team account)", "personal grok"
  const askedAccount = normAccount(asked);
  const byAccount = input.engines.filter((engine) => {
    if (!engine.accountKind) return false;
    if (normAccount(engine.displayName) === askedAccount) return true;
    const kind = engine.accountKind;
    if (!askedAccount.startsWith(`${kind} `) && !askedAccount.endsWith(` ${kind}`)) return false;
    const family = askedAccount.replace(new RegExp(`^${kind} | ${kind}$`), "").trim();
    const familyDriver = DRIVER_ALIASES.find(([pattern]) => pattern.test(family))?.[1];
    return familyDriver === engine.driverKind || family === normAccount(engine.displayName.replace(/\(.*\)/, ""));
  });
  // the family names the first of its engines that lists the model asked for
  // (the person's first sign-in before their second)
  const byDriver = driver ? input.engines.filter((engine) => engine.driverKind === driver).toSorted((a, b) => Number(a.account === "second") - Number(b.account === "second")) : [];
  const wanted = input.model?.trim();
  const pickFrom = (list: readonly RelayEngine[]) => list.find((engine) => wanted && engine.models.options.some((option) => option.id === wanted)) ?? list[0];
  const engine = byId ?? pickFrom(byName) ?? pickFrom(byAccount) ?? pickFrom(byDriver);
  if (!engine) {
    return { ok: false, error: `"${input.engine.trim().slice(0, 60)}" is not an engine you may use here. Engines you may use: ${relayEngineList(input.engines)}.` };
  }
  const chosen = handoffModel({
    instanceId: engine.instanceId,
    ...(wanted ? { requested: wanted } : {}),
    models: engine.models.options.map((option) => option.id),
    ...(engine.models.default ? { defaultModel: engine.models.default } : {}),
  });
  if (!chosen) return { ok: false, error: `${engine.displayName} lists no model you may use here.` };
  if (wanted && chosen.model !== wanted && engine.models.options.length > 0) {
    return { ok: false, error: `${engine.displayName} does not offer the model "${wanted.slice(0, 80)}". Its models: ${engine.models.options.map((option) => option.id).join(", ")}.` };
  }
  if (input.current && input.current.relayAddsAccountConnectors !== true && input.current.instanceId === chosen.instanceId && input.current.model === chosen.model && (input.current.account ?? null) === (engine.account ?? null)) {
    return { ok: false, error: `You already run on ${engine.displayName} with ${chosen.model}: do this part yourself in this turn.` };
  }
  return { ok: true, instanceId: chosen.instanceId, model: chosen.model, engineLabel: engine.displayName, driverKind: engine.driverKind, ...(engine.account ? { account: engine.account } : {}) };
}

/** The part's thread level: the bot's own, unless that engine cannot run
 * it (a Custom grant never crosses engines), then Ask. Full carries to any
 * engine that runs Full (modelSwitchNeedsAsk, 2026-10-26). Undefined keeps
 * the bot's level; the organization's and the person's Refuse and Ask first
 * rules apply in that thread as on any turn of the bot. */
export function relayThreadLevel(input: { botLevel: ApprovalMode; fromDriver?: string; toDriver: string }): "ask" | undefined {
  return modelSwitchNeedsAsk(input.botLevel, input.fromDriver, input.toDriver) ? "ask" : undefined;
}

/** The first line of the sub-turn: the bot's own words, never the person's. */
export function relayOpening(input: { engineLabel: string; sourceTitle?: string; message: string }): string {
  const from = input.sourceTitle?.trim() ? ` from #${input.sourceTitle.trim()}` : "";
  return `[Part of your own work you handed to yourself on ${input.engineLabel}${from}, for the same person, with their own accounts and connectors on this engine. The request below is your own words, not the person's. Do it here and end with the result itself (the data, the text, what was done), complete and plain: it goes back to your other turn as is.]\n\n${input.message}`;
}

/** The tool's answer once the sub-turn ended. */
export function relayResultText(input: { engineLabel: string; model: string; status: "reply" | "failed" | "error"; text: string }): string {
  const head = `${input.engineLabel} (${input.model})`;
  if (input.status === "reply") return `${head} finished. Its result:\n${input.text}`;
  if (input.status === "failed") return `${head} started and failed: ${input.text}\nTell the person plainly; do not claim the work was done.`;
  return `${head} could not start: ${input.text}\nTell the person plainly; do not claim the work was done.`;
}
