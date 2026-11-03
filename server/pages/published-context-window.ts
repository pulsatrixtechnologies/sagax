// A context window the service point published on a model row. The hardcoded
// table is only the fallback when this is absent (server/context/context-budget.ts).

const KEYS = ["context_window", "context_length", "max_context_length", "max_model_len", "contextWindow"] as const;

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

/** The window a model object published, including a nested provider block. */
export function publishedContextWindow(row: unknown): number | undefined {
  if (!row || typeof row !== "object") return undefined;
  const record = row as Record<string, unknown>;
  const nested = record.top_provider;
  const sources = [record, nested && typeof nested === "object" ? nested as Record<string, unknown> : null];
  for (const source of sources) {
    if (!source) continue;
    for (const key of KEYS) {
      const found = positive(source[key]);
      if (found) return found;
    }
  }
  return undefined;
}
