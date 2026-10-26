// A server's own Result size limit in the MCP server editor
// (McpServersPanel): characters of one tool result allowed into context,
// blank = the app default, 0 = never trim. The server keeps it as
// config.json `mcpServers.<name>.resultBudget` (server/mcp-result-budget.ts).
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";

/** The shape of a message the MCP server editor shows. */
export interface McpMessage {
  key: LocaleKey;
  params?: Record<string, string | number>;
}

/** The limit as a server listing carries it. */
export interface McpResultBudgetListing {
  /** characters of one tool result allowed into context; absent = app default */
  resultBudget?: number;
}

/** The limit as the editor's draft holds it. */
export interface McpResultBudgetDraft {
  /** Result size limit, as typed; blank = the app default */
  resultBudget: string;
}

/** The most a server's result size limit may be (server/mcp-registry.ts). */
export const MAX_MCP_RESULT_BUDGET = 2_000_000;

/** The Result size limit field: blank = the app default, 0 = never trim.
 * Digit grouping (40,000 / 40.000 / 40 000 / 40_000) is accepted as typed,
 * but only as whole groups of three, so a decimal (12.5, 1,5) is refused
 * rather than read as a number ten times larger. */
export function parseMcpResultBudget(value: string): { ok: true; value: number | undefined } | { ok: false; error: McpMessage } {
  const trimmed = value.trim();
  const grouped = /^\d{1,3}([\s,._  '])\d{3}(?:\1\d{3})*$/.test(trimmed);
  const digits = grouped ? trimmed.replace(/\D/g, "") : trimmed;
  if (!digits) return { ok: true, value: undefined };
  if (!/^\d+$/.test(digits) || Number(digits) > MAX_MCP_RESULT_BUDGET) return { ok: false, error: { key: "mcp.err.resultBudget" } };
  return { ok: true, value: Number(digits) };
}

/** The draft text for a saved server's limit. */
export function resultBudgetDraft(server: McpResultBudgetListing): string {
  return server.resultBudget === undefined ? "" : String(server.resultBudget);
}

/** A request body built from the draft, with the typed limit checked first and
 * added last (left out when blank, so the server uses the app default). */
export function withResultBudget<E extends { ok: false; error: McpMessage }>(
  value: string,
  build: () => { ok: true; body: Record<string, unknown> } | E,
): { ok: true; body: Record<string, unknown> } | E | { ok: false; error: McpMessage } {
  const budget = parseMcpResultBudget(value);
  if (!budget.ok) return budget;
  const built = build();
  if (!built.ok || budget.value === undefined) return built;
  return { ok: true, body: { ...built.body, resultBudget: budget.value } };
}

export function McpResultBudgetField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-[12px] font-medium text-ink-secondary">{t("mcp.field.resultBudget")}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="numeric"
        placeholder="8000"
        className="mt-1.5 w-full rounded-lg border border-hairline/60 bg-raised px-3 py-2.5 text-[13px] text-ink outline-none focus:border-accent"
      />
      <span className="mt-1.5 block text-[11px] text-ink-secondary">{t("mcp.resultBudgetHint")}</span>
    </label>
  );
}
