// Readers of the saved routines file: each takes an unknown value off disk and
// returns the clean field, or nothing when it is unreadable.
import { parseMailAlias } from "../../shared/routine-mail-alias.ts";
import { cleanRoutineAutoPauseAfter, type RoutineAutoPause } from "../../shared/routine-auto-pause.ts";
import { cleanRoutineFolder, orderedRoutineFolders, ROUTINE_FOLDERS_PER_BOT } from "../../shared/routine-folders.ts";

export const MAX_DATE_MS = 8_640_000_000_000_000;

export function loadMailAlias(value: unknown): string | undefined {
  const parsed = parseMailAlias(value);
  return parsed.ok ? parsed.alias : undefined;
}

export function loadAutoPauseAfter(value: unknown): number | undefined {
  try {
    return cleanRoutineAutoPauseAfter(value);
  } catch {
    return undefined;
  }
}

/** Each bot's saved folder order; anything unreadable is dropped (folders
 * then come back from the routines that name them). */
export function loadFolderOrder(value: unknown): Map<string, string[]> {
  const order = new Map<string, string[]>();
  if (!value || typeof value !== "object" || Array.isArray(value)) return order;
  for (const [botId, names] of Object.entries(value as Record<string, unknown>)) {
    if (!botId || !Array.isArray(names)) continue;
    const clean = orderedRoutineFolders(names.flatMap((name) => {
      const folder = cleanRoutineFolder(name);
      return folder ? [folder] : [];
    }), []).slice(0, ROUTINE_FOLDERS_PER_BOT);
    if (clean.length) order.set(botId, clean);
  }
  return order;
}


export function loadAutoPaused(value: unknown): RoutineAutoPause | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { at, failures, runId } = value as Partial<RoutineAutoPause>;
  if (typeof at !== "number" || !Number.isFinite(at) || at < 0 || at > MAX_DATE_MS) return undefined;
  if (typeof failures !== "number" || !Number.isSafeInteger(failures) || failures < 1) return undefined;
  if (typeof runId !== "string" || !runId || runId.length > 100) return undefined;
  return { at, failures, runId };
}
