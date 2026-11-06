// Provider-safe MCP tool input schemas.
//
// Every engine hands an MCP tool's inputSchema to its model provider as the
// function's parameters. The strict providers (OpenAI, xAI, Bedrock, Kimi…)
// require that root to be a plain `type: "object"` and refuse a root
// anyOf/oneOf/allOf/not outright — and a refused schema fails the whole turn,
// not just the one tool. The bundled cua-driver 0.22.1 ships exactly that
// shape on browser_prepare, which is what broke "This computer" for OpenCode
// once Windows started mounting the desktop in v0.1.83.
//
// The rewrite only relaxes what the model is TOLD. The MCP server still
// validates every call against its own schema — a plain object root, with the
// conditional rules enforced in the tool itself. Nested schemas are left
// exactly as written. Under a provider profile (tool-schema-profile.ts) each
// listed schema is also fitted to that provider's per-tool size and depth
// limits (OMB #3311).
import { fitToolSchema, type ToolSchemaProfile } from "../tool-schema-profile.ts";

type JsonObject = Record<string, unknown>;

const ROOT_COMBINATORS = ["anyOf", "oneOf", "allOf", "not"] as const;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function branches(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

/** The object shape a schema implies, gathered through its combinators.
 * Its own declarations win over a branch's narrower copy; a property that
 * only a branch declares is kept so the model still knows it exists. A name
 * is required when the schema or an allOf branch requires it, or when every
 * anyOf/oneOf choice does — a requirement of only one choice is not. */
function objectShape(schema: JsonObject): { properties: JsonObject; required: string[] } {
  const properties: JsonObject = isObject(schema.properties) ? { ...schema.properties } : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((key) => typeof key === "string") : []);

  const adopt = (shape: { properties: JsonObject }) => {
    for (const [key, value] of Object.entries(shape.properties)) if (!(key in properties)) properties[key] = value;
  };

  for (const branch of branches(schema.allOf)) {
    const shape = objectShape(branch);
    adopt(shape);
    for (const key of shape.required) required.add(key);
  }
  for (const keyword of ["anyOf", "oneOf"] as const) {
    const choices = branches(schema[keyword]).map(objectShape);
    if (choices.length === 0) continue;
    for (const choice of choices) adopt(choice);
    for (const key of choices[0].required) {
      if (choices.every((choice) => choice.required.includes(key))) required.add(key);
    }
  }
  return { properties, required: [...required] };
}

function describesObject(type: unknown): boolean {
  return type === undefined || type === "object" || (Array.isArray(type) && type.includes("object"));
}

/** A strict-provider-safe version of an MCP tool's inputSchema. A schema
 * that is already safe is returned as the same object, so callers can tell
 * whether anything changed. The input is never mutated. */
export function providerSafeInputSchema(schema: unknown): JsonObject {
  if (!isObject(schema) || !describesObject(schema.type)) return { type: "object", properties: {} };
  if (schema.type === "object" && ROOT_COMBINATORS.every((keyword) => !(keyword in schema))) return schema;

  const { properties, required } = objectShape(schema);
  const safe: JsonObject = { ...schema, type: "object", properties };
  for (const keyword of ROOT_COMBINATORS) delete safe[keyword];
  if (required.length > 0) safe.required = required;
  else delete safe.required;
  return safe;
}

function toolName(tool: JsonObject): string {
  return typeof tool.name === "string" && tool.name ? tool.name : "unnamed";
}

/** The note a shortened tool carries, so the model fills in what its schema no longer spells out. */
export function shortenedToolNote(provider: string): string {
  return `(Sagax shortened this tool's parameters to fit ${provider}'s size limit for one tool: give any field it no longer lists `
    + "as this description says. The tool still checks every call against its full schema.)";
}

/** A tool list under a provider's profile: each schema keeps a plain object root and fits, or the tool is left out.
 * Every change is one line to `log`; a tool already within the limits is the same object. */
export function fitToolList(tools: readonly unknown[], profile: ToolSchemaProfile, log: (line: string) => void = () => {}): unknown[] {
  const fitted: unknown[] = [];
  for (const tool of tools) {
    if (!isObject(tool)) {
      fitted.push(tool);
      continue;
    }
    const rooted = providerSafeInputSchema(tool.inputSchema);
    const fit = fitToolSchema(rooted, profile);
    const name = toolName(tool);
    const limit = `${profile.provider}'s ${profile.maxSchemaBytes}-byte limit for one tool`;
    if (fit.outcome === "dropped") {
      log(`left out tool "${name}": its parameters are ${fit.from} bytes and still ${fit.bytes} at their shortest, over ${limit}`);
      continue;
    }
    if (fit.outcome === "kept") {
      fitted.push(fit.schema === tool.inputSchema ? tool : { ...tool, inputSchema: fit.schema });
      continue;
    }
    const what = { trimmed: "shortened the descriptions in", loosened: "left nested fields out of", minimal: "kept only the top-level fields of" }[fit.outcome];
    log(`${what} tool "${name}"'s parameters (${fit.from} to ${fit.bytes} bytes) to fit ${limit}`);
    if (fit.outcome === "trimmed") {
      fitted.push({ ...tool, inputSchema: fit.schema });
      continue;
    }
    const description = typeof tool.description === "string" && tool.description.trim() ? `${tool.description.trimEnd()}\n\n` : "";
    fitted.push({ ...tool, description: description + shortenedToolNote(profile.provider), inputSchema: fit.schema });
  }
  return fitted;
}

/** A `tools/list` result with its tools fitted to `profile`; anything else as it came. */
export function fitToolListResult(result: unknown, profile: ToolSchemaProfile | undefined, log?: (line: string) => void): unknown {
  if (!profile || !isObject(result) || !Array.isArray(result.tools)) return result;
  return { ...result, tools: fitToolList(result.tools, profile, log) };
}

/** Rewrites tools/list responses on an MCP stdio stream. Only a response to
 * a tools/list the agent actually sent is touched; every other line — tool
 * results, notifications, errors, non-JSON — passes through byte-for-byte.
 * Under a profile each listed schema is also fitted to it. */
export function createToolListNormalizer(profile?: ToolSchemaProfile, log?: (line: string) => void): {
  /** Record an agent → server line. */
  observeRequest: (line: string) => void;
  /** Map a server → agent line to what the agent should receive. */
  rewriteResponse: (line: string) => string;
} {
  // JSON-RPC ids may be numbers or strings, and 7 is not "7".
  const pending = new Set<string>();
  const idKey = (id: unknown) => `${typeof id}:${String(id)}`;

  return {
    observeRequest(line) {
      let frame: unknown;
      try {
        frame = JSON.parse(line);
      } catch {
        return;
      }
      if (isObject(frame) && frame.method === "tools/list" && (typeof frame.id === "number" || typeof frame.id === "string")) {
        pending.add(idKey(frame.id));
      }
    },
    rewriteResponse(line) {
      if (pending.size === 0) return line;
      let frame: unknown;
      try {
        frame = JSON.parse(line);
      } catch {
        return line;
      }
      if (!isObject(frame) || "method" in frame || !pending.delete(idKey(frame.id))) return line;
      if (!isObject(frame.result) || !Array.isArray(frame.result.tools)) return line;

      const listed: unknown[] = frame.result.tools;
      const tools = profile ? fitToolList(listed, profile, log) : listed.map((tool: unknown) => {
        if (!isObject(tool)) return tool;
        const inputSchema = providerSafeInputSchema(tool.inputSchema);
        return inputSchema === tool.inputSchema ? tool : { ...tool, inputSchema };
      });
      const changed = tools.length !== listed.length || tools.some((tool, index) => tool !== listed[index]);
      return changed ? JSON.stringify({ ...frame, result: { ...frame.result, tools } }) : line;
    },
  };
}
