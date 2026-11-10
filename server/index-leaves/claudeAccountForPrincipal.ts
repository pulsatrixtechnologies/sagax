// @ts-nocheck
/** claudeAccountForPrincipal (#1388). Pure move from server/index.ts. */
import { instanceConfigs } from "../config.ts";
export type Host = Record<string, any>;

export function createClaudeAccountForPrincipal(getHost: () => Host): any {
function claudeAccountForPrincipal(principalId: string, wanted?: string): { cli: string; env: NodeJS.ProcessEnv; key: string; instanceId?: string } | { unavailable: "no_engine" | "not_signed_in" | "key" } {
  const host = getHost();
  const { resolveClaudeConfigDir } = host;

  const entries = Object.entries(instanceConfigs(host.cfg)).filter(([, entry]) => entry.driver === "claudeAgent");
  // #2384: the turn's own account when named; a person-level use (no turn)
  // takes the first of the person's Claude accounts that is signed in
  const signedIn = (id: string) => host.engineLogins?.signedIn(principalId, "claudeAgent", "primary", id) === true;
  const named = wanted ? entries.find(([id]) => id === wanted) : undefined;
  const fallback = entries.find(([id]) => id === "claude") ?? entries[0];
  const [instanceId, entry] = named
    ?? (host.IDENTITY.kind === "perspicax" && !wanted && fallback && !signedIn(fallback[0]) ? entries.find(([id]) => signedIn(id)) : undefined)
    ?? fallback
    ?? [];
  if (!instanceId || !entry) return { unavailable: "no_engine" as const };
  const config = (entry.config ?? {}) as { cli?: unknown; configDir?: unknown };
  const cli = typeof config.cli === "string" && config.cli.trim() ? config.cli : "claude";
  const env: NodeJS.ProcessEnv = { ...process.env, ...entry.environment };
  if (host.IDENTITY.kind === "perspicax") {
    // #2373: the chosen account's own folder (an added account has its own)
    if (!host.engineLogins?.signedIn(principalId, "claudeAgent", "primary", instanceId)) return { unavailable: "not_signed_in" as const };
    env.CLAUDE_CONFIG_DIR = host.engineLogins.loginDir(principalId, "claudeAgent", "primary", instanceId);
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    return { cli, env, key: instanceId === "claude" ? `person:${principalId}` : `person:${principalId}:${instanceId}`, instanceId };
  }
  // A custom API instance has no claude.ai account. A separate provider key
  // never hides the subscription account's connectors.
  if (entry.environment?.ANTHROPIC_API_KEY) return { unavailable: "key" as const };
  if (typeof config.configDir === "string" && config.configDir.trim()) {
    try {
      env.CLAUDE_CONFIG_DIR = resolveClaudeConfigDir(config.configDir, env);
    } catch {
      return { unavailable: "no_engine" as const };
    }
  }
  return { cli, env, key: `instance:${instanceId}`, instanceId };

}
  return claudeAccountForPrincipal;
}
