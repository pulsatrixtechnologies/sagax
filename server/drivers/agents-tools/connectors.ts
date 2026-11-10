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
