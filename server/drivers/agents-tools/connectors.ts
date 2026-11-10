// connectors (#3347, connectors across engines L4): the person's connectors
// on every account of theirs, and the tools of one. Definition only; the
// call is server/drivers/agents-call-connectors.ts, the route
// server/routes/internal-connectors.ts. Never import server/index.ts.

export const DEF_CONNECTORS = {
    name: "connectors",
    description:
      "The connectors of the person speaking (Gmail, Microsoft Teams, Google Drive, ...) on every account of theirs, whatever engine this bot runs on. No argument: the list, with each connector's state. connector (a name from the list) and query (a few words): that connector's tools, with their descriptions and input schema when the provider gives them. Read only. To add a connector, call open_connector_setup.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        connector: { type: "string", maxLength: 200, description: "A connector name from the list, to find its tools." },
        query: { type: "string", maxLength: 200, description: "Words for the tools wanted (\"send message\", \"search files\")." },
      },
    },
  };

// call_connector (#3348, L5): one call of one of the person's connectors,
// through the hub. The call is decided by the person's approval settings on
// the calling turn, as a native connector call is.
export const DEF_CALL_CONNECTOR = {
    name: "call_connector",
    description:
      "Run one tool of one of the person's connectors (from connectors), whatever engine this bot runs on, and return the tool's own result. connector: its name; tool: one of its tools; arguments: that tool's input. The person's approval settings decide it as for any connector call: a read runs, a send or a change may show a card first. A connector marked callable false cannot be called this way yet.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["connector", "tool"],
      properties: {
        connector: { type: "string", maxLength: 200, description: "A connector name from connectors." },
        tool: { type: "string", maxLength: 300, description: "One of that connector's tools, as connectors names it." },
        arguments: { type: "object", description: "The tool's input." },
      },
    },
  };
