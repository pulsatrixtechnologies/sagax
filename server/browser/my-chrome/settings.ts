// My Chrome settings: off by default, the allowed sites, the stop switch, and
// where the person's Chrome listens. One file in the data folder
// (`my-chrome.json`, mode 0600), changed only by the person through
// server/routes/my-chrome.ts. A file that does not read is treated as "off":
// never as permission.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "../../atomic.ts";
import { normalizeMyChromeSite } from "./sites.ts";

export const MY_CHROME_FILE = "my-chrome.json";
export const MAX_MY_CHROME_SITES = 50;

export interface MyChromeSite {
  /** One exact origin (sites.ts normalizeMyChromeSite). */
  origin: string;
  /** Epoch ms the person allowed it. */
  addedAt: number;
}

export interface MyChromeSettings {
  /** The person turned My Chrome on. Off by default. */
  enabled: boolean;
  sites: MyChromeSite[];
  /** The person pressed Stop: nothing drives their Chrome until they resume. */
  stopped: boolean;
  /** Where their Chrome listens, when it is not found by itself: a port, or a
   * loopback ws:// or http:// address. Empty: Chrome's DevToolsActivePort. */
  chromeAddress: string;
  /** An organization server never offers My Chrome unless its file says so by
   * hand: no route sets this. */
  allowOnOrganizationServer: boolean;
}

export const DEFAULT_MY_CHROME_SETTINGS: MyChromeSettings = Object.freeze({
  enabled: false, sites: [], stopped: false, chromeAddress: "", allowOnOrganizationServer: false,
}) as MyChromeSettings;

/** A port, or a ws/http address on this computer's loopback. Null otherwise:
 * My Chrome only ever reaches a Chrome on this computer. */
export function normalizeChromeAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value === "") return "";
  if (/^\d{1,5}$/.test(value)) {
    const port = Number(value);
    return port >= 1 && port <= 65_535 ? String(port) : null;
  }
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (!["ws:", "http:"].includes(url.protocol) || url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) return null;
  return url.toString();
}

function parse(value: unknown): MyChromeSettings {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const sites: MyChromeSite[] = [];
  for (const entry of Array.isArray(raw.sites) ? raw.sites : []) {
    const origin = normalizeMyChromeSite((entry as { origin?: unknown } | null)?.origin);
    if (!origin || seen.has(origin) || sites.length >= MAX_MY_CHROME_SITES) continue;
    seen.add(origin);
    const addedAt = Number((entry as { addedAt?: unknown }).addedAt);
    sites.push({ origin, addedAt: Number.isFinite(addedAt) && addedAt > 0 ? addedAt : 0 });
  }
  return {
    enabled: raw.enabled === true,
    sites,
    stopped: raw.stopped === true,
    chromeAddress: normalizeChromeAddress(raw.chromeAddress) ?? "",
    allowOnOrganizationServer: raw.allowOnOrganizationServer === true,
  };
}

export class MyChromeSettingsStore {
  private readonly path: string;
  private current: MyChromeSettings;

  constructor(dataDir: string) {
    this.path = join(dataDir, MY_CHROME_FILE);
    this.current = this.read();
  }

  private read(): MyChromeSettings {
    if (!existsSync(this.path)) return { ...DEFAULT_MY_CHROME_SETTINGS, sites: [] };
    try { return parse(JSON.parse(readFileSync(this.path, "utf8"))); }
    catch { return { ...DEFAULT_MY_CHROME_SETTINGS, sites: [] }; }
  }

  get(): MyChromeSettings {
    return { ...this.current, sites: this.current.sites.map((site) => ({ ...site })) };
  }

  /** Apply a change and save it. Throws on a site or address that is not one. */
  update(change: (draft: MyChromeSettings) => void): MyChromeSettings {
    const draft = this.get();
    change(draft);
    const next = parse(draft);
    writeFileAtomic(this.path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    this.current = next;
    return this.get();
  }

  allowSite(raw: unknown, now = Date.now()): MyChromeSettings {
    const origin = normalizeMyChromeSite(raw);
    if (!origin) throw new MyChromeSettingsError("Enter one site such as https://example.com (http only for localhost with a port).");
    return this.update((draft) => {
      if (draft.sites.some((site) => site.origin === origin)) return;
      if (draft.sites.length >= MAX_MY_CHROME_SITES) throw new MyChromeSettingsError(`At most ${MAX_MY_CHROME_SITES} sites.`);
      draft.sites.push({ origin, addedAt: now });
    });
  }

  revokeSite(raw: unknown): MyChromeSettings {
    const origin = normalizeMyChromeSite(raw);
    return this.update((draft) => { draft.sites = draft.sites.filter((site) => site.origin !== origin); });
  }

  setChromeAddress(raw: unknown): MyChromeSettings {
    const address = normalizeChromeAddress(raw);
    if (address === null) throw new MyChromeSettingsError("Chrome's address must be a port or a ws:// or http:// address on this computer.");
    return this.update((draft) => { draft.chromeAddress = address; });
  }
}

export class MyChromeSettingsError extends Error {}
