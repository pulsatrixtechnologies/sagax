// The "Bot" section of the phone's Settings sheet (iOS parity, screen 12):
// the auto-review default for new conversations, and the time zone routines
// run in. Kept for the whole server on a personal (solo) server, and per
// person (principal id) on an organization server, in one small JSON file of
// the data directory, written atomically (0600).
//
// - autoReviewDefault: when on, a conversation opened afterwards starts in a
//   level where risky shell, MCP and computer actions are reviewed before
//   they run (autoReviewThreadMode below): the engine's own reviewer
//   ("auto": Codex, Claude, Cursor, Grok, Qwen) where it has one, otherwise
//   Ask (the person approves each risky action; Full and Auto are tightened
//   to Ask, Ask and Edits stay).
//   Off changes nothing: a new conversation takes its bot's level, as before.
//   It never touches a conversation that exists, never leaves Custom (the
//   desktop's own confirmation), and never turns on Auto for a bot that
//   works on this computer (that needs its own warning).
// - timeZone: an IANA zone, or null for the host's. Daily schedules, interval
//   windows and weekdays of routines are read in it (server/routines.ts);
//   cron routines keep the zone saved with them.
// - timeZoneAuto: the phone's "Set Time Zone Automatically": when on, the
//   phone sends its own zone. The server only keeps the choice.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import type { ApprovalMode } from "../shared/approval-mode.ts";
import { writeFileAtomic } from "./atomic.ts";

export interface BotSettings {
  autoReviewDefault: boolean;
  timeZone: string | null;
  timeZoneAuto: boolean;
}

export const DEFAULT_BOT_SETTINGS: Readonly<BotSettings> = Object.freeze({ autoReviewDefault: false, timeZone: null, timeZoneAuto: true });

/** A zone this runtime knows, by its IANA name. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** The zone organization routines read their wall clocks in when neither the
 * person nor the server chose one. A server host usually runs in UTC, which
 * made "every day at 12:00" fire at 08:00 for people in Eastern time: use
 * SAGAX_DEFAULT_TIME_ZONE, else America/Toronto when the host is UTC. */
export const ORG_DEFAULT_TIME_ZONE = "America/Toronto";
export function defaultOrgTimeZone(host: string, env: string | undefined): string | null {
  if (env && isTimeZone(env)) return env;
  return ["UTC", "Etc/UTC", "GMT", "Etc/GMT"].includes(host) ? ORG_DEFAULT_TIME_ZONE : null;
}
export const hostTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export const botSettingsPatchSchema = z.object({
  autoReviewDefault: z.boolean({ error: "autoReviewDefault must be true or false" }).optional(),
  timeZone: z.union([z.string().refine(isTimeZone, { error: "timeZone must be an IANA time zone such as America/Toronto" }), z.null()]).optional(),
  timeZoneAuto: z.boolean({ error: "timeZoneAuto must be true or false" }).optional(),
}).strict();
export type BotSettingsPatch = z.infer<typeof botSettingsPatchSchema>;

const storedSchema = z.object({
  autoReviewDefault: z.boolean().optional(),
  timeZone: z.string().nullable().optional(),
  timeZoneAuto: z.boolean().optional(),
});
const fileSchema = z.object({
  version: z.literal(1),
  server: storedSchema.optional(),
  people: z.record(z.string(), storedSchema).optional(),
});

const PRINCIPAL_ID = /^pr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const MAX_PEOPLE = 10_000;

function complete(stored: z.infer<typeof storedSchema> | undefined): BotSettings {
  return {
    autoReviewDefault: stored?.autoReviewDefault ?? DEFAULT_BOT_SETTINGS.autoReviewDefault,
    timeZone: isTimeZone(stored?.timeZone) ? stored!.timeZone! : null,
    timeZoneAuto: stored?.timeZoneAuto ?? DEFAULT_BOT_SETTINGS.timeZoneAuto,
  };
}

export interface BotSettingsStore {
  /** The server's own (a personal server, or no person known). */
  server(): BotSettings;
  /** A person's on an organization server; defaults until they save. */
  person(principalId: string): BotSettings;
  saveServer(patch: BotSettingsPatch): BotSettings;
  savePerson(principalId: string, patch: BotSettingsPatch): BotSettings;
  /** Forget a person (account deletion). */
  forgetPerson(principalId: string): void;
}

export function createBotSettingsStore(dataDir: string): BotSettingsStore {
  const file = join(dataDir, "bot-settings.json");
  let state: { server?: BotSettings; people: Record<string, BotSettings> } | null = null;

  const load = () => {
    if (state) return state;
    state = { people: {} };
    if (!existsSync(file)) return state;
    try {
      const parsed = fileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
      if (parsed.server) state.server = complete(parsed.server);
      for (const [id, entry] of Object.entries(parsed.people ?? {})) if (PRINCIPAL_ID.test(id)) state.people[id] = complete(entry);
    } catch (error) {
      console.warn(`bot settings: ${file} could not be read (${error instanceof Error ? error.message : String(error)}); using defaults`);
    }
    return state;
  };
  const persist = () => {
    const current = load();
    writeFileAtomic(file, `${JSON.stringify({ version: 1, ...(current.server ? { server: current.server } : {}), people: current.people }, null, 2)}\n`, { mode: 0o600 });
  };
  const requirePerson = (principalId: string) => {
    if (!PRINCIPAL_ID.test(principalId)) throw Object.assign(new Error("not a person"), { status: 403 });
  };
  const merge = (current: BotSettings, patch: BotSettingsPatch): BotSettings => ({
    autoReviewDefault: patch.autoReviewDefault ?? current.autoReviewDefault,
    timeZone: patch.timeZone === undefined ? current.timeZone : patch.timeZone,
    timeZoneAuto: patch.timeZoneAuto ?? current.timeZoneAuto,
  });

  return {
    server: () => ({ ...(load().server ?? DEFAULT_BOT_SETTINGS) }),
    person(principalId) {
      requirePerson(principalId);
      return { ...(load().people[principalId] ?? DEFAULT_BOT_SETTINGS) };
    },
    saveServer(patch) {
      const current = load();
      current.server = merge(current.server ?? { ...DEFAULT_BOT_SETTINGS }, patch);
      persist();
      return { ...current.server };
    },
    savePerson(principalId, patch) {
      requirePerson(principalId);
      const current = load();
      if (!current.people[principalId] && Object.keys(current.people).length >= MAX_PEOPLE) throw Object.assign(new Error("too many people"), { status: 507 });
      current.people[principalId] = merge(current.people[principalId] ?? { ...DEFAULT_BOT_SETTINGS }, patch);
      persist();
      return { ...current.people[principalId]! };
    },
    forgetPerson(principalId) {
      const current = load();
      if (!current.people[principalId]) return;
      delete current.people[principalId];
      persist();
    },
  };
}

/** The level a new conversation starts in when auto-review is on, or null to
 * keep the one it inherited (see the header). */
export function autoReviewThreadMode(input: {
  current: ApprovalMode;
  /** The engine reviews risky actions itself in "auto" (hasNativeAutoReview). */
  nativeReviewer: boolean;
  /** The engine supports "auto" here (supportsApprovalMode). */
  supportsAuto: boolean;
  /** The bot works on this computer, where Auto needs its own warning. */
  thisComputer: boolean;
}): ApprovalMode | null {
  if (input.current === "custom") return null;
  if (input.nativeReviewer && input.supportsAuto && !input.thisComputer) return input.current === "auto" ? null : "auto";
  // No reviewer here: whatever would run risky actions unasked asks instead.
  return input.current === "full" || input.current === "auto" ? "ask" : null;
}
