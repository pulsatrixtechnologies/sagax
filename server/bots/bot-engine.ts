/** Shown instead of a raw `provider instance "" is unavailable` when a bot
 * has no engine and the person has none to give it (2026-10-19). */
import {
  ENGINE_REMOVED_MESSAGE,
  NO_ENGINE_CODE,
  NO_ENGINE_MESSAGE,
  NO_ENGINE_PERSON,
} from "../../shared/bot-engine-error.ts";

export {
  ENGINE_REMOVED_MESSAGE,
  NO_ENGINE_CODE,
  NO_ENGINE_MESSAGE,
  NO_ENGINE_PERSON,
};

/** The 409 a person's own turn gets. The message is English; `code` is what
 * the app translates into the language it is set to. */
export function noEngineError(): Error & { status: number; code: string } {
  return Object.assign(new Error(NO_ENGINE_PERSON), { status: 409, code: NO_ENGINE_CODE });
}

/** A selection that names an engine instance. An empty or blank id is the
 * "born without an engine" state: create_bot, an import, or a bot put on Auto
 * before any engine was ready. */
export function namesEngine(selection: { instanceId?: unknown } | undefined | null): boolean {
  return typeof selection?.instanceId === "string" && selection.instanceId.trim().length > 0;
}

/** Why a teammate cannot take work now because of its engine, or undefined
 * when its engine is usable. `known` says whether the engine instance exists
 * and is enabled on this server. The words are for the bot, which already
 * received them in French. */
export function engineProblem(
  selection: { instanceId?: unknown } | undefined | null,
  known: (instanceId: string) => boolean,
): string | undefined {
  if (!namesEngine(selection)) return NO_ENGINE_MESSAGE;
  return known((selection!.instanceId as string).trim()) ? undefined : ENGINE_REMOVED_MESSAGE;
}
