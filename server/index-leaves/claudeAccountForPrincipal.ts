// @ts-nocheck
/** claudeAccountForPrincipal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createClaudeAccountForPrincipal(getHost: () => Host): any {
function claudeAccountForPrincipal(principalId: string): { cli: string; env: NodeJS.ProcessEnv; key: string } | { unavailable: "no_engine" | "not_signed_in" | "key" } {
  const host = getHost();
  const { resolveClaudeConfigDir } = host;

  const entries = Object.entries(instanceConfigs(host.cfg)).filter(([, entry]) => entry.driver === "claudeAgent");
  const [instanceId, entry] = entries.find(([id]) => id === "claude") ?? entries[0] ?? [];
  if (!instanceId || !entry) return { unavailable: "no_engine" as const };
  const config = (entry.config ?? {}) as { cli?: unknown; configDir?: unknown };
  const cli = typeof config.cli === "string" && config.cli.trim() ? config.cli : "claude";
  const env: NodeJS.ProcessEnv = { ...process.env, ...entry.environment };
  if (host.IDENTITY.kind === "perspicax") {
    if (!host.engineLogins?.signedIn(principalId, "claudeAgent")) return { unavailable: "not_signed_in" as const };
    env.CLAUDE_CONFIG_DIR = host.engineLogins.loginDir(principalId, "claudeAgent");
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    return { cli, env, key: `person:${principalId}` };
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
  return { cli, env, key: `instance:${instanceId}` };

}
  return claudeAccountForPrincipal;
}
