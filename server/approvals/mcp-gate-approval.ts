// The approval channel between an MCP gate and the Sagax server.
//
// When the engine runs MCP tools without asking (Grok in its default
// permission mode runs client-supplied MCP tools unprompted), Sagax gates
// them itself: every gate mounted with an approval socket holds each
// `tools/call` that is not on its reviewed read-only list and asks the
// server over this socket. The server opens a canonical approval card on the
// running turn and answers allow or deny. Fail closed: no socket, a closed
// socket, a malformed answer or no running turn all mean deny. Each call is
// its own ask; an answer is never reused for another call.

/** gate -> server, one JSON line */
export interface GateAsk {
  t: "ask";
  id: string;
  /** the per-thread secret the server minted for this mount */
  token: string;
  server: string;
  /** the upstream tool name (after alias resolution) */
  tool: string;
  /** a short, model-supplied preview of the arguments */
  summary: string;
  /** A longer argument preview for the safety review. The card keeps summary. */
  review?: string;
}

/** server -> gate, one JSON line */
export interface GateAnswer {
  t: "answer";
  id: string;
  behavior: "allow" | "deny";
  /** Shown to the model when the call did not run (a safer path, or a refusal). */
  note?: string;
}

/** Preview of a call's arguments for the card, capped. */
export function gateArgsSummary(args: unknown, max = 160): string {
  if (args === undefined || args === null) return "";
  let text: string;
  try { text = JSON.stringify(args); } catch { return ""; }
  if (!text || text === "{}") return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** What the model is told when a call was not approved. */
export function gateDeclinedText(server: string, tool: string): string {
  return `Not approved: ${server}__${tool} did not run because the person did not approve it. Do not retry it on your own; ask them, or continue without it.`;
}
