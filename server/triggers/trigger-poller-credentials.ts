// Credentials of typed-trigger pollers (server/triggers/trigger-pollers.ts): the IMAP
// or CalDAV password, or the private ICS link (the link alone opens the
// calendar, so it is a password too). Sealed like the other local secrets
// with the mcp-oauth vault key (AES-256-GCM, AAD `sagax trigger-poller-
// credentials v1`), file mode 0600, kept out of webhooks.json, workspace
// backups and bot exports. Write only from the API: the editor only learns
// whether one is set. Never in a log, a prompt, an audit row or an answer.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import type { VaultKeySource } from "../mcp/mcp-oauth.ts";

export const TRIGGER_POLLER_CREDENTIALS_FILE = "trigger-poller-credentials.enc";
const AAD = Buffer.from("sagax trigger-poller-credentials v1");
const ID = /^[\w-]{1,80}$/;

const entrySchema = z.object({
  password: z.string().min(1).max(1_024).optional(),
  url: z.string().min(1).max(2_000).optional(),
  setAt: z.number().finite().nonnegative(),
}).strict();
const documentSchema = z.object({ version: z.literal(1), triggers: z.record(z.string(), entrySchema) }).strict();

export type PollerCredential = Omit<z.infer<typeof entrySchema>, "setAt">;

/** What the API takes: either field, write only. An empty string clears it. */
export const pollerCredentialInputSchema = z.object({
  password: z.string().max(1_024).regex(/^[^\r\n\0]*$/, "The password cannot hold a line break").optional(),
  url: z.string().trim().max(2_000).optional(),
}).strict();

/** An ICS link as pasted: webcal:// is the same link over https. Only
 * https is accepted (the link is a credential; never in clear). */
export function normalizeIcsUrl(value: string): string {
  const text = value.trim().replace(/^webcals?:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw Object.assign(new Error("Paste the calendar's private ICS link (https://...)"), { status: 400 });
  }
  if (url.protocol !== "https:") throw Object.assign(new Error("The ICS link must start with https://"), { status: 400 });
  return url.toString();
}

export class TriggerPollerCredentials {
  private readonly file: string;
  private readonly keySource: () => VaultKeySource;
  private cached: z.infer<typeof documentSchema> | null = null;

  constructor(dataDir: string, keySource: () => VaultKeySource) {
    this.file = join(dataDir, TRIGGER_POLLER_CREDENTIALS_FILE);
    this.keySource = keySource;
  }

  private key(): Buffer {
    const source = this.keySource();
    if (source.kind === "unavailable") throw new Error("The credential store is unavailable on this server.");
    return source.key;
  }

  private read(): z.infer<typeof documentSchema> {
    if (this.cached) return this.cached;
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("The poller credentials could not be read.");
      this.cached = { version: 1, triggers: {} };
      return this.cached;
    }
    try {
      const [iv, tag, body] = raw.split(".");
      if (!iv || !tag || !body) throw new Error("format");
      const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(iv, "base64"));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      decipher.setAAD(AAD);
      const json = Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
      const parsed = documentSchema.safeParse(JSON.parse(json));
      if (!parsed.success) throw new Error("schema");
      this.cached = parsed.data;
      return this.cached;
    } catch {
      // Never the cause: a JSON or schema message could quote the content.
      throw new Error("The poller credentials could not be read.");
    }
  }

  private write(document: z.infer<typeof documentSchema>): void {
    if (Object.keys(document.triggers).length === 0) {
      rmSync(this.file, { force: true });
      this.cached = document;
      return;
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAAD(AAD);
    const body = Buffer.concat([cipher.update(JSON.stringify(document), "utf8"), cipher.final()]);
    mkdirSync(join(this.file, ".."), { recursive: true });
    writeFileAtomic(this.file, `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${body.toString("base64")}`, { mode: 0o600 });
    this.cached = document;
  }

  /** The stored credential, for the poller only. */
  get(id: string): PollerCredential | undefined {
    if (!ID.test(id)) return undefined;
    try {
      const entry = this.read().triggers[id];
      if (!entry) return undefined;
      return { ...(entry.password ? { password: entry.password } : {}), ...(entry.url ? { url: entry.url } : {}) };
    } catch {
      return undefined;
    }
  }

  has(id: string, field: "password" | "url"): boolean {
    return Boolean(this.get(id)?.[field]);
  }

  /** Merges the given fields; an empty string removes that field. */
  set(id: string, input: { password?: string; url?: string }, now: number = Date.now()): void {
    if (!ID.test(id)) throw new Error("Unknown trigger");
    const document = structuredClone(this.read());
    const entry: PollerCredential = { ...document.triggers[id] };
    delete (entry as { setAt?: number }).setAt;
    if (input.password !== undefined) {
      if (input.password) entry.password = input.password;
      else delete entry.password;
    }
    if (input.url !== undefined) {
      if (input.url) entry.url = normalizeIcsUrl(input.url);
      else delete entry.url;
    }
    if (entry.password || entry.url) document.triggers[id] = { ...entry, setAt: now };
    else delete document.triggers[id];
    this.write(document);
  }

  remove(id: string): void {
    try {
      const document = structuredClone(this.read());
      if (!document.triggers[id]) return;
      delete document.triggers[id];
      this.write(document);
    } catch {
      // unreadable: nothing to remove that could be read back
    }
  }
}
