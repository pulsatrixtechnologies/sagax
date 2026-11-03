// The four artifact tools of the agents catalog
// (docs/superpowers/specs/2026-10-16-artifacts-design.md), spread into
// TOOL_DEFINITIONS in agents-catalog.ts. Definitions only;
// agents-call-artifacts.ts carries a call to the internal route and
// server/artifacts/artifacts.ts stores the result. Every word here is sent to the
// model on every turn and pinned by agents-catalog-wire.test.ts.
const FIELDS = {
  title: { type: "string" },
  html: { type: "string", description: "Self-contained HTML with inline CSS and JS; no network (strict CSP). Read window.sagax.data; window.sagax.onData(fn) gets each refresh's JSON." },
  source: {
    type: "object",
    description: "Re-run by Sagax on the interval, with no turn of yours: {kind:\"tool\",tool,args} (a read tool: workspace_read of a JSON file you keep, a connector query) or {kind:\"command\",command} (read-only, prints JSON). A call that would need approval is marked blocked. null removes it.",
    properties: { kind: { type: "string", enum: ["tool", "command"] }, tool: { type: "string" }, args: { type: "object" }, command: { type: "string" } },
    required: ["kind"],
  },
  interval_seconds: { type: "integer", minimum: 30, maximum: 86400 },
  favorite: { type: "boolean" },
  popped: { type: "boolean", description: "In its own floating window, reopened when Sagax starts." },
  bounds: { type: "object", description: "First window position, pixels.", properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } } },
};

export const ARTIFACT_TOOL_DEFINITIONS = [
  {
    name: "save_artifact",
    description:
      "Save a widget the person wants to keep, pin or watch as an artifact: it shows in your Files tab under Artifacts. With source and interval_seconds it refreshes itself. They cannot edit its settings; they ask you. It stays inside Sagax, for this person; to share a page with others through a link, use propose_page instead. Returns its id.",
    inputSchema: { type: "object", additionalProperties: false, properties: FIELDS, required: ["title", "html"] },
  },
  {
    name: "update_artifact",
    description: "Change one of your artifacts: any save_artifact field, or paused to stop or resume its refresh. Omitted fields stay.",
    inputSchema: { type: "object", additionalProperties: false, properties: { artifact_id: { type: "string" }, ...FIELDS, paused: { type: "boolean" } }, required: ["artifact_id"] },
  },
  {
    name: "list_artifacts",
    description: "Your artifacts with their settings and refresh state.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "delete_artifact",
    description: "Delete one of your artifacts.",
    inputSchema: { type: "object", additionalProperties: false, properties: { artifact_id: { type: "string" } }, required: ["artifact_id"] },
  },
];

export const ARTIFACT_TOOL_NAMES: ReadonlySet<string> = new Set(ARTIFACT_TOOL_DEFINITIONS.map((tool) => tool.name));
