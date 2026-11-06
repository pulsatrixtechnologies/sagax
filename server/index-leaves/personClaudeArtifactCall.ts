// @ts-nocheck
/** personClaudeArtifactCall (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPersonClaudeArtifactCall(getHost: () => Host): any {
async function personClaudeArtifactCall(   principalId: string,   tool: "Artifact" | "ArtifactData" | "ArtifactComments",   input: Record<string, unknown>,   page?: { html?: string; file?: string }, ) {
  const host = getHost();

  // Solo: the one local person only.
  if (host.IDENTITY.kind === "solo" && principalId.trim().toLowerCase() !== host.localPrincipalId().trim().toLowerCase()) {
    return { ok: false, unavailable: "not_signed_in" };
  }
  const account = host.claudeAccountForPrincipal(principalId);
  if ("unavailable" in account) return { ok: false, unavailable: account.unavailable };
  return host.runClaudeArtifact({ account: { cli: account.cli, env: account.env }, tool, input, ...page });

}
  return personClaudeArtifactCall;
}
