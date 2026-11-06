// Per-person Grok bridge link keys (#2193). Sealed with the vault key
// (AES-256-GCM, AAD `sagax grok-bridge secrets v1`), file mode 0600, kept out
// of backups and bot exports. Write only from the API: answers never include
// the key. Never in a log, a prompt, an audit row or an answer.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import type { VaultKeySource } from "../vault/vault-key-source.ts";
import { isBridgeLinkKey } from "../../shared/grok-bridge.ts";

export const GROK_BRIDGE_SECRETS_FILE = "grok-bridge-secrets.enc";
const AAD = Buffer.from("sagax grok-bridge secrets v1");

type Document = { version: 1; keys: Record<string, string> };

const slot = (person: string) => createHash("sha256").update(`grok-bridge\u0000${person.trim().toLowerCase()}`).digest("hex").slice(0, 32);

export class GrokBridgeSecrets {
  private readonly file: string;
  private readonly keySource: () => VaultKeySource;
  private cached: Document | null = null;

  constructor(dataDir: string, keySource: () => VaultKeySource) {
    this.file = join(dataDir, GROK_BRIDGE_SECRETS_FILE);
    this.keySource = keySource;
  }

  private key(): Buffer {
    const source = this.keySource();
    if (source.kind === "unavailable") throw new Error("The credential store is unavailable on this server.");
    return source.key;
  }

  private read(): Document {
    if (this.cached) return this.cached;
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("The Grok bridge secrets could not be read.");
      this.cached = { version: 1, keys: {} };
      return this.cached;
    }
    try {
      const [iv, tag, body] = raw.split(".");
      if (!iv || !tag || !body) throw new Error("format");
      const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(iv, "base64"));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      decipher.setAAD(AAD);
      const parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8")) as Document;
      if (parsed.version !== 1 || !parsed.keys || typeof parsed.keys !== "object") throw new Error("schema");
      this.cached = parsed;
      return parsed;
    } catch {
      throw new Error("The Grok bridge secrets could not be read.");
    }
  }

  private write(document: Document): void {
    if (!Object.keys(document.keys).length) {
      rmSync(this.file, { force: true });
      this.cached = document;
      return;
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAAD(AAD);
    const body = Buffer.concat([cipher.update(JSON.stringify(document), "utf8"), cipher.final()]);
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileAtomic(this.file, `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${body.toString("base64")}`, { mode: 0o600 });
    this.cached = document;
  }

  get(person: string): string | undefined {
    try {
      return this.read().keys[slot(person)];
    } catch {
      return undefined;
    }
  }

  /** Saves the key; undefined removes it. */
  set(person: string, key: string | undefined): void {
    if (key !== undefined && !isBridgeLinkKey(key)) {
      throw Object.assign(new Error("The link key must be at least 16 characters."), { status: 400 });
    }
    const document = structuredClone(this.read());
    if (key) document.keys[slot(person)] = key;
    else delete document.keys[slot(person)];
    this.write(document);
  }

  has(person: string): boolean {
    return Boolean(this.get(person));
  }
}
