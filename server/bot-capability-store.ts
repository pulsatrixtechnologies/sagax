// Per-bot capability config (lot 5): one JSON file
// DATA_DIR/bot-capabilities/<botId>/capabilities.json. Absorbs
// bot-plugins/<bot>/state.json and plugins/config.json. Plugin source
// trees stay under bot-plugins/<bot>/plugins/ (content, not config).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import { capabilityPluginStateSchema, capabilityPluginValuesSchema, type CapabilityPluginState, type CapabilityPluginValues } from "./capability-plugin-state.ts";
import { BOT_CAPABILITIES_DIR, BOT_CAPABILITIES_FILE } from "../shared/capability-stores.ts";

const BOT_ID = /^[\w-]{1,80}$/;

export const botCapabilityDocumentSchema = z.object({
  version: z.literal(1),
  plugins: capabilityPluginStateSchema,
  pluginValues: capabilityPluginValuesSchema,
  assignedSkills: z.array(z.string().min(1).max(64)).max(200).default([]),
  migrated: z.array(z.string().max(80)).max(20).default([]),
}).strict();

export type BotCapabilityDocument = z.infer<typeof botCapabilityDocumentSchema>;

export function emptyBotCapabilityDocument(): BotCapabilityDocument {
  return {
    version: 1,
    plugins: { version: 2, plugins: {} },
    pluginValues: {},
    assignedSkills: [],
    migrated: [],
  };
}

export class BotCapabilityStore {
  private readonly dataDir: string;
  private readonly cache = new Map<string, BotCapabilityDocument>();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  root(botId: string): string {
    if (!BOT_ID.test(botId)) throw new Error("invalid bot id");
    return join(this.dataDir, BOT_CAPABILITIES_DIR, botId);
  }

  file(botId: string): string {
    return join(this.root(botId), BOT_CAPABILITIES_FILE);
  }

  /** True when the new store file exists for this bot. */
  present(botId: string): boolean {
    return existsSync(this.file(botId));
  }

  listBotIds(): string[] {
    const base = join(this.dataDir, BOT_CAPABILITIES_DIR);
    if (!existsSync(base)) return [];
    return readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && BOT_ID.test(entry.name) && existsSync(this.file(entry.name)))
      .map((entry) => entry.name)
      .sort();
  }

  read(botId: string): BotCapabilityDocument {
    const cached = this.cache.get(botId);
    if (cached) return structuredClone(cached);
    const path = this.file(botId);
    if (!existsSync(path)) {
      const empty = emptyBotCapabilityDocument();
      this.cache.set(botId, empty);
      return structuredClone(empty);
    }
    const document = botCapabilityDocumentSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    this.cache.set(botId, document);
    return structuredClone(document);
  }

  write(botId: string, document: BotCapabilityDocument): void {
    const parsed = botCapabilityDocumentSchema.parse(document);
    mkdirSync(this.root(botId), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file(botId), `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
    this.cache.set(botId, parsed);
  }

  plugins(botId: string): CapabilityPluginState {
    return this.read(botId).plugins;
  }

  setPlugins(botId: string, plugins: CapabilityPluginState): void {
    const document = this.read(botId);
    document.plugins = capabilityPluginStateSchema.parse(plugins);
    this.write(botId, document);
  }

  pluginValues(botId: string): CapabilityPluginValues {
    return this.read(botId).pluginValues;
  }

  setPluginValues(botId: string, values: CapabilityPluginValues): void {
    const document = this.read(botId);
    document.pluginValues = capabilityPluginValuesSchema.parse(values);
    this.write(botId, document);
  }

  assignedSkills(botId: string): string[] {
    return [...this.read(botId).assignedSkills];
  }

  setAssignedSkills(botId: string, skills: string[]): void {
    const document = this.read(botId);
    document.assignedSkills = [...skills];
    this.write(botId, document);
  }

  markMigrated(botId: string, sourceId: string): void {
    const document = this.read(botId);
    if (document.migrated.includes(sourceId)) return;
    document.migrated = [...document.migrated, sourceId];
    this.write(botId, document);
  }

  hasMigrated(botId: string, sourceId: string): boolean {
    return this.read(botId).migrated.includes(sourceId);
  }

  forget(botId: string): void {
    rmSync(this.root(botId), { recursive: true, force: true });
    this.cache.delete(botId);
  }

  clearCache(): void {
    this.cache.clear();
  }
}
