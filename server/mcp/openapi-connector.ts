// The person's own API, from a spec they pasted. One file per person on an
// organization server, one file on a solo installation. Other members do
// not receive the tools and cannot read the headers. No admin switch.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, lstatSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import { addressClass } from "../browser/egress/policy.ts";
import { resolveVaultKey, type VaultKeySource } from "./mcp-oauth.ts";
import { parseOpenApiSpec, type OpenApiOperation } from "./openapi-tools.ts";

const AAD = Buffer.from("sagax openapi v1");
const FILE = "openapi.enc";
const LEGACY = "openapi.json";
const SEAL_UNAVAILABLE = "The API document could not be saved. Try again.";

const PRINCIPAL = /^[a-z0-9][a-z0-9_.:-]{0,80}$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/;

export type OpenApiScope = { organization: false } | { organization: true; principalId: string };

export interface OpenApiRecord {
  title: string;
  baseUrl: string;
  headers: Record<string, string>;
  operations: OpenApiOperation[];
}

export interface OpenApiView {
  title: string | null;
  baseUrl: string | null;
  headerKeys: string[];
  operations: Array<Pick<OpenApiOperation, "name" | "method" | "path" | "summary">>;
}

export function openApiScope(organization: boolean, principalId: string | null | undefined): OpenApiScope | null {
  if (!organization) return { organization: false };
  const id = principalId?.trim().toLowerCase() ?? "";
  return PRINCIPAL.test(id) && !id.includes("..") ? { organization: true, principalId: id } : null;
}

function fileFor(dataDir: string, scope: OpenApiScope, name = FILE): string {
  return scope.organization
    ? join(dataDir, "principals", scope.principalId, name)
    : join(dataDir, name);
}

function vaultKey(source: () => VaultKeySource): Buffer | null {
  const got = source();
  return got.kind === "key" ? got.key : null;
}

function sealRecord(record: OpenApiRecord, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(JSON.stringify({ version: 1, record }), "utf8"), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
}

function recordOf(value: unknown): OpenApiRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed = value as OpenApiRecord;
  if (typeof parsed.baseUrl !== "string" || !parsed.headers || typeof parsed.headers !== "object" || Array.isArray(parsed.headers) || !Array.isArray(parsed.operations)) return null;
  return parsed;
}

function openRecord(raw: string, key: Buffer): OpenApiRecord | null {
  const envelope = JSON.parse(raw) as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
  if (envelope.v !== 1 || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.data !== "string") return null;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(plain) as { version?: unknown; record?: unknown };
  return parsed.version === 1 ? recordOf(parsed.record) : null;
}

function refuseLink(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error("openapi store is a link");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function cleanHeaders(value: unknown): Record<string, string> | string {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Headers must be a name to value map.";
  const headers: Record<string, string> = {};
  for (const [name, header] of Object.entries(value)) {
    if (!HEADER_NAME.test(name)) return `Header “${name}” is not a valid header name.`;
    if (typeof header !== "string" || !header || header.length > 4_096 || /[\r\n]/.test(header)) return `Header “${name}” must be one line.`;
    headers[name] = header;
  }
  if (Object.keys(headers).length > 16) return "Use at most 16 headers.";
  return headers;
}

export class OpenApiStore {
  private readonly dataDir: string;
  private readonly keys: () => VaultKeySource;
  constructor(dataDir: string, keys?: () => VaultKeySource) {
    this.dataDir = dataDir;
    this.keys = keys ?? (() => resolveVaultKey(dataDir));
  }

  read(scope: OpenApiScope): OpenApiRecord | null {
    const path = fileFor(this.dataDir, scope);
    refuseLink(path);
    const key = vaultKey(this.keys);
    if (!key) return null;
    try {
      return openRecord(readFileSync(path, "utf8"), key);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
    }
    const legacy = fileFor(this.dataDir, scope, LEGACY);
    refuseLink(legacy);
    let plain: string;
    try { plain = readFileSync(legacy, "utf8"); } catch { return null; }
    let record: OpenApiRecord | null;
    try { record = recordOf(JSON.parse(plain) as unknown); } catch { return null; }
    if (!record) return null;
    mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
    writeFileAtomic(path, `${sealRecord(record, key)}\n`, { mode: 0o600 });
    rmSync(legacy, { force: true });
    return record;
  }

  view(scope: OpenApiScope): OpenApiView {
    const record = this.read(scope);
    if (!record) return { title: null, baseUrl: null, headerKeys: [], operations: [] };
    return {
      title: record.title,
      baseUrl: record.baseUrl,
      headerKeys: Object.keys(record.headers).sort(),
      operations: record.operations.map(({ name, method, path, summary }) => ({ name, method, path, summary })),
    };
  }

  /** Public operation list for the bot. Headers stay out. */
  publicOperations(scope: OpenApiScope): OpenApiOperation[] {
    return this.read(scope)?.operations ?? [];
  }

  save(scope: OpenApiScope, text: string, headers: unknown, baseUrl?: string): OpenApiView | string {
    const parsed = parseOpenApiSpec(text);
    if (!parsed.ok) return parsed.error;
    const cleaned = cleanHeaders(headers);
    if (typeof cleaned === "string") return cleaned;
    const url = (baseUrl?.trim() || parsed.baseUrl).trim();
    if (!/^https?:\/\//i.test(url)) return "The document needs a server address, or pass baseUrl.";
    const record: OpenApiRecord = { title: parsed.title, baseUrl: url, headers: cleaned, operations: parsed.operations };
    const key = vaultKey(this.keys);
    if (!key) return SEAL_UNAVAILABLE;
    const path = fileFor(this.dataDir, scope);
    refuseLink(path);
    mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
    writeFileAtomic(path, `${sealRecord(record, key)}\n`, { mode: 0o600 });
    rmSync(fileFor(this.dataDir, scope, LEGACY), { force: true });
    return this.view(scope);
  }

  forget(scope: OpenApiScope): void {
    rmSync(fileFor(this.dataDir, scope), { force: true });
    rmSync(fileFor(this.dataDir, scope, LEGACY), { force: true });
  }
}

/** Why this call must not run, or null. On an organization server the
 * address has to be public. A solo installation may call its own machine. */
export function openApiUrlRefusal(url: string, addresses: readonly string[], organization: boolean): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return "The address is not a URL."; }
  if (parsed.username || parsed.password) return "The address cannot contain a password.";
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "The address must be http or https.";
  const host = parsed.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  const localName = host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal";
  const kinds = addresses.map((address) => addressClass(address));
  if (kinds.some((kind) => kind === "metadata" || kind === "link-local" || kind === "reserved")) return "This address is not one Sagax will call.";
  if (organization && (localName || addresses.length === 0 || kinds.some((kind) => kind !== "public"))) {
    return "On an organization server this API must be on the public internet.";
  }
  return null;
}

export interface OpenApiCall {
  operation: OpenApiOperation;
  baseUrl: string;
  headers: Record<string, string>;
  args: Record<string, unknown>;
}

export function buildOpenApiRequest(call: OpenApiCall): { url: string; method: string; headers: Record<string, string>; body?: string } | string {
  let path = call.operation.path;
  const query = new URLSearchParams();
  for (const param of call.operation.params) {
    const value = call.args[param.name];
    if (value === undefined || value === null || value === "") {
      if (param.required) return `${param.name} is required.`;
      continue;
    }
    const text = String(value);
    if (/[\r\n]/.test(text)) return `${param.name} must be one line.`;
    if (param.in === "path") path = path.replaceAll(`{${param.name}}`, encodeURIComponent(text));
    else query.set(param.name, text);
  }
  if (path.includes("{")) return "A path value is missing.";
  const base = new URL(call.baseUrl);
  const prefix = base.pathname.replace(/\/$/, "");
  const queryText = query.toString();
  const url = `${base.origin}${prefix}${path.startsWith("/") ? path : `/${path}`}${queryText ? `?${queryText}` : ""}`;
  const headers: Record<string, string> = { ...call.headers, accept: call.headers.accept ?? call.headers.Accept ?? "application/json" };
  let body: string | undefined;
  if (call.operation.body && call.args.body !== undefined) {
    body = JSON.stringify(call.args.body);
    headers["content-type"] = headers["content-type"] ?? "application/json";
  }
  return { url, method: call.operation.method.toUpperCase(), headers, ...(body !== undefined ? { body } : {}) };
}
