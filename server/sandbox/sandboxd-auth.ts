// Request signing between the Sagax server and the sandbox provisioner
// (server/sandboxd.ts). The shared key never travels: each request carries an
// HMAC over its method, path, timestamp, nonce and body digest, valid for a
// short window and accepted once. The key lives in a file only the two
// containers can read (the provisioner writes it, mode 0440).
//
// Rotation without a cut: the key file may hold two keys, one per line.
// The first line signs; every line verifies. Both sides reread the file when
// it changes (sandboxdKeySource), so the operator moves one file at a time
// and no service restarts: the provisioner gets "old, new", then the signer
// gets "new, old", then both get "new" alone (docs/sandbox-kubernetes.md).
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const SANDBOXD_AUTH_HEADER = "x-sagax-sandboxd-auth";
export const SANDBOXD_AUTH_WINDOW_MS = 30_000;
const KEY_RE = /^[a-f0-9]{64}$/;
/** A rotation overlaps two keys; never more. */
export const SANDBOXD_MAX_KEYS = 2;
/** How often a key source looks at its file for a rotation. */
export const SANDBOXD_KEY_RECHECK_MS = 5_000;
/** Domain of a signature. The person-sandbox routes sign under the first;
 * the run routes (server/sandbox/sandboxd-runs.ts) under the second, with their own
 * key, so a signature made for one surface never verifies on the other. */
export const SANDBOXD_AUTH_CONTEXT = "sagax-sandboxd-v1";
export const SANDBOXD_RUNS_AUTH_CONTEXT = "sagax-sandboxd-runs-v1";

function bodyDigest(body: string | Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function mac(key: string, method: string, path: string, ts: number, nonce: string, body: string | Buffer, context: string): string {
  return createHmac("sha256", Buffer.from(key, "hex"))
    .update(`${context}\n${method.toUpperCase()}\n${path}\n${ts}\n${nonce}\n${bodyDigest(body)}`)
    .digest("hex");
}

export function signSandboxdRequest(key: string, method: string, path: string, body: string | Buffer, now = Date.now(), context: string = SANDBOXD_AUTH_CONTEXT): string {
  if (!KEY_RE.test(key)) throw new Error("invalid sandboxd key");
  const nonce = randomBytes(16).toString("hex");
  return `v1 ts=${now},nonce=${nonce},sig=${mac(key, method, path, now, nonce, body, context)}`;
}

/** The keys a verifier accepts: one key, a fixed list, or a source that
 * follows a key file through a rotation (sandboxdKeySource). */
export type SandboxdKeys = string | readonly string[] | (() => readonly string[]);

function checkedKeys(keys: readonly string[]): readonly string[] {
  if (keys.length === 0 || keys.length > SANDBOXD_MAX_KEYS || !keys.every((key) => KEY_RE.test(key))) {
    throw new Error("invalid sandboxd key");
  }
  return keys;
}

/** Verifies signatures and remembers nonces for the window, so a captured
 * request cannot be replayed. During a rotation a signature made with any
 * of the current keys verifies. */
export class SandboxdVerifier {
  private readonly seen = new Map<string, number>();
  private readonly keys: () => readonly string[];
  private readonly now: () => number;
  private readonly context: string;
  constructor(keys: SandboxdKeys, now: () => number = Date.now, context: string = SANDBOXD_AUTH_CONTEXT) {
    if (typeof keys === "function") {
      checkedKeys(keys());
      this.keys = () => checkedKeys(keys());
    } else {
      const fixed = checkedKeys(typeof keys === "string" ? [keys] : keys);
      this.keys = () => fixed;
    }
    this.now = now;
    this.context = context;
  }

  verify(header: string | string[] | undefined, method: string, path: string, body: string | Buffer): boolean {
    if (typeof header !== "string" || header.length > 300) return false;
    const match = /^v1 ts=(\d{1,16}),nonce=([a-f0-9]{32}),sig=([a-f0-9]{64})$/.exec(header);
    if (!match) return false;
    const ts = Number(match[1]);
    const nonce = match[2]!;
    const now = this.now();
    if (Math.abs(now - ts) > SANDBOXD_AUTH_WINDOW_MS) return false;
    const given = Buffer.from(match[3]!, "hex");
    let valid = false;
    // Every key is checked (no early exit), so timing does not tell which one matched.
    for (const key of this.keys()) {
      const expected = Buffer.from(mac(key, method, path, ts, nonce, body, this.context), "hex");
      if (expected.length === given.length && timingSafeEqual(expected, given)) valid = true;
    }
    if (!valid) return false;
    for (const [seenNonce, at] of this.seen) if (now - at > SANDBOXD_AUTH_WINDOW_MS * 2) this.seen.delete(seenNonce);
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, now);
    return true;
  }
}

/** Every key in a key file: one, or two during a rotation (first signs). */
export function readSandboxdKeys(file: string): string[] {
  const keys = readFileSync(file, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (keys.length === 0 || keys.length > SANDBOXD_MAX_KEYS || !keys.every((key) => KEY_RE.test(key)) || new Set(keys).size !== keys.length) {
    throw new Error(`${file} does not hold a sandboxd key`);
  }
  return keys;
}

/** Read the signing key (the first line); the provisioner creates the file on first start. */
export function readSandboxdKey(file: string): string {
  return readSandboxdKeys(file)[0]!;
}

/** Follows a key file through a rotation: rereads it when it changes (checked
 * at most every SANDBOXD_KEY_RECHECK_MS). A file that becomes unreadable or
 * malformed keeps the last good keys and says so once, so a bad edit never
 * locks the service out. */
export function sandboxdKeySource(file: string, now: () => number = Date.now): () => readonly string[] {
  let keys: readonly string[] = readSandboxdKeys(file);
  const stamp = (): string => {
    const info = statSync(file);
    return `${info.ino}:${info.size}:${info.mtimeMs}`;
  };
  let seen = stamp();
  let checkedAt = now();
  let warned = false;
  return () => {
    const at = now();
    if (at - checkedAt < SANDBOXD_KEY_RECHECK_MS) return keys;
    checkedAt = at;
    try {
      const current = stamp();
      if (current === seen) return keys;
      keys = readSandboxdKeys(file);
      seen = current;
      warned = false;
      console.log(`sandboxd: key file reloaded (${keys.length} key${keys.length === 1 ? "" : "s"})`);
    } catch (error) {
      if (!warned) console.error(`sandboxd: key file not reloaded, keeping the current keys: ${error instanceof Error ? error.message : String(error)}`);
      warned = true;
    }
    return keys;
  };
}

export function ensureSandboxdKey(file: string): string {
  if (existsSync(file)) return readSandboxdKey(file);
  mkdirSync(dirname(file), { recursive: true, mode: 0o750 });
  const key = randomBytes(32).toString("hex");
  writeFileSync(file, `${key}\n`, { mode: 0o440, flag: "wx" });
  chmodSync(file, 0o440);
  return key;
}
