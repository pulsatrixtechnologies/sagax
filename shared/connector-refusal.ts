// #3515: the words an engine is told when a remote MCP server refuses its
// credentials (HTTP 401), and the one reader that says them in a reader's
// words. The server proxy writes the English sentence into the engine's
// tool result, so a step row stores it; the app's step detail
// (src/components/ToolActivity.tsx) and the thread API and the
// organization's connector (server/people/person-words.ts serverLineIn) all
// say it from the catalog key through connectorRefusalIn, whole and with
// its step to take, never cut in the middle of a word.

import type { LineWords } from "./workspace-line.ts";

/** What the engine is told when the server refuses its credentials (HTTP
 * 401). The proxy cannot tell a Sagax sign-in from a header the person
 * typed (both arrive as headers), so the words cover both: a sign-in token
 * that ran out during a long turn is refreshed when the next message
 * starts, while a revoked sign-in or a wrong key needs the person. Our own
 * words, nothing remote. */
export const MCP_CREDENTIALS_REFUSED = "This MCP server refused its credentials (HTTP 401). If it uses a sign-in, send the message again: "
  + "Sagax refreshes sign-ins when a message starts. If it still fails, open Capabilities > Installed and sign in to it again, "
  + "or check its header values.";

/** The catalog key that says it in a reader's language. */
export const CONNECTOR_REFUSAL_KEY = "chat.connectorCredentialsRefused";

/** Its first sentence: how a stored row is known, even one cut short. */
const HEAD = MCP_CREDENTIALS_REFUSED.slice(0, MCP_CREDENTIALS_REFUSED.indexOf(".") + 1);

/** `text` with the stored refusal said from its key (the words before it,
 * such as "MCP error -32603: ", and after it stay); undefined when `text`
 * does not hold it. A row cut inside the sentence reads whole. */
export function connectorRefusalIn(text: string, say: LineWords): string | undefined {
  const at = text.indexOf(HEAD);
  if (at < 0) return undefined;
  const end = text.startsWith(MCP_CREDENTIALS_REFUSED, at) ? at + MCP_CREDENTIALS_REFUSED.length : text.length;
  return `${text.slice(0, at)}${say(CONNECTOR_REFUSAL_KEY)}${text.slice(end)}`;
}
