// @ts-nocheck
/** claudeArtifactCommentsCheck (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createClaudeArtifactCommentsCheck(getHost: () => Host): any {
async function claudeArtifactCommentsCheck(routine: Routine): Promise<{ wake: true; note: string } | { wake: false; reason: string }> {
  const host = getHost();

  const principalId = routine.runAs ?? (host.IDENTITY.kind === "solo" ? host.localPrincipalId() : undefined);
  if (!principalId) return { wake: false, reason: "no person for this routine" };
  const artifacts = host.claudeArtifactTracked().forPrincipal(principalId);
  if (!artifacts.length) return { wake: false, reason: "no artifact to watch" };
  const waiting: Parameters<typeof host.claudeArtifactCommentsNote>[0] = [];
  for (const artifact of artifacts) {
    try {
      const threads = (await host.listClaudeArtifactComments(host.personClaudeArtifactCall, principalId, artifact.url)).filter(host.threadWantsClaude);
      if (threads.length) waiting.push({ url: artifact.url, title: artifact.title, threads });
    } catch {
      // one artifact that cannot be read never hides the others
    }
  }
  if (!waiting.length) return { wake: false, reason: "no comment waits for Claude" };
  return { wake: true, note: host.claudeArtifactCommentsNote(waiting) };

}
  return claudeArtifactCommentsCheck;
}
