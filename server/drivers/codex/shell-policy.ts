/** Shell environment policy helpers for Codex turns. */
import { plainRecord } from "./plain.ts";

/** Names of variable families mounts write, excluded by one pattern each:
 * gate and remote-proxy private records (a URL server's address and header
 * values live in the latter). */
export const PRIVATE_ENV_FAMILIES = ["SAGAX_GATE_CONFIG_", "SAGAX_REMOTE_MCP_CONFIG_"];
/** The remote proxy's settings that are not secret (mcp-gate-config.ts). */
export const PROXY_LITERAL_ENV = ["NODE_USE_ENV_PROXY", "NO_PROXY", "no_proxy"];
/** Variables a shell cannot work without: never excluded, whoever set them. */
export const SHELL_ESSENTIALS = new Set(["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TERM", "LANG", "TZ"]);

/** The thread-config key of Codex's shell `set` table (command variables). */
export const CODEX_SHELL_SET = "shell_environment_policy.set";

/** Thread-config overrides that add `patterns` to the person's shell
 * exclusions, given the effective shell_environment_policy (config/read).
 * Codex keeps two representations: the legacy `exclude`/`include_only`
 * lists and the keyed `filters` table (pattern → "exclude" | "include").
 * A higher layer that writes one drops the other from the layers below
 * (codex-cli 0.160), so the person's rules are extended in the
 * representation they use. codex-cli 0.160 also reports every unset field
 * as null: null means absent. Anything else unexpected refuses the turn. */
export function extendShellExclusions(policy: Record<string, unknown>, patterns: readonly string[]): Record<string, unknown> {
  const unconfirmed = () => new Error("Codex could not confirm its shell environment exclusions. No prompt was sent.");
  const exclude = policy.exclude ?? undefined;
  const filters = policy.filters ?? undefined;
  if (exclude !== undefined && (!Array.isArray(exclude) || exclude.some(name => typeof name !== "string"))) throw unconfirmed();
  if (filters === undefined) {
    return { "shell_environment_policy.exclude": [...new Set([...(exclude ?? []) as string[], ...patterns])] };
  }
  const table = plainRecord(filters);
  if (!table || Object.values(table).some(action => action !== "exclude" && action !== "include")) throw unconfirmed();
  // One Codex layer cannot mix the two; writing filters would drop the lists.
  if (exclude !== undefined || (policy.include_only ?? undefined) !== undefined) throw unconfirmed();
  // Patterns match, merge across layers, and must be unique ignoring case.
  const ours = new Set(patterns.map(pattern => pattern.toLowerCase()));
  return { "shell_environment_policy.filters": Object.fromEntries([
    ...Object.entries(table).filter(([pattern]) => !ours.has(pattern.toLowerCase())),
    ...patterns.map(pattern => [pattern, "exclude"]),
  ]) };
}
