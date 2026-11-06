// @ts-nocheck
/** engineHomes (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createEngineHomes(getHost: () => Host): any {
function engineHomes() {
  const host = getHost();
  const { DATA_DIR, instanceConfigs, resolveClaudeConfigDir } = host;
  const entries = Object.values(instanceConfigs(host.cfg));
  const envs: Array<Record<string, string | undefined>> = [process.env, ...entries.map((entry) => ({ ...process.env, ...entry.environment }))];
  const configDirs: string[] = [];
  for (const entry of entries) {
    const configDir = (entry.config as { configDir?: unknown } | undefined)?.configDir;
    if (entry.driver !== "claudeAgent" || typeof configDir !== "string" || !configDir.trim()) continue;
    try { configDirs.push(resolveClaudeConfigDir(configDir, { ...process.env, ...entry.environment })); } catch { /* not a usable folder */ }
  }
  // a variable set to a whole home or to the data folder is no engine's home
  const notHomes = [DATA_DIR, host.homedir(), ...envs.flatMap((env) => [env.HOME, env.USERPROFILE].filter((path): path is string => Boolean(path)))];
  return distinctHomes([...dataEngineHomes(DATA_DIR), ...envs.flatMap((env) => environmentEngineHomes(env)), ...configDirs], notHomes);

}
  return engineHomes;
}
