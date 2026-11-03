// One person's model, effort and notification choices for bots they do not
// own (shared/viewer-bot-overrides.ts). The bot record is never written.
// One JSON file in the data directory, mode 0o600, same shape as
// user-preferences.json: people keyed by principal id.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { EFFORT_LEVELS, isEffortLevel } from "../../shared/wire.ts";
import type { ViewerBotOverride, ViewerBotOverridePatch } from "../../shared/viewer-bot-overrides.ts";
import { isViewerModelPin } from "../../shared/viewer-bot-overrides.ts";
import { writeFileAtomic } from "../atomic.ts";

const PRINCIPAL_ID = /^pr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BOT_ID = /^[\w-]+$/;
export const MAX_OVERRIDE_PEOPLE = 10_000;
export const MAX_OVERRIDES_PER_PERSON = 2_000;

const fileSchema = z.object({
  version: z.literal(1),
  people: z.record(z.string(), z.object({
    bots: z.record(z.string(), z.object({
      model: z.object({ instanceId: z.string(), model: z.string() }).optional(),
      effort: z.union([z.enum(EFFORT_LEVELS), z.null()]).optional(),
      variant: z.union([z.string(), z.null()]).optional(),
      notifications: z.boolean().optional(),
      updatedAt: z.number(),
    })),
    updatedAt: z.number(),
  })),
});

type People = Record<string, { bots: Record<string, ViewerBotOverride>; updatedAt: number }>;

export interface ViewerBotOverrideStore {
  getAll(principalId: string): Record<string, ViewerBotOverride>;
  getOne(principalId: string, botId: string): ViewerBotOverride | undefined;
  /** Merge `patch` into this person's choice for `botId`. A null field clears it. */
  put(principalId: string, botId: string, patch: ViewerBotOverridePatch): ViewerBotOverride | null;
  remove(principalId: string): void;
}

export function createViewerBotOverrideStore(dataDir: string, now: () => number = Date.now): ViewerBotOverrideStore {
  const file = join(dataDir, "viewer-bot-overrides.json");
  let people: People | null = null;

  const load = (): People => {
    if (people) return people;
    people = {};
    if (!existsSync(file)) return people;
    try {
      const parsed = fileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
      for (const [id, entry] of Object.entries(parsed.people)) {
        if (!PRINCIPAL_ID.test(id)) continue;
        const bots: Record<string, ViewerBotOverride> = {};
        for (const [botId, row] of Object.entries(entry.bots)) {
          if (!BOT_ID.test(botId)) continue;
          const kept: ViewerBotOverride = { updatedAt: row.updatedAt };
          if (row.model && isViewerModelPin(row.model)) kept.model = { instanceId: row.model.instanceId, model: row.model.model };
          if (row.effort === null || isEffortLevel(row.effort)) kept.effort = row.effort;
          if (row.variant === null || (typeof row.variant === "string" && row.variant.trim() && row.variant.length <= 200)) kept.variant = row.variant ?? null;
          if (typeof row.notifications === "boolean") kept.notifications = row.notifications;
          if (kept.model || kept.effort !== undefined || kept.variant !== undefined || kept.notifications !== undefined) bots[botId] = kept;
        }
        people[id] = { bots, updatedAt: entry.updatedAt };
      }
    } catch (error) {
      console.warn(`viewer bot overrides: ${file} could not be read (${error instanceof Error ? error.message : String(error)}); starting empty`);
    }
    return people;
  };

  const requirePerson = (principalId: string) => {
    if (!PRINCIPAL_ID.test(principalId)) throw Object.assign(new Error("not a person"), { status: 403 });
  };

  const save = (all: People) => {
    writeFileAtomic(file, `${JSON.stringify({ version: 1, people: all }, null, 2)}\n`, { mode: 0o600 });
  };

  const copy = (row: ViewerBotOverride): ViewerBotOverride => ({
    ...row,
    ...(row.model ? { model: { ...row.model } } : {}),
  });

  return {
    getAll(principalId) {
      requirePerson(principalId);
      const entry = load()[principalId];
      if (!entry) return {};
      const out: Record<string, ViewerBotOverride> = {};
      for (const [botId, row] of Object.entries(entry.bots)) out[botId] = copy(row);
      return out;
    },
    getOne(principalId, botId) {
      if (!PRINCIPAL_ID.test(principalId) || !BOT_ID.test(botId)) return undefined;
      const row = load()[principalId]?.bots[botId];
      return row ? copy(row) : undefined;
    },
    put(principalId, botId, patch) {
      requirePerson(principalId);
      if (!BOT_ID.test(botId)) throw Object.assign(new Error("not a bot"), { status: 400 });
      const all = load();
      const mine = all[principalId] ?? { bots: {}, updatedAt: now() };
      if (!all[principalId] && Object.keys(all).length >= MAX_OVERRIDE_PEOPLE) throw Object.assign(new Error("too many people"), { status: 507 });
      const current = mine.bots[botId] ?? { updatedAt: now() };
      const next: ViewerBotOverride = { ...current, updatedAt: now() };
      if ("model" in patch) {
        if (patch.model === null) delete next.model;
        else if (patch.model) next.model = { instanceId: patch.model.instanceId, model: patch.model.model.trim() };
      }
      if ("effort" in patch) next.effort = patch.effort ?? null;
      if ("variant" in patch) next.variant = patch.variant === null ? null : patch.variant?.trim() ?? null;
      if ("notifications" in patch && patch.notifications !== undefined) {
        if (patch.notifications === null) delete next.notifications;
        else next.notifications = patch.notifications;
      }
      const empty = !next.model && next.effort === undefined && next.variant === undefined && next.notifications === undefined;
      if (empty) delete mine.bots[botId];
      else {
        if (!mine.bots[botId] && Object.keys(mine.bots).length >= MAX_OVERRIDES_PER_PERSON) throw Object.assign(new Error("too many bots"), { status: 507 });
        mine.bots[botId] = next;
      }
      mine.updatedAt = now();
      if (Object.keys(mine.bots).length === 0) delete all[principalId];
      else all[principalId] = mine;
      save(all);
      return empty ? null : copy(next);
    },
    remove(principalId) {
      const all = load();
      if (!all[principalId]) return;
      delete all[principalId];
      save(all);
    },
  };
}
