// #2106: Auto's Edit preference in the chat-bar model picker (Cursor-like).
// Intelligence / Balance / Cost. Absent on a selection means Balance.

export const AUTO_OPTIMIZE_VALUES = ["intelligence", "balance", "cost"] as const;
export type AutoOptimize = (typeof AUTO_OPTIMIZE_VALUES)[number];

export function isAutoOptimize(value: unknown): value is AutoOptimize {
  return typeof value === "string" && (AUTO_OPTIMIZE_VALUES as readonly string[]).includes(value);
}

/** The preference Auto uses when none is stored. */
export function autoOptimizeOf(value: unknown): AutoOptimize {
  return isAutoOptimize(value) ? value : "balance";
}
