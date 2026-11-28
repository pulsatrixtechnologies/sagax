// The live chat-app tools of the agents catalog (show_html, update_html),
// spread into TOOL_DEFINITIONS in agents-catalog.ts next to the chat-widget
// tools. Definitions only, like that file; agents-call-cards.ts carries a
// call out and server/widgets/chat-apps.ts stores the result. Every word here is sent
// to the model on every turn and pinned by agents-catalog-wire.test.ts.
export const APP_TOOL_DEFINITIONS = [
  {
    name: "show_html",
    description:
      "Show a live interactive app in this chat: HTML you can update live, when show_widget is not enough. Locked sandbox: scripts, opaque origin, no network, no access to this app or its secrets. `html` is a fragment with optional <style> and <script>; the chat wraps it with the widget kit. Connector calls: one script type application/sagax-capabilities+json with connectors and data, the viewer's connection, and the same approvals as the bot. uses is bot, state, or connector:tool, and only when that script is absent. Replace it with update_html. No shared state (propose_page). Not in rooms.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        html: { type: "string", description: "The app's complete HTML fragment, with optional <style> and <script>. Self-contained: no network requests, no secrets." },
        title: { type: "string", description: "Optional short human title for the app's header (plain words, no id)." },
        uses: { type: "array", items: { type: "string" }, description: "bot, state, or connector:tool." },
      },
      required: ["html"],
    },
  },
  {
    name: "update_html",
    description:
      "Replace a live app in place. `app_id` is the id show_html returned. Send the whole page again, including application/sagax-capabilities+json when it calls connectors. Calls use the viewer's connection and the same approvals as the bot.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        app_id: { type: "string", description: "The id show_html returned." },
        html: { type: "string", description: "The app's new complete HTML fragment. Self-contained: no network requests, no secrets." },
        title: { type: "string", description: "Optional short human title for the app's header." },
        uses: { type: "array", items: { type: "string" }, description: "bot, state, or connector:tool." },
      },
      required: ["app_id", "html"],
    },
  },
];
