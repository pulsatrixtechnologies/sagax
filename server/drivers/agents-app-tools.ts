// The live chat-app tools of the agents catalog (show_html, update_html),
// spread into TOOL_DEFINITIONS in agents-catalog.ts next to the chat-widget
// tools. Definitions only, like that file; agents-call-cards.ts carries a
// call out and server/chat-apps.ts stores the result. Every word here is sent
// to the model on every turn and pinned by agents-catalog-wire.test.ts.
export const APP_TOOL_DEFINITIONS = [
  {
    name: "show_html",
    description:
      "Show a live interactive app in this chat: a small HTML page that runs on its own and that you can update live. Reach for it when the person asks for a dashboard, a live status, a data view, a calculator or a small interactive tool, and a declarative widget (show_widget) is not enough because you need your own layout, styling or scripted behaviour. The page runs in a locked sandbox: your scripts run, but it has an opaque origin, no network of any kind, and cannot read this app, its storage or any secret. So put every value inline in the page, never fetch anything, and never put a password, token or key in it. `html` is a complete fragment: your markup, with optional <style> and <script>; the chat wraps it in the current light or dark theme and keeps it to the chat column's width, so keep it focused. Replace it later in place with update_html to show new data. Not available in rooms.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        html: { type: "string", description: "The app's complete HTML fragment, with optional <style> and <script>. Self-contained: no network requests, no secrets." },
        title: { type: "string", description: "Optional short human title for the app's header (plain words, no id)." },
      },
      required: ["html"],
    },
  },
  {
    name: "update_html",
    description:
      "Replace a live app you showed earlier in this chat, in place, so it shows new data: a number moving, new rows, a finished state. `app_id` is the id show_html returned. Send the whole page again; it replaces what was there without adding a new row.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        app_id: { type: "string", description: "The id show_html returned." },
        html: { type: "string", description: "The app's new complete HTML fragment. Self-contained: no network requests, no secrets." },
        title: { type: "string", description: "Optional short human title for the app's header." },
      },
      required: ["app_id", "html"],
    },
  },
];
