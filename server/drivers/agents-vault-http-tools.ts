// vault_http_request, the agents tool that calls an API with a key from the
// person's vault that Sagax adds itself (2026-10-26, server/vault/credential-http.ts,
// route /api/internal/credentials/http). Shown only when the harness says
// this bot may send at least one API key of the person here
// (SAGAX_VAULT_HTTP=1, CredentialVault.injectable); the route re-checks the
// grant, the sites and the addresses on every call. Definition and call live
// here so agents-catalog.ts and agents-call.ts each gain one line.
import type { ToolCallContext, ToolCallResult } from "./agents-call-types.ts";
import type { Json } from "./agents-client.ts";

export const VAULT_HTTP_TOOL_NAME = "vault_http_request";

export const VAULT_HTTP_TOOL = {
  name: VAULT_HTTP_TOOL_NAME,
  description:
    "Call an HTTPS API with an API key from the person's Sagax vault: Sagax adds the key itself (Bearer, header, Basic or query, as the person set it) and you never see it. handle: the key's cred_ handle (request_login with the API's host gives it, or asks the person). Only the key's own sites, public addresses, same-origin redirects; 30 s and 1 MB at most. Never put a key in url, headers or body, and never ask for one in chat.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      handle: { type: "string", maxLength: 60, description: "The key's handle, cred_..." },
      method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] },
      url: { type: "string", maxLength: 4096, description: "Full https URL on the key's site." },
      headers: { type: "object", description: "Optional headers (not Authorization nor the key's header)." },
      body: { description: "Optional body: text, or an object sent as JSON." },
    },
    required: ["handle", "url"],
  },
};

export async function callVaultHttpTool(args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  if (typeof args.handle !== "string" || !args.handle.trim()) return { text: "handle: the key's cred_ handle (call request_login with the API's host to get one).", isError: true };
  if (typeof args.url !== "string" || !args.url.trim()) return { text: "url: the full https URL of the API call.", isError: true };
  const { ok, body } = await context.client.apiResponse("/api/internal/credentials/http", {
    method: "POST",
    body: JSON.stringify({
      handle: args.handle.trim(),
      url: args.url.trim(),
      ...(typeof args.method === "string" ? { method: args.method } : {}),
      ...(args.headers !== undefined ? { headers: args.headers } : {}),
      ...(args.body !== undefined ? { body: args.body } : {}),
    }),
  });
  if (!ok) return { text: String(body.error ?? "The API request is not available in this turn."), isError: true };
  return { text: String(body.text ?? ""), ...(body.isError ? { isError: true } : {}) };
}
