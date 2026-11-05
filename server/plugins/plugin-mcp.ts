// Read a plugin's declared MCP servers once for every capability scope.
// The caller validates the stored server shape and chooses where it runs.
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

type Json = Record<string, unknown>;
const record = (value: unknown): Json | null => value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;

function readJson(file: string): Json | null {
  try {
    if (!existsSync(file) || statSync(file).size > 1_048_576) return null;
    return record(JSON.parse(readFileSync(file, "utf8")));
  } catch { return null; }
}

function withPluginRoot(value: unknown, root: string): unknown {
  if (typeof value === "string") return value.replaceAll("${CLAUDE_PLUGIN_ROOT}", root);
  if (Array.isArray(value)) return value.map((item) => withPluginRoot(item, root));
  const object = record(value);
  return object ? Object.fromEntries(Object.entries(object).map(([key, item]) => [key, withPluginRoot(item, root)])) : value;
}

function storedShape(entry: Json): Json | null {
  if (typeof entry.url === "string") return { type: entry.type === "sse" ? "sse" : "http", url: entry.url, ...(record(entry.headers) ? { headers: entry.headers } : {}) };
  if (typeof entry.command === "string") return {
    command: entry.command,
    ...(Array.isArray(entry.args) ? { args: entry.args.filter((arg) => typeof arg === "string") } : {}),
    ...(record(entry.env) ? { env: entry.env } : {}),
  };
  return null;
}

export interface PluginMcpDeclarations {
  servers: Array<{ name: string; entry: Record<string, unknown> }>;
  skipped: string[];
}

/** `executionRoot` can be the plugin folder in the person's environment;
 * no command receives the server host's checkout path in that case. */
export function readPluginMcpServers(root: string, executionRoot = root, fallbackManifest?: Record<string, unknown>): PluginMcpDeclarations {
  const result: PluginMcpDeclarations = { servers: [], skipped: [] };
  const blocks: Json[] = [];
  const mcpJson = readJson(join(root, ".mcp.json"));
  if (mcpJson) blocks.push(record(mcpJson.mcpServers) ?? mcpJson);
  const manifest = readJson(join(root, ".claude-plugin", "plugin.json")) ?? fallbackManifest;
  if (manifest) {
    if (record(manifest.mcpServers)) blocks.push(record(record(manifest.mcpServers)!.mcpServers) ?? record(manifest.mcpServers)!);
    else if (typeof manifest.mcpServers === "string") {
      const file = resolve(root, manifest.mcpServers);
      const inside = relative(resolve(root), file);
      if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) result.skipped.push(`mcpServers path ${manifest.mcpServers}`);
      else {
        const value = readJson(file);
        if (value) blocks.push(record(value.mcpServers) ?? value);
      }
    }
  }
  const seen = new Set<string>();
  for (const block of blocks) {
    for (const [name, raw] of Object.entries(block)) {
      if (seen.has(name)) continue;
      const entry = record(raw);
      const shape = entry ? storedShape(record(withPluginRoot(entry, executionRoot))!) : null;
      if (!shape) { result.skipped.push(`MCP server ${name}`); continue; }
      seen.add(name);
      result.servers.push({ name, entry: shape });
    }
  }
  return result;
}
