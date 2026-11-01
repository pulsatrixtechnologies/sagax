// Live Activity push tokens: one per running ActivityKit activity on a
// person's phone, plus the optional push-to-start token (iOS 17.2+). Stored
// per person under `<data>/push-activities/` (mode 0600). A token addresses
// one activity on one device; it never reaches another person's list, a log
// line in full (maskSecret), or a public GET answer unmasked.
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import type { ApnsEnvironment } from "./config.ts";
import { DEVICE_TOKEN } from "./devices.ts";

/** ActivityKit push tokens are hex like device tokens; Apple may grow them. */
export const ACTIVITY_TOKEN = DEVICE_TOKEN;

export const MAX_ACTIVITY_TOKENS_PER_PERSON = 40;
export const MAX_PUSH_TO_START_PER_PERSON = 10;

const PERSON = /^[\w:.@-]{1,128}$/;
const BOT_ID = /^[\w.-]{1,128}$/;
const ACTIVITY_ID = /^[\w.-]{1,128}$/;

export type ActivityTokenKind = "update" | "start";

export interface LiveActivityToken {
  /** Hex ActivityKit push token (update) or push-to-start token. */
  token: string;
  kind: ActivityTokenKind;
  environment: ApnsEnvironment;
  /** Bot this activity shows; required for update tokens. */
  botId?: string;
  /** ActivityKit activity id on the phone (when known). */
  activityId?: string;
  /** The phone's alert APNs token, to group devices. */
  deviceToken?: string;
  /** Whether the person allowed frequent Live Activity pushes. */
  frequentUpdates?: boolean;
  appVersion: string;
  deviceName: string;
  registeredAt: number;
  updatedAt: number;
  /** Last content-state kind we pushed (skip no-ops). */
  lastKind?: string;
  /** When we last sent a push for this token (rate limit). */
  lastSentAt?: number;
}

export const activityRegistrationSchema = z.object({
  token: z.string().trim().toLowerCase().regex(ACTIVITY_TOKEN),
  kind: z.enum(["update", "start"]).default("update"),
  environment: z.enum(["sandbox", "production"]).optional(),
  botId: z.string().trim().regex(BOT_ID).optional(),
  activityId: z.string().trim().regex(ACTIVITY_ID).optional(),
  deviceToken: z.string().trim().toLowerCase().regex(DEVICE_TOKEN).optional(),
  frequentUpdates: z.boolean().optional(),
  appVersion: z.string().trim().max(40).default(""),
  deviceName: z.string().trim().max(80).default(""),
}).strict().superRefine((value, ctx) => {
  if (value.kind === "update" && !value.botId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "update tokens need botId", path: ["botId"] });
  }
});

export type ActivityRegistration = z.infer<typeof activityRegistrationSchema> & {
  environment: ApnsEnvironment;
};

const fileSchema = z.object({
  version: z.literal(1),
  tokens: z.array(z.object({
    token: z.string().regex(ACTIVITY_TOKEN),
    kind: z.enum(["update", "start"]),
    environment: z.enum(["sandbox", "production"]),
    botId: z.string().optional(),
    activityId: z.string().optional(),
    deviceToken: z.string().optional(),
    frequentUpdates: z.boolean().optional(),
    appVersion: z.string(),
    deviceName: z.string(),
    registeredAt: z.number(),
    updatedAt: z.number(),
    lastKind: z.string().optional(),
    lastSentAt: z.number().optional(),
  })),
});

export interface LiveActivityTokenStore {
  list(person: string): LiveActivityToken[];
  /** Update tokens for this person and bot (not push-to-start). */
  listForBot(person: string, botId: string): LiveActivityToken[];
  register(person: string, input: ActivityRegistration): LiveActivityToken;
  remove(person: string, token: string): boolean;
  /** Drop every update token for this person and bot (activity ended). */
  removeForBot(person: string, botId: string): number;
  /** APNs said the token is dead: gone for whoever had it. */
  prune(token: string): boolean;
  removePerson(person: string): void;
  /** Record that we sent for this token (lastKind + lastSentAt). */
  noteSent(person: string, token: string, kind: string, at: number): void;
}

const personKey = (person: string) => person.trim().toLowerCase();

export function createLiveActivityTokenStore(
  dataDir: string,
  now: () => number = Date.now,
): LiveActivityTokenStore {
  const dir = join(dataDir, "push-activities");
  let people: Map<string, LiveActivityToken[]> | null = null;

  const fileOf = (person: string) => join(dir, `${person}.json`);

  const load = () => {
    if (people) return people;
    people = new Map();
    if (!existsSync(dir)) return people;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const person = name.slice(0, -5);
      if (!PERSON.test(person)) continue;
      try {
        const parsed = fileSchema.parse(JSON.parse(readFileSync(join(dir, name), "utf8")));
        if (parsed.tokens.length) people.set(person, parsed.tokens.map((row) => ({ ...row })));
      } catch (error) {
        console.warn(`push-activity: ${name} could not be read (${error instanceof Error ? error.message : String(error)}); ignored`);
      }
    }
    return people;
  };

  const save = (person: string, tokens: LiveActivityToken[]) => {
    const all = load();
    if (!tokens.length) {
      all.delete(person);
      try { unlinkSync(fileOf(person)); } catch { /* already gone */ }
      return;
    }
    all.set(person, tokens);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileAtomic(fileOf(person), `${JSON.stringify({ version: 1, tokens }, null, 2)}\n`, { mode: 0o600 });
  };

  const requirePerson = (person: string) => {
    const key = personKey(person);
    if (!PERSON.test(key)) throw Object.assign(new Error("not a person"), { status: 403 });
    return key;
  };

  const removeToken = (token: string, except?: string): boolean => {
    let removed = false;
    for (const [person, tokens] of load()) {
      if (person === except) continue;
      const kept = tokens.filter((entry) => entry.token !== token);
      if (kept.length !== tokens.length) {
        save(person, kept);
        removed = true;
      }
    }
    return removed;
  };

  return {
    list(person) {
      return [...(load().get(personKey(person)) ?? [])];
    },
    listForBot(person, botId) {
      const bot = botId.trim();
      return (load().get(personKey(person)) ?? []).filter(
        (entry) => entry.kind === "update" && entry.botId === bot,
      );
    },
    register(person, input) {
      const key = requirePerson(person);
      const at = now();
      removeToken(input.token, key);
      const tokens = [...(load().get(key) ?? [])];
      const existing = tokens.find((entry) => entry.token === input.token);
      const entry: LiveActivityToken = {
        token: input.token,
        kind: input.kind,
        environment: input.environment,
        ...(input.botId ? { botId: input.botId } : {}),
        ...(input.activityId ? { activityId: input.activityId } : {}),
        ...(input.deviceToken ? { deviceToken: input.deviceToken } : existing?.deviceToken ? { deviceToken: existing.deviceToken } : {}),
        ...(input.frequentUpdates !== undefined ? { frequentUpdates: input.frequentUpdates } : existing?.frequentUpdates !== undefined ? { frequentUpdates: existing.frequentUpdates } : {}),
        appVersion: input.appVersion,
        deviceName: input.deviceName,
        registeredAt: existing?.registeredAt ?? at,
        updatedAt: at,
        ...(existing?.lastKind ? { lastKind: existing.lastKind } : {}),
        ...(existing?.lastSentAt !== undefined ? { lastSentAt: existing.lastSentAt } : {}),
      };
      const next = tokens.filter((row) => row.token !== input.token);
      next.push(entry);
      next.sort((a, b) => a.updatedAt - b.updatedAt);
      // Cap update and start tokens separately so one kind cannot starve the other.
      const starts = next.filter((row) => row.kind === "start");
      const updates = next.filter((row) => row.kind === "update");
      while (starts.length > MAX_PUSH_TO_START_PER_PERSON) starts.shift();
      while (updates.length > MAX_ACTIVITY_TOKENS_PER_PERSON) updates.shift();
      save(key, [...starts, ...updates].sort((a, b) => a.updatedAt - b.updatedAt));
      return { ...entry };
    },
    remove(person, token) {
      const key = personKey(person);
      const clean = token.trim().toLowerCase();
      const tokens = load().get(key) ?? [];
      const kept = tokens.filter((entry) => entry.token !== clean);
      if (kept.length === tokens.length) return false;
      save(key, kept);
      return true;
    },
    removeForBot(person, botId) {
      const key = personKey(person);
      const bot = botId.trim();
      const tokens = load().get(key) ?? [];
      const kept = tokens.filter((entry) => !(entry.kind === "update" && entry.botId === bot));
      const removed = tokens.length - kept.length;
      if (removed) save(key, kept);
      return removed;
    },
    prune(token) {
      return removeToken(token.trim().toLowerCase());
    },
    removePerson(person) {
      const key = personKey(person);
      if (load().has(key)) save(key, []);
    },
    noteSent(person, token, kind, at) {
      const key = personKey(person);
      const tokens = load().get(key) ?? [];
      const clean = token.trim().toLowerCase();
      let changed = false;
      const next = tokens.map((entry) => {
        if (entry.token !== clean) return entry;
        changed = true;
        return { ...entry, lastKind: kind, lastSentAt: at, updatedAt: entry.updatedAt };
      });
      if (changed) save(key, next);
    },
  };
}
