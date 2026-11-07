/** OpenTelemetry export settings (#2609), as the settings page sees them.
 * Header values are write-only: only their names ever come back. */
export interface TelemetrySettingsView {
  /** OTLP/HTTP collector base URL; null while export is off. */
  endpoint: string | null;
  /** Names of the saved headers (values never leave the server). */
  headerNames: string[];
  serviceName: string | null;
  /** Export is on: an endpoint is saved. */
  enabled: boolean;
}

export const TELEMETRY_PATH = "/api/telemetry";

/** Usage statistics (#2609): one group of the account, model, source or
 * person split (server/telemetry/usage-stats.ts). */
export interface UsageStatsGroup {
  key: string;
  label: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** Null when no turn of the group was priced. */
  costUsd: number | null;
  /** Calls counted from the spans of this group's threads (not on byModel). */
  toolCalls?: number;
  mcpCalls?: number;
  subagentCalls?: number;
  /** account only: the engine and how the turns were paid. */
  engine?: string;
  access?: string;
}

export interface UsageToolStat {
  tool: string;
  kind: "subagent" | "mcp" | "builtin";
  mcpServer?: string;
  calls: number;
  errors: number;
  totalMs: number;
}

export interface UsageStats {
  totals: Omit<UsageStatsGroup, "key" | "label"> & { toolCalls: number; mcpCalls: number; subagentCalls: number; toolErrors: number };
  byAccount: UsageStatsGroup[];
  byModel: UsageStatsGroup[];
  bySource: UsageStatsGroup[];
  byPerson: UsageStatsGroup[];
  /** The most called tools, at most 50. */
  tools: UsageToolStat[];
}


/** GET /api/bots/:id/analytics?view=breakdown&period=7|30|month (#2612):
 * the bot's usage split, as the V6 "Statistiques d'usage" tab reads it. */
export interface BotUsageBreakdown extends UsageStats {
  from: string;
  to: string;
  period: 7 | 30 | "month";
  /** The billing currency when a price list is applied, else null (USD). */
  currency: string | null;
}
