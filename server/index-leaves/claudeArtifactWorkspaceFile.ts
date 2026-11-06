// @ts-nocheck
/** claudeArtifactWorkspaceFile (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createClaudeArtifactWorkspaceFile(getHost: () => Host): any {
function claudeArtifactWorkspaceFile(botId: string, file: string) {
  void getHost();

  try {
    const root = realpathSync(workspaceDir(botId));
    const resolved = realpathSync(isAbsolute(file) ? file : join(root, file));
    if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) return null;
    return statSync(resolved).isFile() ? resolved : null;
  } catch {
    return null;
  }

}
  return claudeArtifactWorkspaceFile;
}
