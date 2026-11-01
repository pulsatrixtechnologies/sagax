// Organization library catalog (contract §5.3). One parser for Electron main
// and the local runtime: unknown fields are ignored, a malformed entry is
// dropped, a malformed envelope (or another organization's catalog) returns
// null. Plain checks, no zod: Electron's .mjs loads this as TypeScript.

export const ORG_LIBRARY_FORMAT = "openmaus.org-library" as const;
export const ORG_LIBRARY_CATALOG_MAX_ENTRIES = 100;
export const ORG_LIBRARY_CATALOG_BLOB_MAX_BYTES = 4 * 1024 * 1024;
export const ORG_LIBRARY_WITHDRAWN_MAX = 50;
export const ORG_LIBRARY_NOTES_MAX = 4_000;

const HEX64 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SEMVER = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const REF = /^[a-z][a-z0-9-]{1,30}\/[a-z0-9][a-z0-9-]{0,79}$/;

// oxlint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1f\x7f]/;
// Release notes may hold newlines, nothing else below 0x20.
// oxlint-disable-next-line no-control-regex
const NOTES_CONTROL = /[\x00-\x09\x0b-\x1f\x7f]/;

const safeText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max && !CONTROL.test(value);
const notesText = (value: unknown): value is string =>
  typeof value === "string" && value.length <= ORG_LIBRARY_NOTES_MAX && !NOTES_CONTROL.test(value);
const matches = (pattern: RegExp, value: unknown): value is string => typeof value === "string" && pattern.test(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);

export interface OrgLibraryRelease {
  version: string;
  sha256: string;
  sizeBytes: number;
  formatVersion: number;
  publishedAt: number;
  notes: string;
}

export interface OrgLibraryEntry {
  packageId: string;
  ref: string;
  name: string;
  tagline: string;
  kind: "team" | "library";
  publisher: { organizationId: string; name: string; self: boolean };
  mode: "required" | "available" | "off";
  offAction: "keep" | "remove";
  release: OrgLibraryRelease | null;
  withdrawnReleases: Array<{ version: string; sha256: string }>;
  contents: {
    bots: number;
    skills: number;
    presets: number;
    rooms: number;
    routines: number;
    connections: number;
    botNames: string[];
  };
  scanFindings: number;
}

export interface OrgLibraryCatalog {
  format: typeof ORG_LIBRARY_FORMAT;
  version: 1;
  libraryVersion: number;
  organization: { id: string; name: string };
  truncated?: true;
  packages: OrgLibraryEntry[];
}

export interface ParseOrgLibraryCatalogOptions {
  organizationId?: string;
}

function parseRelease(value: unknown): OrgLibraryRelease | null | undefined {
  if (value === null) return null;
  if (!record(value) || !matches(SEMVER, value.version) || !matches(HEX64, value.sha256)
    || !Number.isSafeInteger(value.sizeBytes) || (value.sizeBytes as number) < 1
    || (value.sizeBytes as number) > ORG_LIBRARY_CATALOG_BLOB_MAX_BYTES
    || !Number.isSafeInteger(value.formatVersion) || (value.formatVersion as number) < 1
    || !count(value.publishedAt) || !notesText(value.notes)) return undefined;
  return {
    version: value.version,
    sha256: value.sha256,
    sizeBytes: value.sizeBytes as number,
    formatVersion: value.formatVersion as number,
    publishedAt: value.publishedAt as number,
    notes: value.notes,
  };
}

function parseEntry(value: unknown): OrgLibraryEntry | null {
  if (!record(value)) return null;
  const { packageId, ref, name, tagline, kind, publisher, mode, offAction, withdrawnReleases, contents, scanFindings } = value;
  const release = parseRelease(value.release);
  if (!matches(UUID, packageId) || !matches(REF, ref) || !safeText(name, 100) || !safeText(tagline, 160)
    || !oneOf(["team", "library"], kind)
    || !record(publisher) || !matches(UUID, publisher.organizationId) || !safeText(publisher.name, 100) || typeof publisher.self !== "boolean"
    || !oneOf(["required", "available", "off"], mode) || !oneOf(["keep", "remove"], offAction) || release === undefined
    || !Array.isArray(withdrawnReleases) || withdrawnReleases.length > ORG_LIBRARY_WITHDRAWN_MAX
    || !withdrawnReleases.every((item) => record(item) && matches(SEMVER, item.version) && matches(HEX64, item.sha256))
    || !record(contents) || !["bots", "skills", "presets", "rooms", "routines", "connections"].every((key) => count(contents[key]))
    || !Array.isArray(contents.botNames) || contents.botNames.length > 12 || !contents.botNames.every((bot) => safeText(bot, 100))
    || !count(scanFindings)) return null;
  return {
    packageId,
    ref,
    name,
    tagline,
    kind,
    publisher: { organizationId: publisher.organizationId, name: publisher.name, self: publisher.self },
    mode,
    offAction,
    release,
    withdrawnReleases: withdrawnReleases.map((item) => ({ version: (item as { version: string }).version, sha256: (item as { sha256: string }).sha256 })),
    contents: {
      bots: contents.bots as number,
      skills: contents.skills as number,
      presets: contents.presets as number,
      rooms: contents.rooms as number,
      routines: contents.routines as number,
      connections: contents.connections as number,
      botNames: [...(contents.botNames as string[])],
    },
    scanFindings: scanFindings as number,
  };
}

/** GET /api/desktop/library (contract §5.3). Takes the parsed JSON, its text
 * or its bytes. Unknown fields are ignored and a malformed entry is dropped;
 * a malformed envelope, or another organization's catalog, returns null so
 * the caller keeps the last good one. A formatVersion above 2 stays listed
 * ("update the app") and is never fetched. */
export function parseOrgLibraryCatalog(
  input: unknown,
  options: ParseOrgLibraryCatalogOptions = {},
): OrgLibraryCatalog | null {
  let value: unknown = input;
  if (typeof input === "string" || input instanceof Uint8Array) {
    try {
      value = JSON.parse(typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input));
    } catch {
      return null;
    }
  }
  if (!record(value) || value.format !== ORG_LIBRARY_FORMAT || value.version !== 1 || !count(value.libraryVersion)
    || !record(value.organization) || !matches(UUID, value.organization.id) || !safeText(value.organization.name, 100)
    || !Array.isArray(value.packages) || value.packages.length > ORG_LIBRARY_CATALOG_MAX_ENTRIES) return null;
  if (options.organizationId !== undefined && value.organization.id !== options.organizationId) return null;
  const seen = new Set<string>();
  const packages: OrgLibraryEntry[] = [];
  for (const item of value.packages) {
    const entry = parseEntry(item);
    if (entry && !seen.has(entry.packageId)) {
      seen.add(entry.packageId);
      packages.push(entry);
    }
  }
  return {
    format: ORG_LIBRARY_FORMAT,
    version: 1,
    libraryVersion: value.libraryVersion as number,
    organization: { id: value.organization.id, name: value.organization.name },
    ...(value.truncated === true ? { truncated: true as const } : {}),
    packages,
  };
}
