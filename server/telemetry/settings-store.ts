// OTLP export settings (#2609): collector endpoint, headers, service name.
// Sealed with the vault key (AES-256-GCM, AAD `sagax telemetry v1`), mode
// 0600, `<data>/telemetry.enc`, like server/web-search/store.ts: header
// values often carry a collector's API key. The settings view only ever
// learns the header names. Export is off while no endpoint is saved.
// Cached in memory: the tracer reads target() on every span.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { TelemetrySettingsView } from "../../shared/telemetry.ts";
import { writeFileAtomic } from "../atomic.ts";
import { resolveVaultKey, type VaultKeySource } from "../mcp/mcp-oauth.ts";
import type { OtlpTarget } from "./otel.ts";

export const TELEMETRY_FILE = "telemetry.enc";
const AAD = Buffer.from("sagax telemetry v1");
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/;
const MAX_HEADERS = 20;

export class TelemetrySettingsError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** A collector URL as typed: http(s), no credentials in it, no fragment. */
export function normalizeEndpoint(raw: string): string {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new TelemetrySettingsError("Enter the collector address as a full URL, for example https://otel.example.com:4318.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TelemetrySettingsError("The collector address must start with http:// or https://.");
  if (url.username || url.password) throw new TelemetrySettingsError("Put credentials in a header, not in the address.");
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

export function normalizeHeaders(raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new TelemetrySettingsError("headers must be an object of name: value.");
  const out: Record<string, string> = {};
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_HEADERS) throw new TelemetrySettingsError(`At most ${MAX_HEADERS} headers.`);
  for (const [name, value] of entries) {
    if (!HEADER_NAME.test(name)) throw new TelemetrySettingsError(`"${name.slice(0, 40)}" is not a valid header name.`);
    if (typeof value !== "string" || !value || value.length > 4096 || /[\r\n\0]/.test(value)) throw new TelemetrySettingsError(`The value of ${name} must be one line of text.`);
    out[name] = value;
  }
  return out;
}

export interface TelemetrySettings {
  endpoint: string;
  headers: Record<string, string>;
  serviceName?: string;
}

export interface TelemetrySettingsStore {
  /** The OTLP target, header values included: for the exporter only. */
  target(): OtlpTarget | null;
  view(): TelemetrySettingsView;
  /** Save. `headers` undefined keeps the saved ones; a header whose value is
   * an empty string keeps its saved value (write-only fields). */
  save(input: { endpoint: string; headers?: Record<string, string>; serviceName?: string | null }): TelemetrySettingsView;
  remove(): void;
}

export function viewOfTelemetry(settings: TelemetrySettings | null): TelemetrySettingsView {
  return {
    endpoint: settings?.endpoint ?? null,
    headerNames: settings ? Object.keys(settings.headers).sort() : [],
    serviceName: settings?.serviceName ?? null,
    enabled: Boolean(settings?.endpoint),
  };
}

export function createTelemetrySettingsStore(dataDir: string, source?: () => VaultKeySource): TelemetrySettingsStore {
  const path = join(dataDir, TELEMETRY_FILE);
  const keySource = source ?? (() => resolveVaultKey(dataDir));
  const key = (): Buffer => {
    const got = keySource();
    if (got.kind !== "key") throw new TelemetrySettingsError("The telemetry settings could not be saved. Try again.", 503);
    return got.key;
  };
  const refuseSymlink = () => {
    try {
      if (lstatSync(path).isSymbolicLink()) throw new TelemetrySettingsError("The telemetry settings could not be saved. Try again.", 503);
    } catch (error) {
      if (error instanceof TelemetrySettingsError) throw error;
    }
  };
  const read = (): TelemetrySettings | null => {
    try {
      refuseSymlink();
      const envelope = JSON.parse(readFileSync(path, "utf8")) as { v?: unknown; iv?: string; tag?: string; data?: string };
      if (envelope.v !== 1 || !envelope.iv || !envelope.tag || !envelope.data) return null;
      const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(envelope.iv, "base64"));
      decipher.setAAD(AAD);
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const plain = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8")) as Partial<TelemetrySettings>;
      if (typeof plain.endpoint !== "string" || !plain.endpoint) return null;
      return {
        endpoint: plain.endpoint,
        headers: plain.headers && typeof plain.headers === "object" ? plain.headers : {},
        ...(typeof plain.serviceName === "string" && plain.serviceName ? { serviceName: plain.serviceName } : {}),
      };
    } catch {
      return null;
    }
  };
  let cached: TelemetrySettings | null | undefined;
  const current = () => {
    if (cached === undefined) cached = read();
    return cached;
  };
  return {
    target() {
      const settings = current();
      return settings ? { endpoint: settings.endpoint, headers: settings.headers, ...(settings.serviceName ? { serviceName: settings.serviceName } : {}) } : null;
    },
    view: () => viewOfTelemetry(current()),
    save(input) {
      const before = current();
      const endpoint = normalizeEndpoint(input.endpoint);
      let headers: Record<string, string>;
      if (input.headers === undefined) headers = { ...before?.headers };
      else {
        // An empty value keeps the saved one (write-only); a name left out goes.
        const kept = Object.fromEntries(Object.entries(input.headers).map(([name, value]) => [name, value === "" ? before?.headers[name] ?? "" : value]).filter(([, value]) => value !== ""));
        headers = normalizeHeaders(kept);
      }
      const serviceName = input.serviceName === undefined ? before?.serviceName : input.serviceName?.trim().slice(0, 100) || undefined;
      const settings: TelemetrySettings = { endpoint, headers, ...(serviceName ? { serviceName } : {}) };
      refuseSymlink();
      mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key(), iv);
      cipher.setAAD(AAD);
      const data = Buffer.concat([cipher.update(JSON.stringify(settings), "utf8"), cipher.final()]);
      writeFileAtomic(path, `${JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") })}\n`, { mode: 0o600 });
      cached = settings;
      return viewOfTelemetry(settings);
    },
    remove() {
      refuseSymlink();
      rmSync(path, { force: true });
      cached = null;
    },
  };
}
