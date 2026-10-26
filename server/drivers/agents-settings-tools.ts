// sagax_settings, the bots' hand on every setting of the app
// (server/settings-actions.ts), spread into TOOL_DEFINITIONS in
// agents-catalog.ts. Definition only; agents-call.ts carries a call to
// /api/internal/settings. One tool for every family, to stay short on the
// wire: the keys come from action list, never from this text.
export const SETTINGS_TOOL_DEFINITIONS = [
  {
    name: "sagax_settings",
    description:
      "Read or change any Sagax setting for the person you speak with, with their rights: bots, conversations, routines, groups, teams, rules, account, appearance, notifications, models, connections, vault, server, organization. list (optional family) gives the keys, get reads, set changes. Their own bots and routines change at once at Approve for me or Full; a secret, a deletion, another person or the organization waits for their Allow. A Primary Bot the person asks now (levels, rules) passes quote, their words: it runs at once. Try before saying you cannot.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["list", "get", "set"] },
        family: { type: "string", description: "list: bot, thread, routine, group, section, rules, account, appearance, notifications, models, connections, credentials, server, organization, computer." },
        key: { type: "string", maxLength: 64, description: "From list, e.g. bot.approvalMode." },
        target: { type: "string", maxLength: 200, description: "Id of the bot, conversation, routine, group, team, rule or vault item; default you or this conversation." },
        value: { description: "The new value (set)." },
        quote: { type: "string", maxLength: 600 },
      },
      required: ["action"],
    },
  },
] as const;

export const SETTINGS_TOOL_NAMES: ReadonlySet<string> = new Set(SETTINGS_TOOL_DEFINITIONS.map((tool) => tool.name));
