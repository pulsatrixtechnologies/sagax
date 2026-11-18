// The attested keys of each person's phones: one small JSON file per
// principal in `<data>/app-attest/` (mode 0600), one entry per device key.
// A key id is a hash of a public key, not a secret; it still never reaches a
// log line whole (maskSecret).
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";

export const MAX_ATTESTED_KEYS_PER_PERSON = 20;
const PERSON = /^[\w:.@-]{1,128}$/;

export interface AttestedDevice {
  keyId: string;
  publicKeyPem: string;
  environment: "production" | "development";
  counter: number;
  appVersion: string;
  deviceName: string;
  registeredAt: number;
  lastAssertedAt: number | null;
}

const deviceSchema = z.object({
  keyId: z.string(),
  publicKeyPem: z.string(),
  environment: z.enum(["production", "development"]),
  counter: z.number().int().min(0),
  appVersion: z.string(),
  deviceName: z.string(),
  registeredAt: z.number(),
  lastAssertedAt: z.number().nullable(),
});
const fileSchema = z.object({ version: z.literal(1), devices: z.array(deviceSchema) });

export interface AppAttestStore {
  list(person: string): AttestedDevice[];
  find(person: string, keyId: string): AttestedDevice | undefined;
  add(person: string, device: Omit<AttestedDevice, "counter" | "registeredAt" | "lastAssertedAt">): AttestedDevice;
  /** Moves the counter forward after an accepted assertion. */
  accept(person: string, keyId: string, counter: number): void;
  removePerson(person: string): void;
}

const key = (person: string) => person.trim().toLowerCase();

export function createAppAttestStore(dataDir: string, now: () => number = Date.now): AppAttestStore {
  const dir = join(dataDir, "app-attest");
  let people: Map<string, AttestedDevice[]> | null = null;
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
        if (parsed.devices.length) people.set(person, parsed.devices);
      } catch (error) {
        console.warn(`app-attest: ${name} could not be read (${error instanceof Error ? error.message : String(error)}); ignored`);
      }
    }
    return people;
  };

  const save = (person: string, devices: AttestedDevice[]) => {
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

  const needPerson = (person: string) => {
    const who = key(person);
    if (!PERSON.test(who)) throw Object.assign(new Error("not a person"), { status: 403 });
    return who;
  };

  return {
    list: (person) => [...(load().get(key(person)) ?? [])],
    find: (person, keyId) => load().get(key(person))?.find((device) => device.keyId === keyId),
    add(person, input) {
      const who = needPerson(person);
      const device: AttestedDevice = { ...input, counter: 0, registeredAt: now(), lastAssertedAt: null };
      const next = [...(load().get(who) ?? []).filter((entry) => entry.keyId !== input.keyId), device];
      while (next.length > MAX_ATTESTED_KEYS_PER_PERSON) next.shift();
      save(who, next);
      return { ...device };
    },
    accept(person, keyId, counter) {
      const who = needPerson(person);
      const devices = load().get(who) ?? [];
      save(who, devices.map((device) => (device.keyId === keyId ? { ...device, counter, lastAssertedAt: now() } : device)));
    },
    removePerson(person) {
      const who = key(person);
      if (load().has(who)) save(who, []);
    },
  };
}
