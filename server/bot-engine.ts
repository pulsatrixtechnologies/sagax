/** Shown instead of a raw `provider instance "" is unavailable` when a bot
 * has no engine and the person has none to give it (2026-10-19). */
export const NO_ENGINE_MESSAGE = "Ce bot n'a pas de moteur : choisis-en un dans Modifier le bot > Modèle";

/** A selection that names an engine instance. An empty or blank id is the
 * "born without an engine" state: create_bot, an import, or a bot put on Auto
 * before any engine was ready. */
export function namesEngine(selection: { instanceId?: unknown } | undefined | null): boolean {
  return typeof selection?.instanceId === "string" && selection.instanceId.trim().length > 0;
}

/** Why a teammate cannot take work now because of its engine, or undefined
 * when its engine is usable. `known` says whether the engine instance exists
 * and is enabled on this server. */
export function engineProblem(
  selection: { instanceId?: unknown } | undefined | null,
  known: (instanceId: string) => boolean,
): string | undefined {
  if (!namesEngine(selection)) return NO_ENGINE_MESSAGE;
  return known((selection!.instanceId as string).trim()) ? undefined : "Le moteur de ce bot n'est plus disponible : choisis-en un autre dans Modifier le bot > Modèle";
}
