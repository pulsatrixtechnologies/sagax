// Per-person API keys for cloud agent providers. Encrypted at rest; never
// logged or returned on the wire except configured: true and last4.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import type { VaultKeySource } from "../mcp-oauth.ts";
import { principalDir } from "../person-connections.ts";
import { CLOUD_AGENT_KEY_PROVIDERS, type CloudAgentKeyProviderId, type CloudAgentProviderId } from "../../shared/cloud-agents.ts";

const AAD = Buffer.from("sagax cloud-agent-credentials v1");
const FILE = "cloud-agent-credentials.enc";
const PRINCIPAL_ID = /^[A-Za-z0-9_.:-]{1,120}$/;

// A partial record: a person saves one provider at a time. zod 4's
// z.record over an enum requires every key, so a file holding only cursor
// and claude (written before codex existed, or with codex never saved)
// failed to parse and Settings showed the raw issue list (2026-10-14).
const documentSchema = z.object({
  version: z.literal(1),
  providers: z.partialRecord(
    // Perspicax takes the person's sign-in, never a stored key.
    z.enum(CLOUD_AGENT_KEY_PROVIDERS),
    z.object({
      token: z.string().min(1).max(16_384),
      addedAt: z.number(),
      label: z.string().max(120).optional(),
    }).strict(),
  ),
}).strict();

export interface CloudAgentCredentialListing {
  provider: CloudAgentKeyProviderId;
  configured: boolean;
  last4?: string;
  label?: string;
}

export class CloudAgentCredentialStore {
  private readonly cache = new Map<string, z.infer<typeof documentSchema>>();

  private readonly dataDir: string;
  private readonly keySource: () => VaultKeySource;

  constructor(dataDir: string, keySource: () => VaultKeySource) {
    this.dataDir = dataDir;
    this.keySource = keySource;
  }

  private key(): Buffer {
    const source = this.keySource();
    if (source.kind === "unavailable") throw new Error(source.reason);
    return source.key;
  }

  private read(principalId: string): z.infer<typeof documentSchema> {
    const cached = this.cache.get(principalId);
    if (cached) return cached;
    const path = join(principalDir(this.dataDir, principalId), FILE);
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      const empty: z.infer<typeof documentSchema> = {
        version: 1,
        providers: {} as z.infer<typeof documentSchema>["providers"],
      };
      this.cache.set(principalId, empty);
      return empty;
    }
    const [ivB64, tagB64, bodyB64] = raw.split(".");
    if (!ivB64 || !tagB64 || !bodyB64) throw new Error("corrupt cloud-agent credentials");
    const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    decipher.setAAD(AAD);
    const json = Buffer.concat([decipher.update(Buffer.from(bodyB64, "base64")), decipher.final()]).toString("utf8");
    const parsed = documentSchema.safeParse(JSON.parse(json));
    // Never the issue list: it names fields and reaches the person's screen.
    if (!parsed.success) throw new Error("The saved cloud agent keys could not be read.");
    const doc = parsed.data;
    this.cache.set(principalId, doc);
    return doc;
  }

  private write(principalId: string, doc: z.infer<typeof documentSchema>): void {
    if (!PRINCIPAL_ID.test(principalId)) throw new Error("invalid principal");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAAD(AAD);
    const body = Buffer.concat([cipher.update(JSON.stringify(doc), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const encoded = `${iv.toString("base64")}.${tag.toString("base64")}.${body.toString("base64")}`;
    const dir = principalDir(this.dataDir, principalId);
    mkdirSync(dir, { recursive: true });
    writeFileAtomic(join(dir, FILE), encoded, { mode: 0o600 });
    this.cache.set(principalId, doc);
  }

  list(principalId: string): CloudAgentCredentialListing[] {
    const doc = this.read(principalId);
    return CLOUD_AGENT_KEY_PROVIDERS.map((provider) => {
      const row = doc.providers[provider];
      if (!row) return { provider, configured: false };
      const last4 = row.token.length >= 4 ? row.token.slice(-4) : undefined;
      return { provider, configured: true, last4, ...(row.label ? { label: row.label } : {}) };
    });
  }

  token(principalId: string, provider: CloudAgentProviderId): string | null {
    if (provider === "perspicax") return null;
    return this.read(principalId).providers[provider]?.token ?? null;
  }

  set(principalId: string, provider: CloudAgentKeyProviderId, token: string, label?: string): void {
    const trimmed = token.trim();
    if (!trimmed) throw new Error("empty token");
    const doc = this.read(principalId);
    doc.providers[provider] = { token: trimmed, addedAt: Date.now(), ...(label?.trim() ? { label: label.trim() } : {}) };
    this.write(principalId, doc);
  }

  remove(principalId: string, provider: CloudAgentKeyProviderId): boolean {
    const doc = this.read(principalId);
    if (!doc.providers[provider]) return false;
    delete doc.providers[provider];
    this.write(principalId, doc);
    return true;
  }

  clearCache(principalId?: string): void {
    if (principalId) this.cache.delete(principalId);
    else this.cache.clear();
  }
}
