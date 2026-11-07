/** A Claude Code plugin's agents as one Sagax team (I1, 2026-11-07).
 *
 * Each `agents/<name>.md` of the plugin becomes one bot of a single team:
 * its frontmatter `name` and `description` come across as they are, the body
 * becomes the bot's soul, and `model` is kept as the model the bot asks for
 * (resolved against the server's engines by the caller, see
 * server/plugins/plugin-team.ts). Sagax has no per-bot tool allowlist, so
 * the frontmatter `tools` are written at the top of the soul. */
import { BOT_PROFILE_LIMITS } from "./bot-profile.ts";
import { frontmatter } from "./claude-code-import.ts";
import { nearestBotColor } from "./grok-import.ts";
import {
  PACKAGE_FORMAT,
  PACKAGE_VERSION,
  parsePackageDocument,
  redactPackageSecrets,
  utf8Bytes,
  type PackageDocument,
} from "./package-format.ts";

export interface PluginTeamInput {
  /** The plugin's name in its marketplace (and in plugin.json). */
  plugin: string;
  manifest?: { name?: string; displayName?: string; description?: string; version?: string };
  /** `agents/*.md`: file name and text. */
  agents: ReadonlyArray<{ file: string; text: string }>;
  /** The team's name; the plugin's shown name otherwise. */
  teamName?: string;
}

export interface PluginTeamAgent {
  key: string;
  name: string;
  /** The frontmatter `model`, as written (sonnet, opus, claude-fable-5-1...). */
  model?: string;
  tools: string[];
}

export interface PluginTeamPackage {
  document: PackageDocument;
  agents: PluginTeamAgent[];
  /** What did not come over, in plain words. */
  skipped: string[];
}

export class PluginTeamError extends Error {}

const COLORS = ["#3b82f6", "#22c55e", "#a855f7", "#f97316", "#ec4899", "#14b8a6", "#eab308", "#ef4444"];

function oneLine(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    out += code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 ? " " : ch;
  }
  return out.replace(/\s+/g, " ").trim();
}
const clip = (value: string, max: number) => (value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`);
const slug = (value: string, max: number) =>
  value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "");
function uniqueSlug(value: string, fallback: string, taken: Set<string>): string {
  const base = slug(value, 60) || fallback;
  let candidate = base;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}-${n}`;
  taken.add(candidate);
  return candidate;
}
function fitBytes(text: string, max: number): string {
  if (utf8Bytes(text) <= max) return text;
  let end = text.length;
  while (end > 0 && utf8Bytes(text.slice(0, end)) > max) end = Math.floor(end * 0.95);
  return text.slice(0, end);
}

/** `tools: Read, Glob` or `tools: [Read, Glob]` as a list. */
export function pluginAgentTools(raw: string | undefined): string[] {
  return [...new Set((raw ?? "").replace(/^\[|\]$/g, "").split(",").map((value) => value.trim().replace(/^["']|["']$/g, "")).filter(Boolean))];
}

/** The plugin's agents as an openmaus.package v2 with one team. */
export function pluginTeamToPackage(input: PluginTeamInput): PluginTeamPackage {
  const skipped: string[] = [];
  const taken = new Set<string>();
  const agents: PluginTeamAgent[] = [];
  const packageAgents: PackageDocument["package"]["agents"] = [];
  for (const file of [...input.agents].sort((a, b) => a.file.localeCompare(b.file))) {
    const { fields, body } = frontmatter(file.text);
    const fallback = file.file.replace(/\.md$/i, "");
    const name = clip(oneLine(fields.name || fallback), 100);
    let soul = body.trim();
    if (!name || !soul) {
      skipped.push(`agent ${file.file} (it has no instructions)`);
      continue;
    }
    const tools = pluginAgentTools(fields.tools);
    if (tools.length) soul = `Allowed tools: ${tools.join(", ")}.\n\n${soul}`;
    if (utf8Bytes(soul) > BOT_PROFILE_LIMITS.soul) {
      soul = fitBytes(soul, BOT_PROFILE_LIMITS.soul);
      skipped.push(`agent ${file.file} (its instructions were longer than ${BOT_PROFILE_LIMITS.soul} bytes, so the end was cut)`);
    }
    const key = uniqueSlug(name, `agent-${packageAgents.length + 1}`, taken);
    const description = oneLine(fields.description ?? "");
    const model = oneLine(fields.model ?? "");
    packageAgents.push({
      key,
      name,
      title: clip(oneLine(input.manifest?.displayName || input.plugin), 200),
      ...(description ? { description: clip(description, BOT_PROFILE_LIMITS.description) } : {}),
      soul,
      appearance: { color: nearestBotColor(COLORS[packageAgents.length % COLORS.length]) },
    } as PackageDocument["package"]["agents"][number]);
    agents.push({ key, name, ...(model ? { model } : {}), tools });
  }
  if (!packageAgents.length) throw new PluginTeamError("This plugin has no agents (agents/*.md) to bring in as a team.");
  const shown = oneLine(input.manifest?.displayName || input.manifest?.name || input.plugin) || input.plugin;
  const teamName = clip(oneLine(input.teamName ?? "") || shown, 60);
  const release = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(input.manifest?.version ?? "") ? input.manifest!.version! : "1.0.0";
  const summary = clip(oneLine(input.manifest?.description ?? "") || `The agents of the plugin ${shown}, as one team.`, 2_000);
  const draft: PackageDocument = {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    package: {
      id: slug(`plugin-${input.plugin}`, 60) || "plugin-team",
      release,
      name: clip(shown, 100),
      tagline: clip(summary, 160),
      summary,
      category: "Imported",
      author: { name: clip(shown, 100) },
      license: "See source",
      outcomes: [clip(`${teamName} runs in Sagax with your own engine and apps.`, 240)],
      setupMinutes: 5,
      requirements: { apps: [], capabilities: [] },
      team: { name: teamName },
      agents: packageAgents,
    },
  } as PackageDocument;
  const { document, redacted } = redactPackageSecrets(draft);
  if (redacted.length) skipped.push(`text that looked like a key or password was replaced in ${redacted.join(", ")}`);
  try {
    return { document: parsePackageDocument(document, { trust: "file" }), agents, skipped };
  } catch (error) {
    throw new PluginTeamError(`This plugin's agents could not be turned into a team: ${error instanceof Error ? error.message : String(error)}`);
  }
}
