// A plugin's configuration values (2026-10-21, parity with Grok Bot's
// "Plugin configuration"): the fields a Claude Code plugin declares under
// `userConfig` in .claude-plugin/plugin.json, filled per bot.
//
// - Fields: string, number, boolean, directory or file, each with a title,
//   an optional description, default and `required`. At most 30.
// - Values live beside the bot's plugin state (bot-plugins/<bot>/plugins/
//   config.json, 0600), by plugin key. They reach the plugin as Claude Code
//   does it: `${user_config.KEY}` in the plugin's skills, agents and commands
//   (.md files) is replaced by the value. Sagax keeps each file's original
//   under .claude-plugin/sagax-originals/ so a new value, a cleared one or an
//   update of the plugin starts again from the original text.
// - A field marked `sensitive` is a secret: it is never stored here and never
//   written into a file a bot reads. The form says to keep it in Settings >
//   Credentials, where the bot asks for it by name.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, type Dirent } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";

export const PLUGIN_CONFIG_MAX_FIELDS = 30;
const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const VALUE_MAX = 2_000;
const FILE_MAX_BYTES = 512 * 1024;
const MAX_FILES = 500;
const ORIGINALS = join(".claude-plugin", "sagax-originals");
const CONTENT_DIRS = ["skills", "agents", "commands"] as const;

export type PluginConfigValue = string | number | boolean;

export interface PluginConfigField {
  key: string;
  type: "string" | "number" | "boolean" | "directory" | "file";
  title: string;
  description?: string;
  sensitive: boolean;
  required: boolean;
  default?: PluginConfigValue;
}

const text = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim().slice(0, max) : undefined;

/** The fields a plugin folder declares (its plugin.json `userConfig`). */
export function readPluginConfigFields(pluginDir: string): PluginConfigField[] {
  let manifest: unknown;
  try {
    const file = join(pluginDir, ".claude-plugin", "plugin.json");
    if (statSync(file).size > 1_048_576) return [];
    manifest = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  return pluginConfigFields((manifest as { userConfig?: unknown } | null)?.userConfig);
}

/** The declared fields, cleaned: unknown types read as string. Pure. */
export function pluginConfigFields(declared: unknown): PluginConfigField[] {
  if (!declared || typeof declared !== "object" || Array.isArray(declared)) return [];
  const fields: PluginConfigField[] = [];
  for (const [key, raw] of Object.entries(declared as Record<string, unknown>)) {
    if (!KEY.test(key) || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const type = ["string", "number", "boolean", "directory", "file"].includes(entry.type as string) ? entry.type as PluginConfigField["type"] : "string";
    const fallback = entry.default;
    const field: PluginConfigField = {
      key, type,
      title: text(entry.title, 80) ?? key,
      ...(text(entry.description, 300) ? { description: text(entry.description, 300) } : {}),
      sensitive: entry.sensitive === true,
      required: entry.required === true,
    };
    if (!field.sensitive && (typeof fallback === "string" || typeof fallback === "number" || typeof fallback === "boolean")) {
      const checked = checkValue(field, fallback);
      if (checked.ok) field.default = checked.value;
    }
    fields.push(field);
    if (fields.length >= PLUGIN_CONFIG_MAX_FIELDS) break;
  }
  return fields;
}

function checkValue(field: PluginConfigField, value: unknown): { ok: true; value: PluginConfigValue } | { ok: false; error: string } {
  if (field.type === "boolean") return typeof value === "boolean" ? { ok: true, value } : { ok: false, error: `${field.title}: yes or no.` };
  if (field.type === "number") {
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
    return Number.isFinite(number) ? { ok: true, value: number } : { ok: false, error: `${field.title}: a number.` };
  }
  if (typeof value !== "string") return { ok: false, error: `${field.title}: text.` };
  const clean = value.replace(/[\r\n]+/g, " ").trim();
  if (clean.length > VALUE_MAX) return { ok: false, error: `${field.title}: at most ${VALUE_MAX} characters.` };
  return { ok: true, value: clean };
}

export type ConfigCheck = { ok: true; values: Record<string, PluginConfigValue> } | { ok: false; error: string; code: string };

/** The values a save may keep: declared, typed, never a secret; an empty
 * string clears a field. Pure. */
export function checkPluginConfig(fields: readonly PluginConfigField[], input: unknown): ConfigCheck {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "send { values: { field: value } }", code: "invalid_config" };
  const values: Record<string, PluginConfigValue> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const field = fields.find((candidate) => candidate.key === key);
    if (!field) return { ok: false, error: `This plugin declares no field "${key}".`, code: "unknown_field" };
    if (field.sensitive) {
      return { ok: false, error: `${field.title} is a secret: keep it in Settings > Credentials, never in the plugin's files.`, code: "sensitive_field" };
    }
    if (value === "" || value === null) continue;
    const checked = checkValue(field, value);
    if (!checked.ok) return { ok: false, error: checked.error, code: "invalid_value" };
    values[key] = checked.value;
  }
  const missing = fields.find((field) => field.required && !field.sensitive && values[field.key] === undefined && field.default === undefined);
  if (missing) return { ok: false, error: `${missing.title} is required.`, code: "required_field" };
  return { ok: true, values };
}

// ── the values file ────────────────────────────────────────────────────────

const valuesSchema = z.object({
  version: z.literal(1),
  plugins: z.record(z.string(), z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))),
}).strict();

export function readConfigValues(file: string): Record<string, Record<string, PluginConfigValue>> {
  try {
    const parsed = valuesSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data.plugins : {};
  } catch {
    return {};
  }
}

export function writeConfigValues(file: string, plugins: Record<string, Record<string, PluginConfigValue>>): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileAtomic(file, JSON.stringify({ version: 1, plugins }, null, 2), { mode: 0o600 });
}

// ── applying them to the plugin's files ───────────────────────────────────

const PLACEHOLDER = /\$\{user_config\.([A-Za-z_][A-Za-z0-9_]{0,63})\}/g;

/** The text with each `${user_config.KEY}` of a known, non-secret field
 * replaced by its value (or default); others stay as they are. Pure. */
export function substituteConfig(textIn: string, fields: readonly PluginConfigField[], values: Readonly<Record<string, PluginConfigValue>>): string {
  return textIn.replace(PLACEHOLDER, (whole, key: string) => {
    const field = fields.find((candidate) => candidate.key === key);
    if (!field || field.sensitive) return whole;
    const value = values[key] ?? field.default;
    return value === undefined ? whole : String(value);
  });
}

function markdownFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || out.length >= MAX_FILES) return;
    let entries: Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".md")) out.push(path);
    }
  };
  for (const name of CONTENT_DIRS) walk(join(root, name), 0);
  return out;
}

/** Write the values into the plugin's skills, agents and commands, from each
 * file's kept original. Returns how many files hold a value now. */
export function applyPluginConfig(pluginDir: string, fields: readonly PluginConfigField[], values: Readonly<Record<string, PluginConfigValue>>): number {
  let changed = 0;
  for (const file of markdownFiles(pluginDir)) {
    const rel = relative(pluginDir, file);
    if (rel.startsWith("..") || rel.split(sep).includes(".claude-plugin")) continue;
    const kept = join(pluginDir, ORIGINALS, rel);
    let original: string;
    try {
      if (existsSync(kept) && !lstatSync(kept).isSymbolicLink()) original = readFileSync(kept, "utf8");
      else {
        if (statSync(file).size > FILE_MAX_BYTES) continue;
        original = readFileSync(file, "utf8");
        if (!original.includes("${user_config.")) continue;
        mkdirSync(dirname(kept), { recursive: true });
        writeFileAtomic(kept, original);
      }
    } catch {
      continue;
    }
    const next = substituteConfig(original, fields, values);
    writeFileAtomic(file, next);
    if (next !== original) changed += 1;
  }
  return changed;
}

/** Forget the kept originals (the plugin folder is copied again). */
export function dropConfigOriginals(pluginDir: string): void {
  rmSync(join(pluginDir, ORIGINALS), { recursive: true, force: true });
}
