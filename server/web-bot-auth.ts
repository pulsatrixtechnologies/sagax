// A signed header on the bot's own browser visits (HTTP Message Signatures,
// the ed25519 subset). A site that wants to can check that the visit came
// from this person's bot. It is not a login, not a session, and not a
// credential: Sagax never accepts the header as either, and the header is
// never Authorization or Cookie.
//
// On unless this person turns it off. One key per person on an organization
// server, one key for a solo installation. The private key stays in a 0600
// file. The public key travels in the Signature-Agent header, so a site can
// verify without calling back.
import { createCipheriv, createDecipheriv, generateKeyPairSync, randomBytes, sign, verify, createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { resolveVaultKey, type VaultKeySource } from "./mcp/mcp-oauth.ts";

const AAD = Buffer.from("sagax web-bot-auth v1");

const COMPONENT = "signature-agent";
const LABEL = "sig1";
const TTL_SECONDS = 600;
const PRINCIPAL = /^[a-z0-9][a-z0-9_.:-]{0,80}$/;

export type WebBotAuthScope = { organization: false } | { organization: true; principalId: string };

export interface WebBotAuthView {
  enabled: boolean;
  keyId: string;
  /** Public directory a site can store. No private key. */
  directory: { keys: WebBotAuthJwk[] };
}

export interface WebBotAuthJwk {
  kty: "OKP";
  crv: "Ed25519";
  kid: string;
  x: string;
}

export interface VisitTarget {
  /** Host, with the port only when it is not the default for the scheme. */
  authority: string;
  /** Path only. A signature for one path is not a signature for another. */
  path: string;
}

export interface SignedBrowserVisit {
  headers: Record<string, string>;
  directory: { keys: WebBotAuthJwk[] };
  authority: string;
  path: string;
  expiresAtMs: number;
}

/** The host and path a navigation signature has to cover. Null when the
 * address is not an http(s) page, so nothing unbound is signed. */
export function visitTarget(url: string): VisitTarget | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  const authority = parsed.host;
  const path = parsed.pathname || "/";
  if (!authority || /[\r\n]/.test(authority) || /[\r\n]/.test(path)) return null;
  return { authority, path };
}

/** Headers already on this session still name this host and this path, and
 * have not expired. A different path is a different signature. */
export function signatureStillCovers(cached: { authority: string; path: string; expiresAtMs: number } | undefined, target: VisitTarget, nowMs: number): boolean {
  return Boolean(cached && cached.authority === target.authority && cached.path === target.path && cached.expiresAtMs > nowMs + 5_000);
}

const owners = new Map<string, string>();

/** Which person this browser session belongs to. An organization server
 * signs with that person's key. A solo installation ignores this. */
export function noteBrowserOwner(session: string, principalId: string | null): void {
  if (principalId && PRINCIPAL.test(principalId)) owners.set(session, principalId);
  else owners.delete(session);
}

export function browserOwner(session: string): string | null {
  return owners.get(session) ?? null;
}

export function webBotAuthScope(organization: boolean, principalId: string | null | undefined): WebBotAuthScope | null {
  if (!organization) return { organization: false };
  const id = principalId?.trim().toLowerCase() ?? "";
  return PRINCIPAL.test(id) && !id.includes("..") ? { organization: true, principalId: id } : null;
}

function scopeDir(dataDir: string, scope: WebBotAuthScope): string {
  return scope.organization ? join(dataDir, "principals", scope.principalId) : dataDir;
}

function refuseSymlink(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error("web bot auth store is a link");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

interface KeyMaterial { privateKey: KeyObject; jwk: WebBotAuthJwk }

function materialFromPkcs8(pkcs8: string): KeyMaterial | null {
  try {
    const privateKey = createPrivateKey({ key: Buffer.from(pkcs8, "base64"), format: "der", type: "pkcs8" });
    const jwk = createPublicKey(privateKey).export({ format: "jwk" }) as { x?: string };
    if (typeof jwk.x !== "string" || !jwk.x) return null;
    return { privateKey, jwk: { kty: "OKP", crv: "Ed25519", kid: jwk.x, x: jwk.x } };
  } catch {
    return null;
  }
}

function sealPkcs8(pkcs8: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(JSON.stringify({ version: 1, pkcs8 }), "utf8"), cipher.final()]);
  return JSON.stringify({ v: 2, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
}

function openPkcs8(raw: string, key: Buffer): string | null {
  const envelope = JSON.parse(raw) as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
  if (envelope.v !== 2 || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.data !== "string") return null;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plain = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8")) as { version?: unknown; pkcs8?: unknown };
  return plain.version === 1 && typeof plain.pkcs8 === "string" ? plain.pkcs8 : null;
}

function readKey(path: string, key: Buffer | null): { material: KeyMaterial; legacy: boolean } | null {
  refuseSymlink(path);
  let raw: string;
  try { raw = readFileSync(path, "utf8"); } catch { return null; }
  const parsed = JSON.parse(raw) as { v?: unknown; pkcs8?: unknown };
  if (parsed.v === 2) {
    if (!key) return null;
    const pkcs8 = openPkcs8(raw, key);
    const material = pkcs8 ? materialFromPkcs8(pkcs8) : null;
    return material ? { material, legacy: false } : null;
  }
  if (parsed.v !== 1 || typeof parsed.pkcs8 !== "string") return null;
  const material = materialFromPkcs8(parsed.pkcs8);
  return material ? { material, legacy: true } : null;
}

function writeKey(path: string, material: KeyMaterial, key: Buffer): void {
  const pkcs8 = Buffer.from(material.privateKey.export({ format: "der", type: "pkcs8" })).toString("base64");
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  writeFileAtomic(path, `${sealPkcs8(pkcs8, key)}\n`, { mode: 0o600 });
}

export class WebBotAuthStore {
  private readonly dataDir: string;
  private readonly keys: () => VaultKeySource;
  constructor(dataDir: string, keys?: () => VaultKeySource) {
    this.dataDir = dataDir;
    this.keys = keys ?? (() => resolveVaultKey(dataDir));
  }

  private vaultKey(): Buffer | null {
    const got = this.keys();
    return got.kind === "key" ? got.key : null;
  }

  private switchPath(scope: WebBotAuthScope): string {
    return join(scopeDir(this.dataDir, scope), "web-bot-auth.json");
  }

  private keyPath(scope: WebBotAuthScope): string {
    return join(scopeDir(this.dataDir, scope), "web-bot-auth-key.json");
  }

  /** Missing file means on. Only an explicit false turns it off. */
  enabled(scope: WebBotAuthScope): boolean {
    const path = this.switchPath(scope);
    refuseSymlink(path);
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { enabled?: unknown };
      return parsed.enabled !== false;
    } catch {
      return true;
    }
  }

  setEnabled(scope: WebBotAuthScope, enabled: boolean): void {
    const path = this.switchPath(scope);
    refuseSymlink(path);
    mkdirSync(scopeDir(this.dataDir, scope), { recursive: true, mode: 0o700 });
    writeFileAtomic(path, `${JSON.stringify({ v: 1, enabled })}\n`, { mode: 0o600 });
  }

  material(scope: WebBotAuthScope): KeyMaterial {
    const key = this.vaultKey();
    if (!key) throw new Error("The visit signature could not be prepared.");
    const path = this.keyPath(scope);
    const existing = readKey(path, key);
    if (existing) {
      if (existing.legacy) writeKey(path, existing.material, key);
      return existing.material;
    }
    const pair = generateKeyPairSync("ed25519");
    const jwk = pair.publicKey.export({ format: "jwk" }) as { x?: string };
    if (typeof jwk.x !== "string") throw new Error("ed25519 public key");
    const material = { privateKey: pair.privateKey, jwk: { kty: "OKP" as const, crv: "Ed25519" as const, kid: jwk.x, x: jwk.x } };
    writeKey(path, material, key);
    return material;
  }

  forget(scope: WebBotAuthScope): void {
    rmSync(this.keyPath(scope), { force: true });
    rmSync(this.switchPath(scope), { force: true });
  }

  view(scope: WebBotAuthScope): WebBotAuthView {
    const material = this.material(scope);
    return { enabled: this.enabled(scope), keyId: material.jwk.kid, directory: { keys: [material.jwk] } };
  }
}

/** Headers for one visit of one host and one path. Another host, or another
 * path, does not verify. They do not authorize an account. */
export function signBrowserVisit(material: KeyMaterial, nowMs: number, target: VisitTarget, ttlSeconds = TTL_SECONDS): SignedBrowserVisit {
  const created = Math.floor(nowMs / 1000);
  const expires = created + ttlSeconds;
  const agent = `data:application/json,${JSON.stringify(material.jwk)}`;
  const params = `("@authority" "@path" "${COMPONENT}");created=${created};expires=${expires};keyid="${material.jwk.kid}";alg="ed25519"`;
  const base = `"@authority": ${target.authority}\n"@path": ${target.path}\n"${COMPONENT}": ${agent}\n"@signature-params": ${params}\n`;
  const signature = sign(null, Buffer.from(base), material.privateKey).toString("base64");
  return {
    headers: {
      "Signature-Agent": agent,
      "Signature-Input": `${LABEL}=${params}`,
      Signature: `${LABEL}=:${signature}:`,
    },
    directory: { keys: [material.jwk] },
    authority: target.authority,
    path: target.path,
    expiresAtMs: expires * 1000,
  };
}

/** True when these headers were produced by the public key they carry.
 * A site can do the same check. Failure is not a login failure. */
export function verifyBrowserVisit(headers: Record<string, string>, nowMs: number, target: VisitTarget): boolean {
  const agent = headers["Signature-Agent"];
  const input = headers["Signature-Input"];
  const signature = headers.Signature;
  if (!agent || !input || !signature) return false;
  if (/[\r\n]/.test(target.authority) || /[\r\n]/.test(target.path)) return false;
  const match = /^sig1=\("@authority" "@path" "signature-agent"\);created=(\d+);expires=(\d+);keyid="([^"]+)";alg="ed25519"$/.exec(input);
  if (!match || !signature.startsWith("sig1=:") || !signature.endsWith(":")) return false;
  const created = Number(match[1]);
  const expires = Number(match[2]);
  const keyId = match[3]!;
  const now = Math.floor(nowMs / 1000);
  if (expires < now || created > now + 60) return false;
  let jwk: WebBotAuthJwk;
  try {
    const encoded = agent.startsWith("data:application/json,") ? agent.slice("data:application/json,".length) : "";
    jwk = JSON.parse(encoded) as WebBotAuthJwk;
  } catch {
    return false;
  }
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || jwk.x !== keyId || jwk.kid !== keyId) return false;
  const params = input.slice("sig1=".length);
  const base = `"@authority": ${target.authority}\n"@path": ${target.path}\n"${COMPONENT}": ${agent}\n"@signature-params": ${params}\n`;
  const bytes = Buffer.from(signature.slice("sig1=:".length, -1), "base64");
  try {
    const publicKey = createPublicKey({ key: jwk, format: "jwk" });
    return verify(null, Buffer.from(base), publicKey, bytes);
  } catch {
    return false;
  }
}
