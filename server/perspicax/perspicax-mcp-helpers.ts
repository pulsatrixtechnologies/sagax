// Pure helpers of the Perspicax MCP relay (tool spelling, api_list answers,
// body parsing, approval forms), split out of perspicax-mcp.ts.
import { toolFailureText } from "../../shared/tool-failure-text.ts";

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The spelling the live Perspicax role surface serves for a tool Sagax names with one
 * `_` (`twilio_api_write`): itself when served or when nothing is known,
 * else the served name that is the same tool with `__` (an earlier
 * Perspicax: `twilio_api__write`). */
export function servedSpelling(name: string, served: ReadonlySet<string> | undefined): string {
  if (!served || served.has(name)) return name;
  const folded = name.replace(/_{2,}/g, "_");
  for (const candidate of served) if (candidate.replace(/_{2,}/g, "_") === folded) return candidate;
  return name;
}

/** The tools of a tools/list answer that target Twilio under another name:
 * their description names Twilio or its API host. */
export function twilioToolsOf(body: unknown): string[] {
  const result = isObject(body) && isObject(body.result) ? body.result : null;
  const tools = result && Array.isArray(result.tools) ? result.tools : [];
  return tools
    .filter((tool): tool is Json => isObject(tool) && typeof tool.name === "string")
    .filter((tool) => /twilio/i.test(`${String(tool.description ?? "")} ${JSON.stringify(tool._meta ?? {})}`))
    .map((tool) => String(tool.name));
}


/** The product names an api_list answer declares, by API id: the
 * operator's display name, else the catalog's title. */
export function apiNamesOf(value: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const apis = isObject(value) && Array.isArray(value.apis) ? value.apis : [];
  for (const api of apis) {
    if (!isObject(api) || typeof api.id !== "string" || !api.id.trim()) continue;
    const declared = [api.display_name, api.title].find((name): name is string => typeof name === "string" && name.trim().length > 0);
    if (declared) names.set(api.id.trim().toLowerCase(), declared.trim().slice(0, 80));
  }
  return names;
}

/** The connectors whose reads an api_list answer marks as reviewed
 * (`reviewed_reads: true`: they return no credential), by the prefix of
 * their tools: each marked API id, and a served group (`group`) when every
 * listed member of it is marked. An API with no mark, as from a Perspicax
 * that declares none, is left out: its reads keep their card. */
export function reviewedReadsOf(value: unknown): Set<string> {
  const reviewed = new Set<string>();
  const groups = new Map<string, boolean>();
  const apis = isObject(value) && Array.isArray(value.apis) ? value.apis : [];
  for (const api of apis) {
    if (!isObject(api) || typeof api.id !== "string" || !api.id.trim()) continue;
    const marked = api.reviewed_reads === true;
    if (marked) reviewed.add(api.id.trim().toLowerCase());
    if (typeof api.group === "string" && api.group.trim()) {
      const group = api.group.trim().toLowerCase();
      groups.set(group, (groups.get(group) ?? true) && marked);
    }
  }
  for (const [group, marked] of groups) if (marked) reviewed.add(group);
  return reviewed;
}


/** One JSON-RPC answer out of a JSON or an SSE body (connector-proxy.ts). */
export function parseMcpBody(text: string, id: unknown): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed) as unknown;
  const frames = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]")
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Json];
      } catch {
        return [];
      }
    });
  return frames.findLast((frame) => frame.id === id) ?? frames.at(-1) ?? null;
}

/** 2026-11-05: a tools/call result flagged isError whose content has no
 * words (the engine then shows "returned no error message"): the words
 * Perspicax gave elsewhere (structuredContent, _meta) become its text, else
 * a plain sentence naming the tool. A result with words is left as it is. */
export function withFailureWords(body: unknown, tool: string): unknown {
  if (!isObject(body) || !isObject(body.result) || body.result.isError !== true) return body;
  const result = body.result;
  const content = Array.isArray(result.content) ? result.content : [];
  if (toolFailureText(content)) return body;
  const found = toolFailureText(result.structuredContent) ?? toolFailureText(result._meta);
  const text = found ?? `${tool || "The tool"} failed on Perspicax and its answer carried no error message${result.structuredContent !== undefined ? `: ${JSON.stringify(result.structuredContent).slice(0, 600)}` : ""}.`;
  return { ...body, result: { ...result, content: [...content.filter((block) => !(isObject(block) && block.type === "text")), { type: "text", text }] } };
}

/** The `elicitation` capability added to a client's own (2026-10-26). */
export function withElicitation(capabilities: unknown): Json {
  const caps = isObject(capabilities) ? { ...capabilities } : {};
  const current = isObject(caps.elicitation) ? caps.elicitation : {};
  caps.elicitation = { ...current, form: isObject(current.form) ? current.form : {} };
  return caps;
}

/** The approval form of a Perspicax GO: a `decision` of allow or deny. */
export function isGoForm(schema: unknown): boolean {
  if (!isObject(schema) || !isObject(schema.properties)) return false;
  const decision = schema.properties.decision;
  if (!isObject(decision)) return false;
  const values = [
    ...(Array.isArray(decision.oneOf) ? decision.oneOf.map((o) => (isObject(o) ? o.const : undefined)) : []),
    ...(Array.isArray(decision.enum) ? decision.enum : []),
  ];
  return values.includes("allow") && values.includes("deny");
}
