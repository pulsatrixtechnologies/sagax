// A person's own Settings > Experimental choices and browser profiles on an
// organization server (#1098, 2026-10-27, shared/person-settings.ts). One
// file per person, `principals/<id>/person-settings.json` (mode 0600), read
// and written only for that person (server/routes/person-settings.ts). A
// solo server has one person, who edits the installation itself: no file.
//
// - features: the person's own value of a personal Experimental switch;
//   absent follows the installation's.
// - browserProfiles: the person's own signed-in browser sessions for their
//   own bots. Each one's storage is that person's alone
//   (personalProfilePartition): another person's bot never names it.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  isPersonalBrowserProfileId,
  isPersonalFeature,
  MAX_PERSONAL_BROWSER_PROFILES,
  PERSONAL_BROWSER_PROFILE_PREFIX,
  type PersonalFeature,
} from "../../shared/person-settings.ts";
import { cleanDisabledModels } from "../../shared/offered-models.ts";
import { writeFileAtomic } from "../atomic.ts";

export const PERSON_SETTINGS_FILE = "person-settings.json";
const PRINCIPAL = /^[a-z0-9][a-z0-9_-]{0,80}$/;

export interface PersonalBrowserProfile { id: string; name: string }

export interface PersonSettings {
  features: Partial<Record<PersonalFeature, boolean>>;
  browserProfiles: PersonalBrowserProfile[];
  /** 2026-10-30 (lot 2): the models this person turned off for their own
   * bots, Auto and voice, as `<engine>/<model>` (shared/offered-models.ts).
   * Absent when none. */
  disabledModels?: string[];
}

export class PersonSettingsError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** The person's id as a file name, or null. */
export function personSettingsPrincipal(principalId: string | null | undefined): string | null {
  const id = principalId?.trim().toLowerCase() ?? "";
  return PRINCIPAL.test(id) ? id : null;
}

/** The storage a person's profile runs on: theirs alone, never an
 * installation profile's (those have no `p-` prefix and no hash). */
export function personalProfilePartition(principalId: string, profileId: string): string {
  const owner = createHash("sha256").update(principalId).digest("hex").slice(0, 12);
  return `p-${owner}-${profileId}`;
}

export function newPersonalProfileId(): string {
  return `${PERSONAL_BROWSER_PROFILE_PREFIX}${randomBytes(16).toString("hex")}`;
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return name && name.length <= 40 ? name : null;
}

function parse(value: unknown): PersonSettings {
  const raw = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const features: PersonSettings["features"] = {};
  const rawFeatures = raw.features && typeof raw.features === "object" && !Array.isArray(raw.features) ? raw.features as Record<string, unknown> : {};
  for (const [key, on] of Object.entries(rawFeatures)) if (isPersonalFeature(key) && typeof on === "boolean") features[key] = on;
  const browserProfiles: PersonalBrowserProfile[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(raw.browserProfiles) ? raw.browserProfiles : []) {
    const id = (entry as { id?: unknown } | null)?.id;
    const name = cleanName((entry as { name?: unknown } | null)?.name);
    if (!isPersonalBrowserProfileId(id) || !name || seen.has(id) || browserProfiles.length >= MAX_PERSONAL_BROWSER_PROFILES) continue;
    seen.add(id);
    browserProfiles.push({ id, name });
  }
  const disabledModels = cleanDisabledModels(raw.disabledModels);
  return { features, browserProfiles, ...(disabledModels.length ? { disabledModels } : {}) };
}

export class PersonSettingsStore {
  private readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private path(principalId: string): string {
    return join(this.dataDir, "principals", principalId, PERSON_SETTINGS_FILE);
  }

  get(principalId: string): PersonSettings {
    const path = this.path(principalId);
    try {
      if (!existsSync(path) || lstatSync(path).isSymbolicLink()) return { features: {}, browserProfiles: [] };
      return parse(JSON.parse(readFileSync(path, "utf8")));
    } catch {
      return { features: {}, browserProfiles: [] };
    }
  }

  private save(principalId: string, next: PersonSettings): PersonSettings {
    const path = this.path(principalId);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new PersonSettingsError("Your settings could not be saved. Try again.", 503);
    const clean = parse(next);
    writeFileAtomic(path, `${JSON.stringify(clean, null, 2)}\n`, { mode: 0o600 });
    return clean;
  }

  /** `true`/`false` sets the person's own value; `null` follows the installation again. */
  setFeatures(principalId: string, changes: Record<string, unknown>): PersonSettings {
    const current = this.get(principalId);
    const features = { ...current.features };
    for (const [key, value] of Object.entries(changes)) {
      if (!isPersonalFeature(key)) throw new PersonSettingsError(`${key} is not one of your own settings.`);
      if (value === null) delete features[key];
      else if (typeof value === "boolean") features[key] = value;
      else throw new PersonSettingsError(`${key} must be true, false or null.`);
    }
    return this.save(principalId, { ...current, features });
  }

  /** 2026-10-30: the person's own model switches, the whole list. */
  setDisabledModels(principalId: string, list: unknown): PersonSettings {
    if (!Array.isArray(list)) throw new PersonSettingsError("disabledModels must be a list.");
    const current = this.get(principalId);
    const { disabledModels: _, ...rest } = current;
    const next = cleanDisabledModels(list);
    return this.save(principalId, { ...rest, ...(next.length ? { disabledModels: next } : {}) });
  }

  /** The whole list: an entry with no id is a new profile; an id must be one
   * of the person's own already (never chosen by the caller). */
  setBrowserProfiles(principalId: string, list: unknown): PersonSettings {
    if (!Array.isArray(list)) throw new PersonSettingsError("browserProfiles must be a list.");
    if (list.length > MAX_PERSONAL_BROWSER_PROFILES) throw new PersonSettingsError(`At most ${MAX_PERSONAL_BROWSER_PROFILES} browser profiles.`);
    const current = this.get(principalId);
    const known = new Set(current.browserProfiles.map((profile) => profile.id));
    const next: PersonalBrowserProfile[] = [];
    for (const entry of list) {
      const name = cleanName((entry as { name?: unknown } | null)?.name);
      if (!name) throw new PersonSettingsError("A browser profile needs a name of 1 to 40 characters.");
      const id = (entry as { id?: unknown } | null)?.id;
      if (id === undefined || id === null || id === "") next.push({ id: newPersonalProfileId(), name });
      else if (typeof id === "string" && known.has(id) && !next.some((profile) => profile.id === id)) next.push({ id, name });
      else throw new PersonSettingsError("That browser profile is not one of yours.", 409);
    }
    return this.save(principalId, { ...current, browserProfiles: next });
  }
}
