import type { StoredRemoteMcpServer } from "./mcp-registry.ts";

/** A tool name no server defines, so calling it runs nothing and the answer
 * says only whether tool calls need a sign-in. Observed 2026-10-31:
 * mcp.agentcard.sh answers it HTTP 401 with `resource_metadata`;
 * huggingface.co/mcp, whose sign-in is optional and which also serves an
 * RFC 9728 document, answers JSON-RPC -32602 "not found". */
export const SIGN_IN_CHECK_TOOL = "sagax.sign-in-check";

/** True when the probe carries any header value. Personal entries store ""
 * placeholders, so an empty value is no credential. */
export function sendsCredentials(server: Pick<StoredRemoteMcpServer, "headers">): boolean {
  return Object.values(server.headers).some((value) => value !== "");
}
