// Import and export of the credential vault (Settings > Credentials):
// the files other password managers write, read in memory, and the files
// they read back. Pure: no clock, no disk, no node built-ins, no network.
//
// Import formats (the real columns of each export):
//
//   Bitwarden JSON (unencrypted)  { encrypted: false, items: [{ type, name, notes, login: { username, password, totp, uris } }] }
//   Bitwarden CSV                 folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp
//   LastPass CSV                  url,username,password,totp,extra,name,grouping,fav   (url http://sn: a secure note)
//   Apple Passwords CSV           Title,URL,Username,Password,Notes,OTPAuth
//   1Password CSV (1Password 8)   Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes
//   1Password 1PUX                a zip with export.data (accounts > vaults > items)
//   Chrome, Edge, Brave CSV       name,url,username,password,note
//   Firefox CSV                   url,username,password,httpRealm,formActionOrigin,guid,timeCreated,timeLastUsed,timePasswordChanged
//   Generic CSV                   a header with a password or user name column and a site column, in any order
//
// Nothing is invented: a field the vault cannot keep (an attachment, a
// custom field, a passkey, a one-time code seed it cannot read) is counted
// for the preview and left out, and an item the vault cannot keep (a card,
// an identity, a login with no site it may be filled on) is listed with
// why. Sites come from the item's URLs (host and port; a path is dropped).
//
// Export formats: Chrome CSV (the one most managers import: Chrome, Edge,
// Brave, Apple Passwords, 1Password, Bitwarden), Bitwarden CSV and
// Bitwarden JSON (unencrypted). Both Bitwarden files keep notes, API keys
// (a login with the custom field sagax_kind: apiKey) and one-time code
// seeds, so a Sagax export imports back as it was.

import { MAX_VAULT_DOMAINS, normalizeVaultDomain, type VaultItemKind } from "./credential-vault.ts";

export const VAULT_IMPORT_FORMATS = [
  "bitwarden-json",
  "bitwarden-csv",
  "lastpass-csv",
  "apple-csv",
  "onepassword-csv",
  "onepassword-1pux",
  "chrome-csv",
  "firefox-csv",
  "generic-csv",
] as const;
export type VaultImportFormat = (typeof VAULT_IMPORT_FORMATS)[number];

export const VAULT_EXPORT_FORMATS = ["chrome-csv", "bitwarden-csv", "bitwarden-json"] as const;
export type VaultExportFormat = (typeof VAULT_EXPORT_FORMATS)[number];

export const VAULT_DUPLICATE_MODES = ["merge", "skip"] as const;
export type VaultDuplicateMode = (typeof VAULT_DUPLICATE_MODES)[number];

/** The vault's own field limits (server/vault/credential-vault.ts itemSchema). */
export const VAULT_FIELD_LIMITS = { name: 120, username: 512, password: 4_096, totpSeed: 1_024, apiKey: 16_384, notes: 16_384 } as const;

/** The largest file the app reads (a 1PUX zip with no attachments, or a CSV). */
export const MAX_VAULT_IMPORT_BYTES = 8 * 1024 * 1024;

/** One item as read from a file or written to one. Values only in memory. */
export interface VaultTransferItem {
  kind: VaultItemKind;
  name: string;
  username?: string;
  password?: string;
  totpSeed?: string;
  apiKey?: string;
  notes?: string;
  domains: string[];
}

/** Why an item of the file is not imported. */
export type VaultImportSkipReason =
  | "unsupported_type"
  | "no_site"
  | "empty"
  | "too_long"
  | "archived"
  | "deleted";

/** A field of the file the vault does not keep, counted for the preview. */
export type VaultDroppedField =
  | "attachments"
  | "customFields"
  | "passkeys"
  | "totp"
  | "extraSites";

export interface VaultImportSkip {
  /** 1-based position in the file (a CSV row counts its header as row 1). */
  row: number;
  name: string;
  reason: VaultImportSkipReason;
}

export interface ParsedVaultImport {
  format: VaultImportFormat;
  items: VaultTransferItem[];
  skipped: VaultImportSkip[];
  dropped: Partial<Record<VaultDroppedField, number>>;
}

export class VaultImportError extends Error {
  readonly code: "unknown_format" | "encrypted" | "empty" | "too_large" | "unreadable";
  constructor(code: VaultImportError["code"], message?: string) {
    super(message ?? code);
    this.name = "VaultImportError";
    this.code = code;
  }
}

// ── CSV ────────────────────────────────────────────────────────────────

/** RFC 4180: quoted fields with "" for a quote, commas and line breaks
 * inside quotes, CRLF or LF rows. A leading byte order mark is dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === "\"") {
        if (text[index + 1] === "\"") {
          field += "\"";
          index++;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === "\"" && field === "") quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/** A cell a spreadsheet would run as a formula (=, +, -, @, a tab or a
 * carriage return first): a name or a note gets a leading apostrophe. A
 * password, a user name or a URL is written as it is, or it would no
 * longer sign in. */
export function inertCell(value: string | undefined): string | undefined {
  return value && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string | undefined): string {
  const text = value ?? "";
  return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | undefined>>): string {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

// ── fields ─────────────────────────────────────────────────────────────

const BASE32 = /^[A-Z2-7]+=*$/;

/** Whether the vault can compute codes from this seed (the rules of
 * server/totp.ts parseTotpSeed, without its crypto). */
export function readableTotpSeed(raw: string | undefined): boolean {
  const text = raw?.trim();
  if (!text) return false;
  if (/^otpauth:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return false;
    }
    if (url.hostname.toLowerCase() !== "totp") return false;
    const secret = (url.searchParams.get("secret") ?? "").replace(/[\s=-]/g, "").toUpperCase();
    if (!secret || !BASE32.test(secret)) return false;
    const algorithm = (url.searchParams.get("algorithm") ?? "SHA1").toUpperCase();
    const digits = Number(url.searchParams.get("digits") ?? 6);
    const period = Number(url.searchParams.get("period") ?? 30);
    return ["SHA1", "SHA256", "SHA512"].includes(algorithm) && Number.isInteger(digits) && digits >= 6 && digits <= 8 &&
      Number.isInteger(period) && period >= 10 && period <= 300;
  }
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  return clean.length >= 8 && BASE32.test(clean);
}

/** The site a URL of another manager binds to, as the vault stores it
 * (shared/credential-vault.ts normalizeVaultDomain): host and port, a path
 * dropped. An http URL other than localhost becomes its https site (the
 * vault fills over https only), and *.host its exact host. Null for an app link (androidapp://), a
 * LastPass note marker, an IP address, a URL with a user name or anything
 * else the vault refuses. */
export function siteFromUrl(raw: string | undefined): string | null {
  const text = raw?.trim();
  if (!text || text.length > 2_048) return null;
  // A wildcard from a file binds its exact host only: a file never creates
  // a binding that covers subdomains (a shared host's tenants).
  const wildcard = /^(?:https:\/\/)?\*\.([^/?#]+)/i.exec(text);
  if (wildcard) return normalizeVaultDomain(wildcard[1]!);
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // user@host is ambiguous to read (bank.example@other.example): refused
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const port = url.port ? `:${url.port}` : "";
  if (url.protocol === "http:" && host === "localhost") return normalizeVaultDomain(`http://localhost${port}`);
  return normalizeVaultDomain(`${host}${port}`);
}

/** The URL a site is written as in an export: https://host[:port], the
 * localhost http binding as it is, a wildcard as https://*.host. */
export function urlFromSite(domain: string): string {
  return domain.startsWith("http://") ? domain : `https://${domain}`;
}

interface Collector {
  items: VaultTransferItem[];
  skipped: VaultImportSkip[];
  dropped: Partial<Record<VaultDroppedField, number>>;
}

function drop(collector: Collector, field: VaultDroppedField, count = 1): void {
  if (count > 0) collector.dropped[field] = (collector.dropped[field] ?? 0) + count;
}

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim() ? value : undefined;
}

function hostName(domains: readonly string[]): string {
  const first = domains[0];
  return first ? first.replace(/^http:\/\//, "").replace(/^\*\./, "") : "";
}

/** One item read from a file: checked against the vault's rules, added or
 * listed as skipped. */
function accept(collector: Collector, row: number, input: {
  kind: VaultItemKind;
  name?: string;
  username?: string;
  password?: string;
  totp?: string;
  apiKey?: string;
  notes?: string;
  urls?: ReadonlyArray<string | undefined>;
}): void {
  const domains: string[] = [];
  let extra = 0;
  for (const url of input.urls ?? []) {
    const site = siteFromUrl(url);
    if (!site || domains.includes(site)) continue;
    if (domains.length >= MAX_VAULT_DOMAINS) extra++;
    else domains.push(site);
  }
  const username = clean(input.username)?.trim();
  const password = clean(input.password);
  const apiKey = clean(input.apiKey)?.trim();
  const notes = clean(input.notes);
  let totpSeed = clean(input.totp)?.trim();
  const name = (clean(input.name)?.trim() || hostName(domains) || username || "").slice(0, VAULT_FIELD_LIMITS.name).trim();
  const label = name || `#${row}`;
  if (input.kind === "login" && !username && !password && !totpSeed) return void collector.skipped.push({ row, name: label, reason: "empty" });
  if (input.kind === "note" && !notes) return void collector.skipped.push({ row, name: label, reason: "empty" });
  if (input.kind === "apiKey" && !apiKey) return void collector.skipped.push({ row, name: label, reason: "empty" });
  if (input.kind !== "note" && !domains.length) return void collector.skipped.push({ row, name: label, reason: "no_site" });
  if ((username?.length ?? 0) > VAULT_FIELD_LIMITS.username || (password?.length ?? 0) > VAULT_FIELD_LIMITS.password ||
    (apiKey?.length ?? 0) > VAULT_FIELD_LIMITS.apiKey || (notes?.length ?? 0) > VAULT_FIELD_LIMITS.notes) {
    return void collector.skipped.push({ row, name: label, reason: "too_long" });
  }
  if (totpSeed && (input.kind !== "login" || totpSeed.length > VAULT_FIELD_LIMITS.totpSeed || !readableTotpSeed(totpSeed))) {
    drop(collector, "totp");
    totpSeed = undefined;
  }
  drop(collector, "extraSites", extra);
  const item: VaultTransferItem = { kind: input.kind, name: label.slice(0, VAULT_FIELD_LIMITS.name), domains: input.kind === "note" ? [] : domains };
  if (input.kind === "login") {
    if (username) item.username = username;
    if (password) item.password = password;
    if (totpSeed) item.totpSeed = totpSeed;
  }
  if (input.kind === "apiKey") item.apiKey = apiKey;
  if (notes) item.notes = notes;
  collector.items.push(item);
}

// ── detection ──────────────────────────────────────────────────────────

const lower = (cells: readonly string[]) => cells.map((cell) => cell.trim().toLowerCase());

/** The format of a CSV header, or null when no column names a password or
 * a user name. */
export function detectCsvFormat(header: readonly string[]): VaultImportFormat | null {
  const columns = new Set(lower(header));
  const has = (...names: string[]) => names.every((name) => columns.has(name));
  if (has("login_uri", "login_password") || has("login_username", "type", "name")) return "bitwarden-csv";
  if (has("url", "username", "password", "extra", "grouping")) return "lastpass-csv";
  if (has("url", "username", "password") && (columns.has("httprealm") || columns.has("formactionorigin"))) return "firefox-csv";
  if (has("title", "url", "username", "password", "otpauth") && (columns.has("archived") || columns.has("favorite") || columns.has("tags"))) return "onepassword-csv";
  if (has("title", "url", "username", "password")) return "apple-csv";
  if (has("name", "url", "username", "password")) return "chrome-csv";
  const known = GENERIC_COLUMNS;
  const named = (field: keyof typeof GENERIC_COLUMNS) => known[field].some((name) => columns.has(name));
  return (named("password") || named("username")) && (named("url") || named("name")) ? "generic-csv" : null;
}

const GENERIC_COLUMNS = {
  name: ["name", "title", "item", "account", "label", "nom", "titre"],
  url: ["url", "uri", "website", "web site", "site", "login_uri", "login url", "hostname", "address"],
  username: ["username", "user name", "user", "login", "login_username", "email", "e-mail", "identifiant", "nom d'utilisateur"],
  password: ["password", "pass", "login_password", "mot de passe"],
  notes: ["notes", "note", "extra", "comments", "comment"],
  totp: ["totp", "otp", "otpauth", "login_totp", "one-time password", "2fa"],
} as const;

/** What a file looks like before it is parsed: a zip (1PUX), JSON or CSV. */
export function detectVaultFile(bytes: Uint8Array): "zip" | "json" | "csv" {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "zip";
  let index = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (index < bytes.length && (bytes[index] === 0x20 || bytes[index] === 0x09 || bytes[index] === 0x0a || bytes[index] === 0x0d)) index++;
  return bytes[index] === 0x7b || bytes[index] === 0x5b ? "json" : "csv";
}

// ── parsers ────────────────────────────────────────────────────────────

/** A CSV export of any of the managers above. */
export function parseVaultCsv(text: string): ParsedVaultImport {
  const rows = parseCsv(text);
  if (!rows.length) throw new VaultImportError("empty");
  const header = rows[0]!;
  const format = detectCsvFormat(header);
  if (!format) throw new VaultImportError("unknown_format");
  const names = lower(header);
  const column = (...candidates: readonly string[]) => {
    for (const name of candidates) {
      const at = names.indexOf(name);
      if (at >= 0) return at;
    }
    return -1;
  };
  const collector: Collector = { items: [], skipped: [], dropped: {} };
  const at = {
    name: column(...(format === "lastpass-csv" || format === "chrome-csv" || format === "bitwarden-csv" ? ["name"] : GENERIC_COLUMNS.name)),
    url: column(...(format === "bitwarden-csv" ? ["login_uri"] : GENERIC_COLUMNS.url)),
    username: column(...(format === "bitwarden-csv" ? ["login_username"] : GENERIC_COLUMNS.username)),
    password: column(...(format === "bitwarden-csv" ? ["login_password"] : GENERIC_COLUMNS.password)),
    notes: column(...(format === "lastpass-csv" ? ["extra"] : GENERIC_COLUMNS.notes)),
    totp: column(...(format === "bitwarden-csv" ? ["login_totp"] : GENERIC_COLUMNS.totp)),
    type: column("type"),
    fields: column("fields"),
    archived: column("archived"),
  };
  rows.slice(1).forEach((cells, offset) => {
    const row = offset + 2;
    const cell = (index: number) => (index >= 0 ? cells[index] : undefined);
    const name = cell(at.name);
    if (format === "bitwarden-csv") {
      const type = (cell(at.type) ?? "login").trim().toLowerCase();
      const custom = parseBitwardenCsvFields(cell(at.fields));
      if (type === "note") {
        drop(collector, "customFields", custom.others);
        return accept(collector, row, { kind: "note", name, notes: cell(at.notes) });
      }
      if (type !== "login") return void collector.skipped.push({ row, name: name?.trim() || `#${row}`, reason: "unsupported_type" });
      // a Sagax export: an API key travels as a login marked sagax_kind
      const urls = splitBitwardenUris(cell(at.url));
      drop(collector, "customFields", custom.others);
      if (custom.apiKey) return accept(collector, row, { kind: "apiKey", name, apiKey: cell(at.password), notes: cell(at.notes), urls });
      return accept(collector, row, { kind: "login", name, username: cell(at.username), password: cell(at.password), totp: cell(at.totp), notes: cell(at.notes), urls });
    }
    if (format === "lastpass-csv" && /^https?:\/\/sn\/?$/i.test(cell(at.url)?.trim() ?? "")) {
      return accept(collector, row, { kind: "note", name, notes: cell(at.notes) });
    }
    if (at.archived >= 0 && /^(?:true|1|yes)$/i.test(cell(at.archived)?.trim() ?? "")) {
      return void collector.skipped.push({ row, name: name?.trim() || `#${row}`, reason: "archived" });
    }
    accept(collector, row, {
      kind: "login",
      name,
      username: cell(at.username),
      password: cell(at.password),
      totp: cell(at.totp),
      notes: cell(at.notes),
      urls: format === "onepassword-csv" ? (cell(at.url) ?? "").split(/\s*,\s*/) : [cell(at.url)],
    });
  });
  return { format, ...collector };
}

/** Bitwarden CSV keeps several URIs of a login in one cell, comma separated. */
function splitBitwardenUris(cell: string | undefined): string[] {
  return (cell ?? "").split(/[,\n]/).map((part) => part.trim()).filter(Boolean);
}

/** Bitwarden CSV "fields": one "name: value" per line. */
function parseBitwardenCsvFields(cell: string | undefined): { apiKey: boolean; others: number } {
  let apiKey = false;
  let others = 0;
  for (const line of (cell ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (/^sagax_kind:\s*apiKey\s*$/.test(line.trim())) apiKey = true;
    else others++;
  }
  return { apiKey, others };
}

interface BitwardenItem {
  type?: unknown;
  name?: unknown;
  notes?: unknown;
  deletedDate?: unknown;
  login?: { username?: unknown; password?: unknown; totp?: unknown; uris?: unknown; fido2Credentials?: unknown } | null;
  fields?: unknown;
  attachments?: unknown;
}

/** An unencrypted Bitwarden JSON export (or a Sagax one). */
export function parseBitwardenJson(document: unknown): ParsedVaultImport {
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new VaultImportError("unknown_format");
  const root = document as { encrypted?: unknown; passwordProtected?: unknown; items?: unknown };
  if (root.encrypted === true || root.passwordProtected === true) throw new VaultImportError("encrypted");
  if (!Array.isArray(root.items)) throw new VaultImportError("unknown_format");
  const collector: Collector = { items: [], skipped: [], dropped: {} };
  root.items.forEach((raw, index) => {
    const row = index + 1;
    const item = (raw && typeof raw === "object" ? raw : {}) as BitwardenItem;
    const name = typeof item.name === "string" ? item.name : undefined;
    const label = name?.trim() || `#${row}`;
    if (item.deletedDate) return void collector.skipped.push({ row, name: label, reason: "deleted" });
    const fields = Array.isArray(item.fields) ? item.fields as Array<{ name?: unknown; value?: unknown }> : [];
    const apiKeyMarker = fields.some((field) => field?.name === "sagax_kind" && field?.value === "apiKey");
    const otherFields = fields.filter((field) => field?.name !== "sagax_kind").length;
    const attachments = Array.isArray(item.attachments) ? item.attachments.length : 0;
    if (item.type === 2) {
      drop(collector, "customFields", otherFields);
      drop(collector, "attachments", attachments);
      return accept(collector, row, { kind: "note", name, notes: typeof item.notes === "string" ? item.notes : undefined });
    }
    if (item.type !== 1 || !item.login || typeof item.login !== "object") {
      return void collector.skipped.push({ row, name: label, reason: "unsupported_type" });
    }
    const login = item.login;
    const uris = Array.isArray(login.uris) ? (login.uris as Array<{ uri?: unknown }>).map((entry) => (typeof entry?.uri === "string" ? entry.uri : undefined)) : [];
    const before = collector.items.length;
    if (apiKeyMarker) {
      accept(collector, row, { kind: "apiKey", name, apiKey: typeof login.password === "string" ? login.password : undefined, notes: typeof item.notes === "string" ? item.notes : undefined, urls: uris });
    } else {
      accept(collector, row, {
        kind: "login",
        name,
        username: typeof login.username === "string" ? login.username : undefined,
        password: typeof login.password === "string" ? login.password : undefined,
        totp: typeof login.totp === "string" ? login.totp : undefined,
        notes: typeof item.notes === "string" ? item.notes : undefined,
        urls: uris,
      });
    }
    if (collector.items.length > before) {
      drop(collector, "customFields", otherFields);
      drop(collector, "attachments", attachments);
      drop(collector, "passkeys", Array.isArray(login.fido2Credentials) ? login.fido2Credentials.length : 0);
    }
  });
  return { format: "bitwarden-json", ...collector };
}

interface OnePuxItem {
  state?: unknown;
  categoryUuid?: unknown;
  overview?: { title?: unknown; url?: unknown; urls?: unknown } | null;
  details?: {
    loginFields?: unknown;
    notesPlain?: unknown;
    password?: unknown;
    sections?: unknown;
    documentAttributes?: unknown;
  } | null;
}

interface OnePuxField {
  id?: unknown;
  title?: unknown;
  value?: Record<string, unknown> | null;
}

/** 1Password categories the vault keeps: Login, Password, Secure Note, API Credential. */
const ONEPUX_LOGIN = new Set(["001", "005"]);
const ONEPUX_NOTE = "003";
const ONEPUX_API = "112";

/** The export.data of a 1Password 1PUX file. */
export function parseOnePuxData(document: unknown): ParsedVaultImport {
  const accounts = (document as { accounts?: unknown })?.accounts;
  if (!Array.isArray(accounts)) throw new VaultImportError("unknown_format");
  const collector: Collector = { items: [], skipped: [], dropped: {} };
  let row = 0;
  for (const account of accounts) {
    const vaults = (account as { vaults?: unknown })?.vaults;
    if (!Array.isArray(vaults)) continue;
    for (const vault of vaults) {
      const items = (vault as { items?: unknown })?.items;
      if (!Array.isArray(items)) continue;
      for (const raw of items) {
        row++;
        const item = (raw && typeof raw === "object" ? raw : {}) as OnePuxItem;
        const overview = item.overview ?? {};
        const details = item.details ?? {};
        const name = typeof overview.title === "string" ? overview.title : undefined;
        const label = name?.trim() || `#${row}`;
        if (item.state === "archived") { collector.skipped.push({ row, name: label, reason: "archived" }); continue; }
        if (item.state === "deleted") { collector.skipped.push({ row, name: label, reason: "deleted" }); continue; }
        const category = typeof item.categoryUuid === "string" ? item.categoryUuid : "";
        const urls = [
          typeof overview.url === "string" ? overview.url : undefined,
          ...(Array.isArray(overview.urls) ? (overview.urls as Array<{ url?: unknown }>).map((entry) => (typeof entry?.url === "string" ? entry.url : undefined)) : []),
        ];
        const fields: OnePuxField[] = [];
        for (const section of Array.isArray(details.sections) ? details.sections as Array<{ fields?: unknown }> : []) {
          if (Array.isArray(section?.fields)) fields.push(...section.fields as OnePuxField[]);
        }
        const fieldText = (field: OnePuxField): string | undefined => {
          const value = field.value ?? {};
          for (const key of ["concealed", "string", "totp", "url", "email"]) {
            const found = value[key];
            if (typeof found === "string") return found;
            if (found && typeof found === "object" && typeof (found as { email_address?: unknown }).email_address === "string") return (found as { email_address: string }).email_address;
          }
          return undefined;
        };
        const totpField = fields.find((field) => field.value && typeof field.value.totp === "string");
        const fileFields = fields.filter((field) => field.value && typeof field.value === "object" && "file" in field.value).length;
        const passkeyFields = fields.filter((field) => field.value && typeof field.value === "object" && "passkey" in field.value).length;
        const attachments = (details.documentAttributes ? 1 : 0) + fileFields;
        const notes = typeof details.notesPlain === "string" ? details.notesPlain : undefined;
        const before = collector.items.length;
        let used = totpField ? 1 : 0;
        if (ONEPUX_LOGIN.has(category)) {
          const loginFields = Array.isArray(details.loginFields) ? details.loginFields as Array<{ designation?: unknown; value?: unknown }> : [];
          const designated = (designation: string) => {
            const found = loginFields.find((field) => field?.designation === designation);
            return typeof found?.value === "string" ? found.value : undefined;
          };
          const password = designated("password") ?? (typeof details.password === "string" ? details.password : undefined);
          accept(collector, row, { kind: "login", name, username: designated("username"), password, totp: totpField ? fieldText(totpField) : undefined, notes, urls });
        } else if (category === ONEPUX_NOTE) {
          used = 0;
          accept(collector, row, { kind: "note", name, notes });
        } else if (category === ONEPUX_API) {
          const credential = fields.find((field) => field.id === "credential") ?? fields.find((field) => field.value && typeof field.value.concealed === "string");
          const hostField = fields.find((field) => field.id === "hostname");
          used = (credential ? 1 : 0) + (hostField ? 1 : 0);
          accept(collector, row, { kind: "apiKey", name, apiKey: credential ? fieldText(credential) : undefined, notes, urls: [...urls, hostField ? fieldText(hostField) : undefined] });
        } else {
          collector.skipped.push({ row, name: label, reason: "unsupported_type" });
          continue;
        }
        if (collector.items.length > before) {
          drop(collector, "customFields", Math.max(0, fields.length - used - fileFields - passkeyFields));
          drop(collector, "attachments", attachments);
          drop(collector, "passkeys", passkeyFields);
        }
      }
    }
  }
  return { format: "onepassword-1pux", ...collector };
}

// ── zip (1PUX) ─────────────────────────────────────────────────────────

const readU16 = (bytes: Uint8Array, at: number) => bytes[at]! | (bytes[at + 1]! << 8);
const readU32 = (bytes: Uint8Array, at: number) => (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;

/** One entry of a zip, by name, from its central directory. Stored or
 * deflated (DecompressionStream "deflate-raw"); null when absent. Reads in
 * memory only. */
export async function readZipEntry(bytes: Uint8Array, wanted: string, maxBytes = MAX_VAULT_IMPORT_BYTES * 4): Promise<Uint8Array | null> {
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65_535); at--) {
    if (readU32(bytes, at) === 0x06054b50) { end = at; break; }
  }
  if (end < 0) throw new VaultImportError("unreadable");
  const count = readU16(bytes, end + 10);
  let at = readU32(bytes, end + 16);
  const decoder = new TextDecoder();
  for (let index = 0; index < count; index++) {
    if (at + 46 > bytes.length || readU32(bytes, at) !== 0x02014b50) throw new VaultImportError("unreadable");
    const method = readU16(bytes, at + 10);
    const compressed = readU32(bytes, at + 20);
    const size = readU32(bytes, at + 24);
    const nameLength = readU16(bytes, at + 28);
    const extraLength = readU16(bytes, at + 30);
    const commentLength = readU16(bytes, at + 32);
    const local = readU32(bytes, at + 42);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name !== wanted) continue;
    if (size > maxBytes) throw new VaultImportError("too_large");
    if (local + 30 > bytes.length || readU32(bytes, local) !== 0x04034b50) throw new VaultImportError("unreadable");
    const start = local + 30 + readU16(bytes, local + 26) + readU16(bytes, local + 28);
    const data = bytes.subarray(start, start + compressed);
    if (method === 0) return data;
    if (method !== 8 || typeof DecompressionStream === "undefined") throw new VaultImportError("unreadable");
    // Inflated chunk by chunk and stopped past the limit: the size the zip
    // claims is the file's word, and a small file can inflate to gigabytes.
    if (size > Math.max(compressed, 1) * 200) throw new VaultImportError("too_large");
    const reader = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > Math.min(maxBytes, Math.max(size, 1))) {
        await reader.cancel().catch(() => {});
        throw new VaultImportError("too_large");
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
  return null;
}

/** Any supported file, as bytes read in memory: the format is detected. */
export async function parseVaultImportFile(bytes: Uint8Array): Promise<ParsedVaultImport> {
  if (bytes.length > MAX_VAULT_IMPORT_BYTES) throw new VaultImportError("too_large");
  if (!bytes.length) throw new VaultImportError("empty");
  const kind = detectVaultFile(bytes);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  if (kind === "zip") {
    const data = await readZipEntry(bytes, "export.data");
    if (!data) throw new VaultImportError("unknown_format");
    return parseOnePuxData(parseJson(decoder.decode(data)));
  }
  const text = decoder.decode(bytes);
  if (kind === "json") return parseBitwardenJson(parseJson(text));
  return parseVaultCsv(text);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new VaultImportError("unreadable");
  }
}

// ── duplicates ─────────────────────────────────────────────────────────

/** What an item is compared on: a login by site and user name, an API key
 * by site and name, a note by name. Case-insensitive. */
export function duplicateKeys(item: { kind: VaultItemKind; name: string; username?: string; domains: readonly string[] }): string[] {
  const name = item.name.trim().toLowerCase();
  if (item.kind === "note") return [`note\n${name}`];
  const who = item.kind === "login" ? (item.username ?? "").trim().toLowerCase() : name;
  return item.domains.map((domain) => `${item.kind}\n${domain}\n${who}`);
}

export interface VaultImportExisting {
  id: string;
  kind: VaultItemKind;
  name: string;
  username?: string;
  domains: readonly string[];
  source: "local" | "1password";
}

export interface VaultImportPlan {
  create: VaultTransferItem[];
  merge: Array<{ id: string; item: VaultTransferItem }>;
  /** Already in the vault and left as they are ("skip", or a 1Password item, read-only here). */
  duplicates: number;
  /** The same item twice in the file: the first one is kept. */
  inFile: number;
  /** Over the vault's item limit: not imported. */
  overLimit: number;
}

/** Which items of a file are new, which match one already saved (merged or
 * left out) and which repeat an earlier one of the file. The app's preview
 * and the server's import compute it the same way. */
export function planVaultImport(items: readonly VaultTransferItem[], existing: readonly VaultImportExisting[], mode: VaultDuplicateMode, capacity = Infinity): VaultImportPlan {
  const saved = new Map<string, VaultImportExisting>();
  for (const row of existing) for (const key of duplicateKeys(row)) if (!saved.has(key)) saved.set(key, row);
  const seen = new Set<string>();
  const plan: VaultImportPlan = { create: [], merge: [], duplicates: 0, inFile: 0, overLimit: 0 };
  const merged = new Set<string>();
  let room = capacity;
  for (const item of items) {
    const keys = duplicateKeys(item);
    if (keys.some((key) => seen.has(key))) {
      plan.inFile++;
      continue;
    }
    for (const key of keys) seen.add(key);
    const match = keys.map((key) => saved.get(key)).find(Boolean);
    if (match) {
      if (mode === "skip" || match.source !== "local" || match.kind !== item.kind || merged.has(match.id)) plan.duplicates++;
      else {
        merged.add(match.id);
        plan.merge.push({ id: match.id, item });
      }
      continue;
    }
    if (room <= 0) {
      plan.overLimit++;
      continue;
    }
    room--;
    plan.create.push(item);
  }
  return plan;
}

/** A merge: the file's non-empty fields replace the saved ones, its sites
 * are added (up to the limit) unless `keepSites` (an item a bot is allowed
 * to use: a file never widens where its values may be filled), the name
 * stays. As the vault's update takes
 * it (a field left out keeps its value). */
export function mergePatch(current: { domains: readonly string[] }, item: VaultTransferItem, options: { keepSites?: boolean } = {}): Record<string, unknown> {
  const domains = [...current.domains];
  if (!options.keepSites) for (const domain of item.domains) if (!domains.includes(domain) && domains.length < MAX_VAULT_DOMAINS) domains.push(domain);
  return {
    domains,
    ...(item.username ? { username: item.username } : {}),
    ...(item.password ? { password: item.password } : {}),
    ...(item.totpSeed ? { totpSeed: item.totpSeed } : {}),
    ...(item.apiKey ? { apiKey: item.apiKey } : {}),
    ...(item.notes ? { notes: item.notes } : {}),
  };
}

// ── export ─────────────────────────────────────────────────────────────

export interface VaultExportResult {
  /** The file's text. */
  text: string;
  mime: string;
  extension: "csv" | "json";
  /** Items written. */
  count: number;
  /** Items this format cannot hold (Chrome CSV: notes and API keys). */
  left: number;
  /** One-time code seeds this format cannot hold (Chrome CSV). */
  totpLeft: number;
}

/** The export file of these items. Chrome CSV has logins only, one URL per
 * row (the first site; the others are lost) and no one-time code. */
export function exportVaultItems(items: readonly VaultTransferItem[], format: VaultExportFormat): VaultExportResult {
  if (format === "chrome-csv") {
    const logins = items.filter((item) => item.kind === "login");
    const rows = logins.map((item) => [inertCell(item.name), item.domains[0] ? urlFromSite(item.domains[0]) : "", item.username, item.password, inertCell(item.notes)]);
    return {
      text: toCsv([["name", "url", "username", "password", "note"], ...rows]),
      mime: "text/csv;charset=utf-8",
      extension: "csv",
      count: logins.length,
      left: items.length - logins.length,
      totpLeft: logins.filter((item) => item.totpSeed).length,
    };
  }
  if (format === "bitwarden-csv") {
    const rows = items.map((item) => [
      "",
      "",
      item.kind === "note" ? "note" : "login",
      inertCell(item.name),
      inertCell(item.notes),
      item.kind === "apiKey" ? "sagax_kind: apiKey" : "",
      "",
      item.domains.map(urlFromSite).join(","),
      item.kind === "login" ? item.username : "",
      item.kind === "login" ? item.password : item.kind === "apiKey" ? item.apiKey : "",
      item.kind === "login" ? item.totpSeed : "",
    ]);
    return {
      text: toCsv([["folder", "favorite", "type", "name", "notes", "fields", "reprompt", "login_uri", "login_username", "login_password", "login_totp"], ...rows]),
      mime: "text/csv;charset=utf-8",
      extension: "csv",
      count: items.length,
      left: 0,
      totpLeft: 0,
    };
  }
  const document = {
    encrypted: false,
    folders: [],
    items: items.map((item) => item.kind === "note"
      ? { type: 2, name: item.name, notes: item.notes ?? null, favorite: false, secureNote: { type: 0 } }
      : {
        type: 1,
        name: item.name,
        notes: item.notes ?? null,
        favorite: false,
        ...(item.kind === "apiKey" ? { fields: [{ name: "sagax_kind", value: "apiKey", type: 0 }] } : {}),
        login: {
          username: item.kind === "login" ? item.username ?? null : null,
          password: item.kind === "login" ? item.password ?? null : item.apiKey ?? null,
          totp: item.kind === "login" ? item.totpSeed ?? null : null,
          uris: item.domains.map((domain) => ({ match: null, uri: urlFromSite(domain) })),
        },
      }),
  };
  return { text: `${JSON.stringify(document, null, 2)}\n`, mime: "application/json", extension: "json", count: items.length, left: 0, totpLeft: 0 };
}

export function isVaultExportFormat(value: unknown): value is VaultExportFormat {
  return typeof value === "string" && (VAULT_EXPORT_FORMATS as readonly string[]).includes(value);
}

export function isVaultImportFormat(value: unknown): value is VaultImportFormat {
  return typeof value === "string" && (VAULT_IMPORT_FORMATS as readonly string[]).includes(value);
}

export function isVaultDuplicateMode(value: unknown): value is VaultDuplicateMode {
  return typeof value === "string" && (VAULT_DUPLICATE_MODES as readonly string[]).includes(value);
}
