// The phones of each person that asked for pushes: one small JSON file per
// principal in `<data>/push-devices/` (mode 0600). A device token is not a
// secret in Apple's sense but it addresses one phone, so it never reaches a
// log line (maskSecret) or another person's answer. A token belongs to one
// person at a time: a phone that signs in as someone else moves.
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import type { ApnsEnvironment } from "./config.ts";
import { DEFAULT_DEVICE_SETTINGS, type DevicePushSettings } from "./payload.ts";

/** A person's phones and tablets; the oldest registration goes first. */
export const MAX_DEVICES_PER_PERSON = 10;

/** APNs device tokens are 32 bytes today (64 hex); Apple says they may grow. */
export const DEVICE_TOKEN = /^[0-9a-f]{64,200}$/;

/** On `GET /api/events`: this phone's APNs token. The hub skips a push to
 * a device that is already reading the live stream. */
export const PUSH_TOKEN_HEADER = "x-sagax-push-token";

export function pushTokenFromHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return undefined;
  const token = raw.trim().toLowerCase();
  return DEVICE_TOKEN.test(token) ? token : undefined;
}

/** APNs tokens of this person's devices that currently have a live stream. */
export function tokensOfConnectedDevices(
  streams: Iterable<{ viewerId?: string; pushToken?: string }>,
  person: string,
  localPerson?: string,
): string[] {
  const who = person.trim().toLowerCase();
  if (!who) return [];
  const fallback = localPerson?.trim().toLowerCase() ?? "";
  const tokens: string[] = [];
  for (const stream of streams) {
    const owner = (stream.viewerId ?? fallback).trim().toLowerCase();
    if (owner !== who || !stream.pushToken) continue;
    tokens.push(stream.pushToken);
  }
  return tokens;
}

const PERSON = /^[\w:.@-]{1,128}$/;

export interface PushDevice {
  token: string;
  platform: "ios";
  environment: ApnsEnvironment;
  appVersion: string;
  deviceName: string;
  settings: DevicePushSettings;
  registeredAt: number;
  updatedAt: number;
}

export const registrationSchema = z.object({
  token: z.string().trim().toLowerCase().regex(DEVICE_TOKEN),
  platform: z.literal("ios"),
  /** The build's own environment (a TestFlight or App Store build is
   * production); absent: the server's SAGAX_APNS_ENVIRONMENT. */
  environment: z.enum(["sandbox", "production"]).optional(),
  appVersion: z.string().trim().max(40).default(""),
  deviceName: z.string().trim().max(80).default(""),
  settings: z.object({
    sound: z.boolean().optional(),
    badge: z.boolean().optional(),
    nudgeSound: z.boolean().optional(),
    approvalChime: z.boolean().optional(),
  }).strict().optional(),
}).strict();

export type PushRegistration = z.infer<typeof registrationSchema> & { environment: ApnsEnvironment };

const fileSchema = z.object({
  version: z.literal(1),
  devices: z.array(z.object({
    token: z.string().regex(DEVICE_TOKEN),
    platform: z.literal("ios"),
    environment: z.enum(["sandbox", "production"]),
    appVersion: z.string(),
    deviceName: z.string(),
    settings: z.object({
      sound: z.boolean(),
      badge: z.boolean(),
      nudgeSound: z.boolean(),
      approvalChime: z.boolean().optional(),
    }),
    registeredAt: z.number(),
    updatedAt: z.number(),
  })),
});

export interface PushDeviceStore {
  list(person: string): PushDevice[];
  register(person: string, input: PushRegistration): PushDevice;
  /** This person's device with that token; false when there was none. */
  remove(person: string, token: string): boolean;
  /** APNs said the token is dead (410 Unregistered, BadDeviceToken): gone for whoever had it. */
  prune(token: string): boolean;
  /** Forget a person's devices (account deletion). */
  removePerson(person: string): void;
}

const personKey = (person: string) => person.trim().toLowerCase();

export function createPushDeviceStore(dataDir: string, now: () => number = Date.now): PushDeviceStore {
  const dir = join(dataDir, "push-devices");
  let people: Map<string, PushDevice[]> | null = null;

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
        const devices = parsed.devices.map((device) => ({
          ...device,
          settings: { ...DEFAULT_DEVICE_SETTINGS, ...device.settings, approvalChime: device.settings.approvalChime !== false },
        }));
        if (devices.length) people.set(person, devices);
      } catch (error) {
        // a damaged file costs that person their pushes until the phone registers again
        console.warn(`push: ${name} in push-devices could not be read (${error instanceof Error ? error.message : String(error)}); ignored`);
      }
    }
    return people;
  };

  const save = (person: string, devices: PushDevice[]) => {
    const all = load();
    if (!devices.length) {
      all.delete(person);
      try { unlinkSync(fileOf(person)); } catch { /* already gone */ }
      return;
    }
    all.set(person, devices);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileAtomic(fileOf(person), `${JSON.stringify({ version: 1, devices }, null, 2)}\n`, { mode: 0o600 });
  };

  const requirePerson = (person: string) => {
    const key = personKey(person);
    if (!PERSON.test(key)) throw Object.assign(new Error("not a person"), { status: 403 });
    return key;
  };

  const removeToken = (token: string, except?: string): boolean => {
    let removed = false;
    for (const [person, devices] of load()) {
      if (person === except) continue;
      const kept = devices.filter((device) => device.token !== token);
      if (kept.length !== devices.length) {
        save(person, kept);
        removed = true;
      }
    }
    return removed;
  };

  return {
    list(person) {
      const key = personKey(person);
      return [...(load().get(key) ?? [])];
    },
    register(person, input) {
      const key = requirePerson(person);
      const at = now();
      // the phone signed in as this person now: nobody else gets its pushes
      removeToken(input.token, key);
      const devices = [...(load().get(key) ?? [])];
      const existing = devices.find((device) => device.token === input.token);
      const device: PushDevice = {
        token: input.token,
        platform: "ios",
        environment: input.environment,
        appVersion: input.appVersion,
        deviceName: input.deviceName,
        settings: { ...DEFAULT_DEVICE_SETTINGS, ...existing?.settings, ...input.settings },
        registeredAt: existing?.registeredAt ?? at,
        updatedAt: at,
      };
      const next = devices.filter((entry) => entry.token !== input.token);
      next.push(device);
      next.sort((a, b) => a.updatedAt - b.updatedAt);
      while (next.length > MAX_DEVICES_PER_PERSON) next.shift();
      save(key, next);
      return { ...device };
    },
    remove(person, token) {
      const key = personKey(person);
      const clean = token.trim().toLowerCase();
      const devices = load().get(key) ?? [];
      const kept = devices.filter((device) => device.token !== clean);
      if (kept.length === devices.length) return false;
      save(key, kept);
      return true;
    },
    prune(token) {
      return removeToken(token.trim().toLowerCase());
    },
    removePerson(person) {
      const key = personKey(person);
      if (load().has(key)) save(key, []);
    },
  };
}
