// The plugins and skills Perspicax installs by default for each person
// (owner, 2026-11-19, M-20261119-042; decisions D-20261119-072 to 074; Perspicax
// #2220). Perspicax keeps one list for the organization and, on each
// person's sheet, what is added or removed for that person; it sends each
// person's resulting list in the directory (`default_installs`). The list a
// new person gets is the organization's as it stood when they were created:
// a later change of that list never reaches anyone who already exists, and
// someone created before the list gets only what is added on their own sheet.
//
// This module poses each entry once for the person, in their own place (Me):
//   - a plugin of a marketplace this server is connected to, installed in
//     their Me plugins and switched off (D-20261119-070: nothing turns on by
//     itself, a plugin's init runs when the person turns it on);
//   - a skill of the organization's library, copied into their Me library,
//     switched off (not referenced).
// The person is free to remove it: an entry is never posed twice, so a
// removal stays removed (D-20261119-073); a record that cannot be read poses
// nothing rather than pose again. One the person already has is left as
// they set it. An entry that cannot be posed yet (its marketplace not
// connected, the library off, a pull that failed) is kept and tried again
// at the next directory, sign-in or check, never more than every ten minutes.
//
// Triggers: the directory (a list changed, a person arrived), a person's
// sign-in (their first connection makes their principal), the start of the
// server and the 30-minute check. Only people this server knows (a
// principal) and active in the directory are posed for.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const defaultInstallEntrySchema = z.object({
  kind: z.enum(["plugin", "skill"]),
  source: z.string().regex(NAME),
  name: z.string().regex(NAME),
}).strip();

export type DefaultInstallEntry = z.infer<typeof defaultInstallEntrySchema>;

/** An entry's identity: kind, source and name. */
export function defaultInstallKey(entry: DefaultInstallEntry): string {
  return `${entry.kind}:${entry.source}:${entry.name}`;
}

/** The time a failed entry waits before it is tried again. */
export const RETRY_MS = 10 * 60_000;

export interface DefaultInstallPerson {
  principalId: string;
  entries: readonly DefaultInstallEntry[];
}

export interface DefaultInstallsOptions {
  dataDir: string;
  /** The people of the last directory this server knows (a principal), active
   * there, with their list (empty or absent: nothing to pose). */
  people: () => DefaultInstallPerson[];
  /** Whether the person already has it in their own place (left as is). */
  has: (principalId: string, entry: DefaultInstallEntry) => boolean;
  /** Installs a marketplace plugin in the person's Me plugins, switched off. */
  installPlugin: (principalId: string, marketplace: string, plugin: string) => Promise<void>;
  /** Copies a library skill into the person's Me library, switched off. */
  installSkill: (principalId: string, name: string) => Promise<void>;
  log?: (line: string) => void;
  now?: () => number;
}

const stateSchema = z.object({
  version: z.literal(1),
  people: z.record(z.string(), z.object({
    /** each entry posed, by key, with when */
    posed: z.record(z.string(), z.number()).default({}),
    /** each entry not posed yet, with why and when it was last tried */
    failed: z.record(z.string(), z.object({ at: z.number(), reason: z.string().max(200) })).default({}),
  })).default({}),
});
type State = z.infer<typeof stateSchema>;

/** What GET people/{principal} says of a person's default installs. */
export interface DefaultInstallsStatus {
  posed: Array<DefaultInstallEntry & { at: number }>;
  failed: Array<DefaultInstallEntry & { at: number; reason: string }>;
}

function entryOfKey(key: string): DefaultInstallEntry | null {
  const [kind, source, name] = key.split(":");
  const parsed = defaultInstallEntrySchema.safeParse({ kind, source, name });
  return parsed.success ? parsed.data : null;
}

/** A short reason, never a token or a path. */
function reasonOf(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error && typeof (error as { code: unknown }).code === "string" ? (error as { code: string }).code : "";
  const message = error instanceof Error ? error.message : String(error);
  return (code || message || "failed").replace(/\s+/g, " ").slice(0, 200);
}

export class DefaultInstalls {
  private readonly options: DefaultInstallsOptions;
  private readonly file: string;
  private running: Promise<{ posed: number; failed: number }> | null = null;
  private again = false;

  constructor(options: DefaultInstallsOptions) {
    this.options = options;
    this.file = join(options.dataDir, "default-installs.json");
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** The record; null when the file is there and cannot be read, so nothing
   * is posed again over what a person may have removed. */
  private read(): State | null {
    try {
      if (!existsSync(this.file)) return { version: 1, people: {} };
      return stateSchema.parse(JSON.parse(readFileSync(this.file, "utf8")));
    } catch {
      return null;
    }
  }

  private write(state: State): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  }

  /** One person's posed and pending entries. */
  status(principalId: string): DefaultInstallsStatus {
    const person = this.read()?.people[principalId];
    if (!person) return { posed: [], failed: [] };
    return {
      posed: Object.entries(person.posed).flatMap(([key, at]) => {
        const entry = entryOfKey(key);
        return entry ? [{ ...entry, at }] : [];
      }),
      failed: Object.entries(person.failed).flatMap(([key, value]) => {
        const entry = entryOfKey(key);
        return entry ? [{ ...entry, at: value.at, reason: value.reason }] : [];
      }),
    };
  }

  /** The person was erased: their record goes. */
  forget(principalId: string): void {
    const state = this.read();
    if (!state?.people[principalId]) return;
    delete state.people[principalId];
    this.write(state);
  }

  /** Poses what is due, one run at a time; a call during a run runs once more
   * after it. */
  sync(reason = "manual"): Promise<{ posed: number; failed: number }> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      let total = { posed: 0, failed: 0 };
      do {
        this.again = false;
        const one = await this.run(reason);
        total = { posed: total.posed + one.posed, failed: total.failed + one.failed };
      } while (this.again);
      return total;
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(reason: string): Promise<{ posed: number; failed: number }> {
    let posed = 0;
    let failed = 0;
    if (!this.read()) {
      this.options.log?.(`default installs (${reason}): ${this.file} cannot be read; nothing posed until it is fixed or removed`);
      return { posed, failed };
    }
    for (const person of this.options.people()) {
      if (!person.entries.length) continue;
      const state = this.read();
      if (!state) break;
      const record = state.people[person.principalId] ?? { posed: {}, failed: {} };
      let changed = false;
      for (const entry of person.entries) {
        const key = defaultInstallKey(entry);
        if (record.posed[key] !== undefined) continue;
        const last = record.failed[key];
        if (last && this.now() - last.at < RETRY_MS) continue;
        try {
          if (!this.options.has(person.principalId, entry)) {
            if (entry.kind === "plugin") await this.options.installPlugin(person.principalId, entry.source, entry.name);
            else await this.options.installSkill(person.principalId, entry.name);
            posed += 1;
          }
          record.posed[key] = this.now();
          delete record.failed[key];
        } catch (error) {
          record.failed[key] = { at: this.now(), reason: reasonOf(error) };
          failed += 1;
          this.options.log?.(`default installs (${reason}): ${entry.kind} ${entry.name} for ${person.principalId} not posed: ${record.failed[key]!.reason}`);
        }
        changed = true;
      }
      if (changed) {
        // read again: another writer (forget) may have run during the installs
        const latest = this.read() ?? state;
        latest.people[person.principalId] = record;
        this.write(latest);
      }
    }
    if (posed) this.options.log?.(`default installs (${reason}): ${posed} posed, switched off`);
    return { posed, failed };
  }
}
