// Optional 1Password source for the credential vault: read-only, feature
// detected, off when absent. Two ways in, the first one found wins:
//
//   Connect   OP_CONNECT_HOST and OP_CONNECT_TOKEN in the server's
//             environment (a 1Password Connect server the operator runs)
//   CLI       the official `op` command on this computer, signed in through
//             the 1Password desktop app integration (biometric unlock) or a
//             service account (OP_SERVICE_ACCOUNT_TOKEN)
//
// Only a desktop or a solo server offers it: on an organization server the
// host's 1Password account is not any one person's to share. Items are
// listed for the picker (title, vault, sites); a picked item is saved in the
// vault as a reference, and its fields are read only at fill time, never
// cached, never listed, never logged. `op` runs with execFile and an argument array, never
// a shell, and only from a fixed install path (never from PATH): the file and
// its folder must not be writable by others, and on macOS it must carry
// AgileBits' code signature (team 2BUA8C4S2C). Its environment is a short
// allowlist: no Sagax key, no provider key ever reaches it.
import { execFile } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { dirname } from "node:path";

import { bindingUrl, normalizeVaultDomain, vaultDomainMatches, vaultSiteOf, type VaultFillField } from "../shared/credential-vault.ts";
import type { OnePasswordRef } from "./credential-vault.ts";

export type OnePasswordVia = "cli" | "connect";

export interface OnePasswordStatus {
  available: boolean;
  via?: OnePasswordVia;
  /** Why it is off, for Settings ("not installed", "not signed in"). */
  reason?: "absent" | "signed_out" | "organization" | "error";
}

export interface OnePasswordItemSummary {
  id: string;
  vaultId: string;
  vaultName: string;
  title: string;
  category: string;
  domains: string[];
}

export type ExecFileFn = (command: string, args: string[], options: { env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number }) => Promise<string>;
export type FetchFn = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const ID = /^[a-z0-9]{1,64}$/i;
const CLI_TIMEOUT_MS = 15_000;
const MAX_ITEMS = 1_000;

/** Where the official CLI installs, by platform. Nothing else is ever run. */
export const OP_INSTALL_PATHS: Partial<Record<NodeJS.Platform, readonly string[]>> = {
  darwin: ["/opt/homebrew/bin/op", "/usr/local/bin/op"],
  linux: ["/usr/bin/op", "/usr/local/bin/op"],
};
export const AGILEBITS_TEAM_ID = "2BUA8C4S2C";
export const OP_IDENTIFIER = "com.1password.op";
/** The designated requirement the binary must satisfy: Apple-issued
 * Developer ID chain, AgileBits' team, the CLI's own identifier. */
export const OP_REQUIREMENT = `=anchor apple generic and certificate leaf[subject.OU] = "${AGILEBITS_TEAM_ID}" and identifier "${OP_IDENTIFIER}"`;
const SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const ENV_ALLOWLIST = ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME"];

function owned(stats: { uid: number }): boolean {
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  return stats.uid === 0 || stats.uid === uid;
}

/** The real path of a file that may run: a regular file belonging to root
 * or to this user, not writable by group or others, and every folder above
 * it up to the root the same (a writable folder anywhere above lets someone
 * swap a folder in). Null otherwise, and always null on Windows: Node
 * reports synthetic mode bits there (0o666, or 0o444 when read-only) and a
 * uid of 0 for every file, so neither check would say anything about the
 * real owner or ACL. */
export function safeBinaryPath(path: string, platform: NodeJS.Platform = process.platform): string | null {
  if (platform === "win32") return null;
  try {
    const real = realpathSync(path);
    const file = statSync(real);
    if (!file.isFile() || (file.mode & 0o022) !== 0 || !owned(file)) return null;
    for (let folder = dirname(real); ; folder = dirname(folder)) {
      const stats = statSync(folder);
      if ((stats.mode & 0o022) !== 0 || !owned(stats)) return null;
      if (dirname(folder) === folder) break;
    }
    return real;
  } catch {
    return null;
  }
}

/** The first install path that passes safeBinaryPath and, on macOS, the
 * AgileBits code signature. Null disables the CLI. */
export async function locateOp(platform: NodeJS.Platform = process.platform): Promise<string | null> {
  for (const candidate of OP_INSTALL_PATHS[platform] ?? []) {
    const real = safeBinaryPath(candidate);
    if (!real) continue;
    if (platform !== "darwin") return real;
    const signed = await new Promise<boolean>((resolve) => {
      execFile("/usr/bin/codesign", ["--verify", "--strict", "-R", OP_REQUIREMENT, real], { timeout: 10_000 }, (error) => resolve(!error));
    });
    if (signed) return real;
  }
  return null;
}

const defaultExec: ExecFileFn = (command, args, options) => new Promise((resolve, reject) => {
  execFile(command, args, { ...options, windowsHide: true, shell: false }, (error, stdout) => {
    if (error) reject(new Error("1Password command failed"));
    else resolve(String(stdout));
  });
});

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function domainsOf(urls: unknown): string[] {
  const out: string[] = [];
  for (const entry of Array.isArray(urls) ? urls : []) {
    const href = record(entry)?.href;
    const domain = normalizeVaultDomain(href);
    if (domain && !out.includes(domain)) out.push(domain);
  }
  return out.slice(0, 10);
}

/** The value of one field of a full item, as `op item get --format json` or
 * Connect return it. TOTP: the current code the source computed. */
export function fieldValue(item: unknown, field: VaultFillField): string | null {
  const fields = Array.isArray(record(item)?.fields) ? record(item)!.fields as unknown[] : [];
  const rows = fields.map(record).filter((row): row is Record<string, unknown> => row !== null);
  const value = (row: Record<string, unknown> | undefined) => {
    if (!row) return null;
    const raw = field === "totp" ? (row.totp ?? null) : row.value;
    return typeof raw === "string" && raw ? raw : null;
  };
  switch (field) {
    case "username":
      return value(rows.find((row) => row.purpose === "USERNAME") ?? rows.find((row) => row.id === "username"));
    case "password":
      return value(rows.find((row) => row.purpose === "PASSWORD") ?? rows.find((row) => row.id === "password"));
    case "totp":
      return value(rows.find((row) => row.type === "OTP" || row.type === "otp"));
    case "apiKey":
      return value(rows.find((row) => row.id === "credential" || String(row.label ?? "").toLowerCase() === "credential"))
        ?? value(rows.find((row) => row.purpose === "PASSWORD"));
    default:
      return null;
  }
}

export class OnePassword {
  private readonly env: NodeJS.ProcessEnv;
  private readonly exec: ExecFileFn;
  private readonly fetch: FetchFn;
  private readonly organization: () => boolean;
  private readonly locate: () => Promise<string | null>;
  private cachedStatus: { at: number; status: OnePasswordStatus } | null = null;
  private siteListCache = new Map<string, { at: number; items: OnePasswordItemSummary[] }>();

  constructor(options: { env?: NodeJS.ProcessEnv; exec?: ExecFileFn; fetch?: FetchFn; organization: () => boolean; locate?: () => Promise<string | null> }) {
    this.env = options.env ?? process.env;
    this.exec = options.exec ?? defaultExec;
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init) as ReturnType<FetchFn>);
    this.organization = options.organization;
    this.locate = options.locate ?? (() => locateOp());
  }

  private connect(): { host: string; token: string } | null {
    const host = this.env.OP_CONNECT_HOST?.trim();
    const token = this.env.OP_CONNECT_TOKEN?.trim();
    if (!host || !token) return null;
    try {
      const url = new URL(host);
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      return { host: url.origin, token };
    } catch {
      return null;
    }
  }

  /** The CLI's environment: a short allowlist and a system PATH, plus the
   * service account and account choice when the operator set them. */
  private cliEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of ENV_ALLOWLIST) {
      const value = this.env[key];
      if (value !== undefined) env[key] = value;
    }
    env.PATH = SYSTEM_PATH;
    if (this.env.OP_SERVICE_ACCOUNT_TOKEN) env.OP_SERVICE_ACCOUNT_TOKEN = this.env.OP_SERVICE_ACCOUNT_TOKEN;
    if (this.env.OP_ACCOUNT) env.OP_ACCOUNT = this.env.OP_ACCOUNT;
    env.OP_CACHE = "false";
    env.OP_BIOMETRIC_UNLOCK_ENABLED = "true";
    return env;
  }

  /** Located and checked again before every run: a binary swapped after
   * the last check is never run on the strength of it. */
  private binary(): Promise<string | null> {
    return this.locate().catch(() => null);
  }

  private async op(args: string[]): Promise<unknown> {
    const binary = await this.binary();
    if (!binary) throw new Error("1Password CLI is not available");
    const out = await this.exec(binary, args, { env: this.cliEnv(), timeout: CLI_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
    return JSON.parse(out);
  }

  private async connectGet(path: string): Promise<unknown> {
    const connect = this.connect();
    if (!connect) throw new Error("1Password Connect is not configured");
    const response = await this.fetch(`${connect.host}${path}`, {
      headers: { Authorization: `Bearer ${connect.token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(CLI_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`1Password Connect answered ${response.status}`);
    return response.json();
  }

  /** Feature detection, cached for a minute. */
  async status(force = false): Promise<OnePasswordStatus> {
    if (this.organization()) return { available: false, reason: "organization" };
    if (!force && this.cachedStatus && Date.now() - this.cachedStatus.at < 60_000) return this.cachedStatus.status;
    let status: OnePasswordStatus;
    if (this.connect()) {
      try {
        await this.connectGet("/v1/vaults");
        status = { available: true, via: "connect" };
      } catch {
        status = { available: false, via: "connect", reason: "error" };
      }
    } else {
      try {
        const binary = await this.binary();
        if (!binary) throw new Error("absent");
        await this.exec(binary, ["--version"], { env: this.cliEnv(), timeout: 5_000, maxBuffer: 64 * 1024 });
        try {
          const accounts = await this.op(["account", "list", "--format=json"]);
          status = (Array.isArray(accounts) && accounts.length > 0) || this.env.OP_SERVICE_ACCOUNT_TOKEN
            ? { available: true, via: "cli" }
            : { available: false, via: "cli", reason: "signed_out" };
        } catch {
          status = { available: false, via: "cli", reason: "signed_out" };
        }
      } catch {
        status = { available: false, reason: "absent" };
      }
    }
    this.cachedStatus = { at: Date.now(), status };
    return status;
  }

  /** Logins and API credentials for the picker: names and sites only. */
  async listItems(): Promise<OnePasswordItemSummary[]> {
    const status = await this.status();
    if (!status.available || !status.via) throw new Error("1Password is not available");
    const out: OnePasswordItemSummary[] = [];
    if (status.via === "connect") {
      const vaults = await this.connectGet("/v1/vaults");
      for (const vault of (Array.isArray(vaults) ? vaults : []).map(record)) {
        if (!vault || typeof vault.id !== "string" || !ID.test(vault.id)) continue;
        const items = await this.connectGet(`/v1/vaults/${vault.id}/items`);
        for (const item of (Array.isArray(items) ? items : []).map(record)) {
          if (!item || typeof item.id !== "string" || !ID.test(item.id)) continue;
          if (!["LOGIN", "PASSWORD", "API_CREDENTIAL"].includes(String(item.category))) continue;
          out.push({ id: item.id, vaultId: vault.id, vaultName: String(vault.name ?? ""), title: String(item.title ?? "").slice(0, 120), category: String(item.category), domains: domainsOf(item.urls) });
          if (out.length >= MAX_ITEMS) return out;
        }
      }
      return out;
    }
    const items = await this.op(["item", "list", "--categories", "Login,Password,API Credential", "--format=json"]);
    for (const item of (Array.isArray(items) ? items : []).map(record)) {
      const vault = record(item?.vault);
      if (!item || typeof item.id !== "string" || !ID.test(item.id) || typeof vault?.id !== "string" || !ID.test(vault.id)) continue;
      out.push({ id: item.id, vaultId: vault.id, vaultName: String(vault.name ?? ""), title: String(item.title ?? "").slice(0, 120), category: String(item.category ?? ""), domains: domainsOf(item.urls) });
      if (out.length >= MAX_ITEMS) break;
    }
    return out;
  }

  /** 2026-10-21 (parité R10, ligne 82): the 1Password items a request card
   * offers for one site, the exact address first, then other addresses of
   * the same site. Names, vaults and sites only, never a value. */
  async itemsForSite(domain: string, principalId = "local"): Promise<OnePasswordItemSummary[]> {
    const wanted = normalizeVaultDomain(domain);
    if (!wanted) return [];
    // a card opened, on the computer or the phone, never makes 1Password
    // list again within 30 s (review of R10)
    // kept per person: one person's listing never answers another's card
    let cached = this.siteListCache.get(principalId);
    if (!cached || Date.now() - cached.at > 30_000) {
      cached = { at: Date.now(), items: await this.listItems() };
      if (this.siteListCache.size > 32) this.siteListCache.clear();
      this.siteListCache.set(principalId, cached);
    }
    const items = cached.items.filter((item) => item.domains.length > 0);
    const direct = items.filter((item) => vaultDomainMatches(item.domains, bindingUrl(wanted)));
    const site = vaultSiteOf(wanted);
    const related = site ? items.filter((item) => !direct.includes(item) && item.domains.some((entry) => vaultSiteOf(entry) === site)) : [];
    return [...direct, ...related].slice(0, 20);
  }

  /** One field at fill time. Never cached; null when the item has none. */
  async readField(ref: OnePasswordRef, field: VaultFillField): Promise<string | null> {
    if (!ID.test(ref.itemId) || !ID.test(ref.vaultId)) return null;
    const status = await this.status();
    if (!status.available || status.via !== ref.via) throw new Error("1Password is not available");
    const item = ref.via === "connect"
      ? await this.connectGet(`/v1/vaults/${ref.vaultId}/items/${ref.itemId}`)
      : await this.op(["item", "get", ref.itemId, "--vault", ref.vaultId, "--reveal", "--format=json"]);
    return fieldValue(item, field);
  }
}
