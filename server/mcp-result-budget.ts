// A bot-owned MCP server's own result size limit (the MCP server editor's
// Result size limit, config.json `mcpServers.<name>.resultBudget`), from
// config to a turn: which servers set one, and handing them to the engine
// beside the server specs. How a driver gates a server with it is
// mcp-gate-config.ts (customServerGate).
import type { AppConfig } from "./config.ts";
import type { McpServerSpec, SendTurnInput } from "./contracts.ts";
import { parseStoredMcpServer } from "./mcp-registry.ts";

/** The per-server result budgets set on `names` (config.json
 * `mcpServers.<name>.resultBudget`). A server without one is left out, so
 * the caller falls back to the app default. */
export function customMcpResultBudgets(cfg: AppConfig, names: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of names) {
    const raw = cfg.mcpServers?.[name];
    if (raw === undefined) continue;
    const parsed = parseStoredMcpServer(name, raw);
    if (parsed.ok && parsed.server.resultBudget !== undefined) out[name] = parsed.server.resultBudget;
  }
  return out;
}

/** Give a turn the person's own MCP servers (when there are any) and the
 * result limits those servers set, kept apart from the specs. */
export function attachCustomMcp(
  integrations: Pick<NonNullable<SendTurnInput["integrations"]>, "custom" | "customResultBudgets">,
  custom: Record<string, McpServerSpec>,
  cfg: AppConfig,
): void {
  if (!Object.keys(custom).length) return;
  integrations.custom = custom;
  const budgets = customMcpResultBudgets(cfg, Object.keys(custom));
  if (Object.keys(budgets).length) integrations.customResultBudgets = budgets;
}
