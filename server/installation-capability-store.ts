// Installation-wide capability config (lot 5): one sealed file
// DATA_DIR/installation-capabilities.enc. Absorbs marketplaces/state.json,
// skills-library/index.json, org-flow-plugins/state.json,
// org-capabilities/state.json and config.json mcpServers. Content trees
// (repos, skill files, load copies) stay on disk. Sealed with the
// mcp-oauth vault key so MCP env/header secrets never sit in plaintext.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import type { VaultKeySource } from "./vault-key-source.ts";
import { INSTALLATION_CAPABILITIES_AAD, INSTALLATION_CAPABILITIES_FILE } from "../shared/capability-stores.ts";

const AAD = Buffer.from(INSTALLATION_CAPABILITIES_AAD);

export const installationCapabilityDocumentSchema = z.object({
  version: z.literal(1),
  marketplaces: z.object({
    version: z.literal(1),
    marketplaces: z.record(z.string(), z.unknown()),
    installed: z.record(z.string(), z.unknown()),
  }).default({ version: 1, marketplaces: {}, installed: {} }),
  mcpServers: z.record(z.string(), z.unknown()).default({}),
  skillsLibrary: z.record(z.string(), z.unknown()).default({}),
  orgFlow: z.unknown().optional(),
  orgCapabilities: z.unknown().optional(),
  migrated: z.array(z.string().max(80)).max(40).default([]),
}).strict();

export type InstallationCapabilityDocument = z.infer<typeof installationCapabilityDocumentSchema>;

export function emptyInstallationCapabilityDocument(): InstallationCapabilityDocument {
  return {
    version: 1,
    marketplaces: { version: 1, marketplaces: {}, installed: {} },
    mcpServers: {},
    skillsLibrary: {},
    migrated: [],
  };
}

export class InstallationCapabilityStoreError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status = 503) {
    super(message);
    this.name = "InstallationCapabilityStoreError";
    this.code = code;
    this.status = status;
  }
}

export class InstallationCapabilityStore {
  private readonly file: string;
  private readonly keySource: () => VaultKeySource;
  private cached: InstallationCapabilityDocument | null = null;
  private loaded = false;
  private unreadable: string | null = null;

  constructor(dataDir: string, keySource: () => VaultKeySource) {
    this.file = join(dataDir, INSTALLATION_CAPABILITIES_FILE);
    this.keySource = keySource;
  }

  present(): boolean {
    return existsSync(this.file);
  }

  read(): InstallationCapabilityDocument {
    if (this.loaded) {
      if (this.unreadable || !this.cached) {
        throw new InstallationCapabilityStoreError(this.unreadable ?? "The installation capabilities could not be read.", "store_unavailable");
      }
      return structuredClone(this.cached);
    }
    const source = this.keySource();
    if (source.kind === "unavailable") {
      throw new InstallationCapabilityStoreError(source.reason, "store_unavailable");
    }
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.cached = emptyInstallationCapabilityDocument();
        this.loaded = true;
        this.unreadable = null;
        return structuredClone(this.cached);
      }
      this.loaded = true;
      this.unreadable = "The installation capabilities could not be read.";
      throw new InstallationCapabilityStoreError(this.unreadable, "store_unavailable");
    }
    try {
      const envelope = JSON.parse(raw) as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
      if (envelope.v !== 1 || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.data !== "string") {
        throw new Error("format");
      }
      const decipher = createDecipheriv("aes-256-gcm", source.key, Buffer.from(envelope.iv, "base64"));
      decipher.setAAD(AAD);
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
      this.cached = installationCapabilityDocumentSchema.parse(JSON.parse(plain));
      this.loaded = true;
      this.unreadable = null;
      return structuredClone(this.cached);
    } catch {
      this.loaded = true;
      this.unreadable = "The installation capabilities could not be decrypted on this launch.";
      throw new InstallationCapabilityStoreError(this.unreadable, "store_unavailable");
    }
  }

  write(document: InstallationCapabilityDocument): void {
    if (this.unreadable) throw new InstallationCapabilityStoreError(this.unreadable, "store_unavailable");
    const parsed = installationCapabilityDocumentSchema.parse(document);
    const source = this.keySource();
    if (source.kind === "unavailable") throw new InstallationCapabilityStoreError(source.reason, "store_unavailable");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", source.key, iv);
    cipher.setAAD(AAD);
    const data = Buffer.concat([cipher.update(JSON.stringify(parsed), "utf8"), cipher.final()]);
    mkdirSync(join(this.file, ".."), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file, JSON.stringify({
      v: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    }), { mode: 0o600 });
    this.cached = parsed;
    this.loaded = true;
  }

  hasMigrated(sourceId: string): boolean {
    return this.read().migrated.includes(sourceId);
  }

  markMigrated(sourceId: string): void {
    const document = this.read();
    if (document.migrated.includes(sourceId)) return;
    document.migrated = [...document.migrated, sourceId];
    this.write(document);
  }

  /** Drop the cache so the next read hits disk (tests / after external write). */
  clearCache(): void {
    this.cached = null;
    this.loaded = false;
    this.unreadable = null;
  }

  /** Test helper: remove the sealed file. */
  discard(): void {
    rmSync(this.file, { force: true });
    this.clearCache();
  }
}
