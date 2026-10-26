// open_connector_setup (shared/connector-setup.ts): the person asks to
// connect a connector, the bot makes one call, the chat shows a card whose
// button opens the engine's sign-in page in the person's browser.
import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

export const CONNECTOR_SETUP_TOOL_NAME = "open_connector_setup";

const VIA = new Set(["grok", "claude"]);
const LANGUAGES = new Set(["fr", "en"]);

export async function callConnectorSetupTool(args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const connector = typeof args.connector === "string" ? args.connector.trim().slice(0, 120) : "";
  if (!connector) return { text: "open_connector_setup needs the connector's name (\"Microsoft Teams\", \"Gmail\").", isError: true };
  const via = typeof args.via === "string" && VIA.has(args.via) ? args.via : undefined;
  const language = typeof args.language === "string" && LANGUAGES.has(args.language) ? args.language : undefined;
  const opened = await context.client.apiResponse("/api/internal/connector-setup/open", {
    method: "POST",
    body: JSON.stringify({ connector, ...(via ? { via } : {}), ...(language ? { language } : {}) }),
  });
  const r = opened.body;
  if (!opened.ok || r.error) return { text: String(r.error ?? "No connection card could be shown."), isError: true };
  const label = typeof r.label === "string" ? r.label : connector;
  if (r.status === "connected") return { text: `${label} is already connected for this person. Say so in one short sentence.` };
  const where = r.route === "claude" ? "claude.ai" : "grok.com";
  return {
    text: `The card "Connect ${label}" is in the chat: its button opens ${where} in the person's browser, where they sign in; the card turns to connected once Sagax sees it work. Answer in one short sentence in their language (no link, no steps). Never say it is connected until a call through it succeeds.`,
  };
}
