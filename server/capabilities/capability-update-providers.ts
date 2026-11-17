// #4504: the three kinds of the update service (capability-updates.ts), each
// over the stores that already exist. server/index.ts passes the stores; the
// rules (what is a newer version, what the notes are, what the
// organization holds) live here so they are tested without a server.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { GitHubSkillOrigin } from "../../shared/skill-import.ts";
import {
  CHECK_INTERVAL_MS,
  compareVersions,
  latestFolderCommits,
  latestPackageVersion,
  pinnedPackage,
  shortNotes,
  skillFolderUpdate,
  updateKey,
  withPinnedVersion,
  type FolderCommit,
  type UpdateItem,
  type UpdatePerson,
  type UpdateProvider,
} from "./capability-updates.ts";

/** Where an installed item lives: the person's own place (me), one of
 * their bots, this installation (its managers), or the organization. */
type Place = { scope: "me" | "bot" | "installation" | "organization"; target: string; bot?: { id: string; name: string } };
type Organization = { organization?: "required" | "offered"; pinned?: string };

function base(kind: UpdateItem["kind"], place: Place, id: string, name: string, org: Organization): Omit<UpdateItem, "updateAvailable"> {
  return {
    key: updateKey(kind, place.scope, place.target, id),
    kind,
    name,
    scope: place.scope,
    ...(place.bot ? { bot: place.bot } : {}),
    ...(org.organization ? { organization: org.organization } : {}),
    ...(org.pinned ? { pinned: org.pinned } : {}),
    canUpdate: !org.organization,
  };
}

// ── plugins ───────────────────────────────────────────────────────────

export interface InstalledPluginRecord extends Place, Organization {
  /** plugin@marketplace (an organization declaration: its id) */
  id: string;
  name: string;
  installedVersion?: string;
  /** what the marketplace offers now */
  version?: string;
  /** the files the marketplace offers now (a digest), for an update of the
   * same version with other files */
  offeredRevision?: string;
  /** the existing marketplace rule (pluginUpdateAvailable) */
  updateAvailable: boolean;
  notes?: string;
}

export interface PluginProviderDeps {
  records(person: UpdatePerson): Promise<InstalledPluginRecord[]> | InstalledPluginRecord[];
  /** Pull the marketplaces with an installed plugin (the existing
   * background pull); true when one changed. */
  pull(): Promise<boolean | void>;
  /** Install again in place (the existing Update path). */
  install(person: UpdatePerson, record: InstalledPluginRecord): Promise<{ version?: string } | void>;
  checkEvery?: number;
}

export function pluginUpdateItem(record: InstalledPluginRecord): UpdateItem {
  const installed = record.installedVersion ?? record.version;
  const newVersion = record.version && record.version !== installed ? record.version : undefined;
  const available = record.updateAvailable ? newVersion ?? record.offeredRevision?.slice(0, 7) ?? record.version : undefined;
  const notes = record.updateAvailable ? shortNotes(record.notes) : undefined;
  return {
    ...base("plugin", record, record.id, record.name, record),
    ...(installed ? { installedVersion: installed } : {}),
    updateAvailable: record.updateAvailable && !record.organization,
    ...(available ? { availableVersion: available } : {}),
    ...(notes ? { updateNotes: notes } : {}),
  };
}

/** The fields a plugin listing adds (it already says version,
 * installedVersion when it differs, and updateAvailable). */
export function pluginListedFields(record: InstalledPluginRecord): Pick<ListedUpdateFields, "updateKey" | "availableVersion" | "updateNotes"> {
  const { updateKey: key, availableVersion, updateNotes } = listed(pluginUpdateItem(record));
  return { updateKey: key, ...(availableVersion ? { availableVersion } : {}), ...(updateNotes ? { updateNotes } : {}) };
}

export function pluginUpdateProvider(deps: PluginProviderDeps): UpdateProvider {
  const find = async (person: UpdatePerson, key: string) => (await deps.records(person)).find((record) => updateKey("plugin", record.scope, record.target, record.id) === key);
  return {
    kind: "plugin",
    ...(deps.checkEvery ? { checkEvery: deps.checkEvery } : {}),
    async items(person) {
      return (await deps.records(person)).map(pluginUpdateItem);
    },
    async check() {
      return (await deps.pull()) === true;
    },
    async update(person, item) {
      const record = await find(person, item.key);
      if (!record) throw new Error("This plugin is no longer installed.");
      const done = await deps.install(person, record);
      return done?.version ? { to: done.version } : {};
    },
  };
}

/** The notes of `version` in a plugin's CHANGELOG.md (its section, up to
 * the next heading of the same level), when the plugin ships one. */
export function changelogNotes(dir: string, version: string | undefined): string | undefined {
  if (!version) return undefined;
  for (const name of ["CHANGELOG.md", "changelog.md", "CHANGES.md"]) {
    const file = join(dir, name);
    if (!existsSync(file)) continue;
    let text: string;
    try { text = readFileSync(file, "utf8").slice(0, 256 * 1024); } catch { return undefined; }
    const lines = text.split("\n");
    const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const start = lines.findIndex((line) => /^#{1,4}\s/.test(line) && new RegExp(`(^|[^0-9.])v?${escaped}([^0-9.]|$)`).test(line));
    if (start < 0) return undefined;
    const level = /^#+/.exec(lines[start]!)![0].length;
    const end = lines.findIndex((line, index) => index > start && new RegExp(`^#{1,${level}}\\s`).test(line));
    return shortNotes(lines.slice(start + 1, end < 0 ? undefined : end).join("\n").replace(/^\s*[-*]\s+/gm, "- "));
  }
  return undefined;
}

// ── skills ────────────────────────────────────────────────────────────

export interface InstalledSkillRecord extends Place, Organization {
  name: string;
  /** Imported from GitHub: the folder and the commit it was read at. */
  github?: GitHubSkillOrigin;
  importedAt: string;
  /** whose GitHub access reads a private source (none: the installation's) */
  owner?: string;
}

export interface SkillProviderDeps {
  records(person: UpdatePerson): InstalledSkillRecord[];
  /** Every skill imported from GitHub on this server, for the check. */
  allRecords(): InstalledSkillRecord[];
  fetcherFor(owner: string | undefined): typeof fetch;
  /** Import the same folder again over the installed copy; throws, and the
   * installed copy stays, when it cannot. */
  reimport(person: UpdatePerson, record: InstalledSkillRecord): Promise<{ commit?: string } | void>;
  now?: () => number;
}

/** GitHub requests a check leaves unused in the hour, for the person's own
 * imports (60 an hour without a sign-in). */
export const GITHUB_RESERVE = 20;

export const originKey = (origin: GitHubSkillOrigin): string => `${origin.owner}/${origin.repo}@${origin.ref}:${origin.path}`.toLowerCase();
/** A source read with one person's access is known to that person only (a
 * private repository's commit subjects never reach another person). */
const readKey = (origin: GitHubSkillOrigin, owner: string | undefined): string => `${originKey(origin)}|${owner ?? ""}`;

/** The fields #4504 adds to an installed item of a list the page reads. */
export interface ListedUpdateFields {
  updateKey: string;
  updateAvailable?: true;
  installedVersion?: string;
  availableVersion?: string;
  updateNotes?: string;
  updateUnknown?: true;
}

function listed(item: UpdateItem): ListedUpdateFields {
  return {
    updateKey: item.key,
    ...(item.updateAvailable ? { updateAvailable: true as const } : {}),
    ...(item.installedVersion ? { installedVersion: item.installedVersion } : {}),
    ...(item.updateAvailable && item.availableVersion ? { availableVersion: item.availableVersion } : {}),
    ...(item.updateAvailable && item.updateNotes ? { updateNotes: item.updateNotes } : {}),
    ...(item.updateUnknown ? { updateUnknown: true as const } : {}),
  };
}

export function skillUpdateProvider(deps: SkillProviderDeps): UpdateProvider & { fields(record: InstalledSkillRecord): ListedUpdateFields } {
  const commits = new Map<string, FolderCommit[]>();
  const now = deps.now ?? Date.now;
  let blockedUntil = 0;
  const known = (record: InstalledSkillRecord) => record.github && !record.organization ? commits.get(readKey(record.github, record.owner)) : undefined;
  const item = (record: InstalledSkillRecord): UpdateItem => {
    const read = known(record);
    const update = read && record.github ? skillFolderUpdate({ commit: record.github.commit, importedAt: record.importedAt }, read) : null;
    return {
      ...base("skill", record, record.name, record.name, record),
      ...(record.github ? { installedVersion: record.github.commit.slice(0, 7) } : {}),
      ...(record.github && !record.organization && !read ? { updateUnknown: true as const } : {}),
      updateAvailable: Boolean(update),
      ...(update ? { availableVersion: update.available } : {}),
      ...(update?.notes ? { updateNotes: update.notes } : {}),
    };
  };
  return {
    kind: "skill",
    checkEvery: CHECK_INTERVAL_MS,
    fields: (record) => listed(item(record)),
    items(person) {
      return deps.records(person).map(item);
    },
    async check() {
      // GitHub refused for its rate limit: nothing until its reset
      if (now() < blockedUntil) return false;
      const seen = new Map<string, InstalledSkillRecord>();
      for (const record of deps.allRecords()) {
        if (!record.github || record.organization) continue;
        const key = readKey(record.github, record.owner);
        if (!seen.has(key)) seen.set(key, record);
      }
      let changed = false;
      for (const [key, record] of seen) {
        const answer = await latestFolderCommits(record.github!, deps.fetcherFor(record.owner), 8_000, now);
        // unreachable: what was known stays
        if (!answer) continue;
        if ("limitedUntil" in answer) {
          blockedUntil = answer.limitedUntil;
          break;
        }
        const before = commits.get(key)?.[0]?.sha;
        if (!commits.has(key) || before !== answer.commits[0]?.sha) changed = true;
        commits.set(key, answer.commits);
        // keep the rest of the hour for the person's own imports
        if (answer.remaining !== undefined && answer.remaining <= GITHUB_RESERVE) {
          blockedUntil = answer.resetAt ?? now() + 60 * 60_000;
          break;
        }
      }
      return changed;
    },
    async update(person, item) {
      const record = deps.records(person).find((candidate) => updateKey("skill", candidate.scope, candidate.target, candidate.name) === item.key);
      if (!record?.github) throw new Error("This skill was not imported from GitHub, so it has no source to update from.");
      const done = await deps.reimport(person, record);
      return done?.commit ? { to: done.commit.slice(0, 7) } : {};
    },
  };
}

// ── connectors ────────────────────────────────────────────────────────

export interface InstalledConnectorRecord extends Place, Organization {
  name: string;
  /** a command server: its program and arguments (a remote server has none:
   * its provider updates it) */
  command?: string;
  args?: string[];
}

export interface ConnectorProviderDeps {
  records(person: UpdatePerson): InstalledConnectorRecord[];
  allRecords(): InstalledConnectorRecord[];
  fetcher?: typeof fetch;
  /** Save the server's new arguments (the old ones stay on a throw). */
  setArgs(person: UpdatePerson, record: InstalledConnectorRecord, args: string[]): Promise<void> | void;
}

export function connectorUpdateProvider(deps: ConnectorProviderDeps): UpdateProvider & { fields(record: InstalledConnectorRecord): ListedUpdateFields } {
  const latest = new Map<string, string>();
  const known = (record: InstalledConnectorRecord) => {
    const pin = record.command ? pinnedPackage(record.command, record.args ?? []) : null;
    if (!pin) return null;
    const newest = record.organization ? undefined : latest.get(`${pin.registry}:${pin.name}`);
    const newer = newest !== undefined && (compareVersions(newest, pin.version) ?? 0) > 0;
    return { pin, newest: newer ? newest : undefined, unknown: !record.organization && newest === undefined };
  };
  const item = (record: InstalledConnectorRecord): UpdateItem => {
    const state = known(record);
    return {
      ...base("connector", record, record.name, record.name, record),
      ...(state ? { installedVersion: state.pin.version } : {}),
      ...(state?.unknown ? { updateUnknown: true as const } : {}),
      updateAvailable: Boolean(state?.newest),
      ...(state?.newest ? { availableVersion: state.newest } : {}),
    };
  };
  return {
    kind: "connector",
    fields: (record) => listed(item(record)),
    items(person) {
      return deps.records(person).map(item);
    },
    async check() {
      const packages = new Map<string, { registry: "npm" | "pypi"; name: string }>();
      for (const record of deps.allRecords()) {
        const pin = record.command && !record.organization ? pinnedPackage(record.command, record.args ?? []) : null;
        if (pin) packages.set(`${pin.registry}:${pin.name}`, pin);
      }
      let changed = false;
      for (const [key, pin] of packages) {
        const version = await latestPackageVersion(pin, deps.fetcher);
        if (!version) continue;
        if (latest.get(key) !== version) changed = true;
        latest.set(key, version);
      }
      return changed;
    },
    async update(person, item) {
      const record = deps.records(person).find((candidate) => updateKey("connector", candidate.scope, candidate.target, candidate.name) === item.key);
      const state = record ? known(record) : null;
      if (!record || !state?.newest) throw new Error("This connector has no newer version to install.");
      await deps.setArgs(person, record, withPinnedVersion(record.args ?? [], state.pin, state.newest));
      return { to: state.newest };
    },
  };
}
