import type { HarnessClient, Json } from "./agents-client.ts";
import type { RemoteSupportContext } from "../remote-support-local.ts";

// Leaf types shared by agents-call.ts and the tool modules it dispatches to,
// so those modules never import agents-call.ts back.

export interface ToolCallContext {
  /** The calling bot's id (excluded from list_bots; the sender). */
  botId: string;
  threadId: string;
  /** This turn's comms depth (the harness refuses recursion). */
  depth: number;
  // Presentation only: the server still authenticates and scopes every call.
  externalRuntime: boolean;
  coordinating: boolean;
  sharedComputers: boolean;
  client: HarnessClient;
  /** Local technician key for remote support. Absent: the tool refuses rather than invent a key elsewhere. */
  remoteSupport?: RemoteSupportContext;
}

export interface ToolCallResult {
  text: string;
  isError?: boolean;
  /** The harness answered with a finished MCP tools/call result (a shared
   * computer's screenshot, say). A front end forwards it as it stands. */
  passthrough?: Json;
}
