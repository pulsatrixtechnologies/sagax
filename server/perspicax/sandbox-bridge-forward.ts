// #5138 (M-20261120-008): the sandbox bridge's forwardTurn (server/index.ts)
// marks the frames it hands to the internal Perspicax route with this header
// and a secret of this process. The answer goes back to a script in the
// person's own server environment, so a file in it already lands in that
// person's place and is not moved there again. Nobody else can claim it:
// the secret never leaves this process.
import { randomBytes, timingSafeEqual } from "node:crypto";

export const SANDBOX_BRIDGE_FORWARD_HEADER = "x-sagax-environment-bridge";
const SANDBOX_BRIDGE_FORWARD_SECRET = randomBytes(32).toString("base64url");

/** The header forwardTurn adds. */
export function sandboxBridgeForwardHeaders(): Record<string, string> {
  return { [SANDBOX_BRIDGE_FORWARD_HEADER]: SANDBOX_BRIDGE_FORWARD_SECRET };
}

/** Whether a request to the internal route came through forwardTurn. */
export function isSandboxBridgeForward(headers: Record<string, string | string[] | undefined> | undefined): boolean {
  const value = headers?.[SANDBOX_BRIDGE_FORWARD_HEADER];
  if (typeof value !== "string" || value.length !== SANDBOX_BRIDGE_FORWARD_SECRET.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(SANDBOX_BRIDGE_FORWARD_SECRET));
}
