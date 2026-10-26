// sagax_help, the bots' window on what Sagax and Perspicax can do
// (server/self-knowledge.ts), spread into TOOL_DEFINITIONS in
// agents-catalog.ts. Definition only; agents-call.ts carries a call to
// /api/internal/self-knowledge. Every word here is sent to the model on
// every turn and pinned by agents-catalog-wire.test.ts: keep it short.
export const HELP_TOOL_DEFINITIONS = [
  {
    name: "sagax_help",
    description:
      "What Sagax and Perspicax can do, where it is in the app and how, who may do it: features, settings, your tools, permissions, engines, release notes. Call it before you answer a question about the app or say something is impossible. Returns a few short sections.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        question: { type: "string", description: "The person's question, in their words." },
      },
      required: ["question"],
    },
  },
] as const;

export const HELP_TOOL_NAMES: ReadonlySet<string> = new Set(HELP_TOOL_DEFINITIONS.map((tool) => tool.name));
