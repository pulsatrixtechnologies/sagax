/** Claude driver kind and config decoding (issue #1383 wave 5). */
import { homedir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
import type { ModelCatalog, EffortLevel } from "../../contracts.ts";

export const DRIVER_KIND = "claudeAgent";

export const NO_ANTHROPIC_KEY = "No Anthropic API key — open Settings → API keys.";

export type ClaudeCliVersion = readonly [number, number, number];

/** The first CLI this driver has seen echo a stdin user message with the
 * uuid it was sent with (`--replay-user-messages`, checked on 2.1.282). */
export const CLAUDE_REPLAY_FLOOR: ClaudeCliVersion = [2, 1, 282];


/** Resolve the CLI's config location without changing HOME or Keychain. */
export function resolveClaudeConfigDir(configDir?: string, env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  const configured = configDir?.trim() || env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude");
  const expanded = configured === "~" ? home : configured.startsWith("~/") ? join(home, configured.slice(2)) : configured;
  if (!isAbsolute(expanded) || /[\p{Cc}\p{Cf}]/u.test(expanded)) {
    throw new Error("claude: configDir must be an absolute path or start with ~/");
  }
  return normalize(expanded);
}

export interface ClaudeConfig {
  cli: string;
  /** Separate CLI-managed login/settings. Empty uses the normal CLI account. */
  configDir?: string;
  /** Company routing is supplied by the private desktop parent, never local discovery. */
  managed?: boolean;
  /** Operator-provided hosted catalog; absent for ordinary desktop accounts. */
  managedModels?: string[];
  permissionMode: "acceptEdits" | "auto" | "bypassPermissions";
  /** Available Claude built-ins. An empty list passes `--tools ""`. */
  tools?: string[];
  /** Claude tool patterns to deny after the available set is selected. */
  disallowedTools?: string[];
  /** Runs only on the workspace Anthropic key (the `claudeApi` instance):
   * unavailable without one, never on a personal login. */
  requireApiKey?: boolean;
}

function decodeToolList(value: unknown, field: "tools" | "disallowedTools"): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`claude: ${field} must be an array of non-empty strings`);
  const decoded: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new Error(`claude: ${field} must be an array of non-empty strings`);
    }
    const normalized = entry.trim();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    decoded.push(normalized);
  }
  return decoded;
}

export function decodeConfig(raw: unknown): ClaudeConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  const mode = o.permissionMode;
  if (mode !== undefined && mode !== "acceptEdits" && mode !== "auto" && mode !== "bypassPermissions") {
    throw new Error(`claude: invalid permissionMode ${JSON.stringify(mode)}`);
  }
  const tools = decodeToolList(o.tools, "tools");
  const disallowedTools = decodeToolList(o.disallowedTools, "disallowedTools");
  if (o.configDir !== undefined && typeof o.configDir !== "string") throw new Error("claude: configDir must be a string");
  const configDir = typeof o.configDir === "string" ? o.configDir.trim() : undefined;
  if (configDir) resolveClaudeConfigDir(configDir);
  if (o.managedModels !== undefined && (o.managed !== true || !Array.isArray(o.managedModels) || !o.managedModels.length || o.managedModels.some(model => typeof model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(model)))) throw new Error("Invalid hosted Claude models.");
  return {
    cli: typeof o.cli === "string" ? o.cli : "claude",
    ...(configDir ? { configDir } : {}),
    ...(o.managed === true ? { managed: true } : {}),
    ...(o.managedModels ? { managedModels: o.managedModels as string[] } : {}),
    permissionMode: (mode as ClaudeConfig["permissionMode"]) ?? "acceptEdits",
    ...(tools !== undefined ? { tools } : {}),
    ...(disallowedTools !== undefined ? { disallowedTools } : {}),
    ...(o.requireApiKey === true ? { requireApiKey: true } : {}),
  };
}

// model catalog ported from upstream packages/contracts/src/model.ts. The
// effort levels are what Claude Code 2.1.296 answered in its stream-json
// `initialize` (`models[].supportedEffortLevels`, 2026-10-13): every 5.x model
// takes low to max, Haiku 4.5 takes none (no `supportsEffort`).
const CLAUDE_5_EFFORTS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];
export const STATIC_CLAUDE_MODELS: ModelCatalog = {
  default: "claude-sonnet-5",
  options: [
    { id: "claude-fable-5-1", label: "Claude Fable 5.1", effortLevels: CLAUDE_5_EFFORTS },
    { id: "claude-fable-5", label: "Claude Fable 5", effortLevels: CLAUDE_5_EFFORTS },
    { id: "claude-opus-5-5", label: "Claude Opus 5.5", contextWindow: 1_000_000, effortLevels: CLAUDE_5_EFFORTS },
    { id: "claude-opus-5", label: "Claude Opus 5", effortLevels: CLAUDE_5_EFFORTS },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", contextWindow: 1_000_000, effortLevels: CLAUDE_5_EFFORTS },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5", effortLevels: CLAUDE_5_EFFORTS },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", contextWindow: 1_000_000, effortLevels: CLAUDE_5_EFFORTS },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", effortLevels: [] },
  ],
};
