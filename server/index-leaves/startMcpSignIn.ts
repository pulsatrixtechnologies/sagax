// @ts-nocheck
/** startMcpSignIn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createStartMcpSignIn(getHost: () => Host): any {
async function startMcpSignIn(req: IncomingMessage, auth: RequestAuth, name: string, server: RemoteMcpSpec, body: unknown, manager: McpOAuthManager = mcpOAuth):
  Promise<{ status: number; body: Record<string, unknown> }> {
  const host = getHost();

  const input = host.mcpOAuthStartSchema.safeParse(body ?? {});
  if (!input.success) return { status: 400, body: { error: input.error.issues[0]?.message ?? "Invalid sign-in request." } };
  const { returnTo, callbackOrigin, account: chosen, newAccount, ...client } = input.data;
  if (chosen && newAccount) return { status: 400, body: { error: "Name an account or add one, not both." } };
  if (chosen && chosen !== DEFAULT_MCP_ACCOUNT && !manager.vault.accounts(name).includes(chosen)) {
    return { status: 404, body: { error: "That account is not saved for this server.", code: "account_not_found" } };
  }
  const account = newAccount ? `acct-${randomBytes(5).toString("hex")}` : chosen;
  if (returnTo !== undefined && !phoneOAuthReturns().includes(returnTo)) {
    return { status: 400, body: { error: "returnTo is not an app address this server returns to.", code: "return_not_allowed" } };
  }
  let redirectUri = host.mcpOAuthRedirectUri(req);
  if (callbackOrigin !== undefined) {
    const origin = host.companionRequest(req, auth) && returnTo ? host.phoneCallbackOrigin(callbackOrigin) : null;
    if (!origin) return { status: 400, body: { error: "callbackOrigin is only for a paired phone's sign-in, as an https origin.", code: "callback_origin" } };
    redirectUri = `${origin}/api/mcp-oauth/callback`;
  } else if (host.companionRequest(req, auth) && returnTo && !host.publicUrl()) {
    // The browser on the phone cannot reach this computer's loopback address.
    return { status: 409, body: { error: "Send the address the phone reaches this computer on (callbackOrigin).", code: "callback_unreachable" } };
  }
  try {
    const started = await manager.start(name, host.server, {
      redirectUri, ...client, ...(returnTo ? { returnTo } : {}),
      ...(account ? { account } : {}), ...(newAccount ? { label: newAccount.label } : {})
    }, AbortSignal.timeout(15_000));
    return { status: 200, body: { ...started, redirectUri, ...(account ? { account } : {}) } };
  } catch (error) {
    if (error instanceof McpOAuthError) {
      return { status: 400, body: { error: error.message, ...(error.code ? { code: error.code } : {}), ...(error.code === "client_required" ? { redirectUri } : {}) } };
    }
    return { status: 502, body: { error: "The sign-in could not be started." } };
  }

}
  return startMcpSignIn;
}
