/**
 * #2067: the engine object GET bots (Perspicax console) returns for each bot.
 * `name` is the same human-readable label the desktop app shows for that
 * engine (instance displayName, else the driver's English/default metadata
 * name). Never a localized member-facing label such as
 * "Claude (clé de l'organisation)".
 */
export interface AdminBotEngine {
  instanceId: string;
  driverKind: string;
  installed: boolean;
  /** Human-readable engine name (English/default display name). */
  name: string;
}

/** Build the GET bots `engine` field. Prefer the instance displayName the
 * desktop already uses; fall back to the driver's English default name. */
export function adminBotEngine(input: {
  instanceId: string;
  driverKind: string;
  installed: boolean;
  displayName?: string | null;
  driverDisplayName?: string | null;
}): AdminBotEngine {
  const name = input.displayName?.trim()
    || input.driverDisplayName?.trim()
    || input.driverKind
    || input.instanceId;
  return {
    instanceId: input.instanceId,
    driverKind: input.driverKind,
    installed: input.installed,
    name,
  };
}
