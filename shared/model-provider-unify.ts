// #2106: one row per model across several subscription accounts of the same
// provider family. API-key engines stay separate. Pure over the rows the
// picker already built.

export type ProviderAccessKind = "subscription" | "api";

export interface UnifyableRow {
  key: string;
  modelId?: string;
  instanceId?: string;
  current?: boolean;
}

export interface UnifyableSection<R extends UnifyableRow = UnifyableRow> {
  key: string;
  label?: string;
  note?: string;
  access?: ProviderAccessKind;
  family?: string;
  rows: R[];
}

/**
 * Collapse sibling subscription sections that share a family into one
 * section: each modelId appears once. The row kept is the current one when
 * present, else the first. API sections and sections without a family stay
 * as they are. Order: subscription families first (in first-seen order),
 * then API sections, then the rest.
 */
export function unifyProviderSections<R extends UnifyableRow, T extends UnifyableSection<R>>(
  sections: readonly T[],
): T[] {
  const top: T[] = [];
  const families = new Map<string, T>();
  const api: T[] = [];
  const rest: T[] = [];

  for (const section of sections) {
    if (!section.label) {
      top.push(section);
      continue;
    }
    if (section.access === "api") {
      api.push(section);
      continue;
    }
    if (section.family && section.access === "subscription") {
      const kept = families.get(section.family);
      if (!kept) {
        families.set(section.family, { ...section, rows: uniqueModelRows(section.rows) });
        continue;
      }
      const merged = uniqueModelRows([...kept.rows, ...section.rows]);
      families.set(section.family, { ...kept, rows: merged });
      continue;
    }
    rest.push(section);
  }

  return [...top, ...families.values(), ...api, ...rest];
}

function uniqueModelRows<R extends UnifyableRow>(rows: readonly R[]): R[] {
  const seen = new Map<string, R>();
  for (const row of rows) {
    const id = row.modelId ?? row.key;
    const prior = seen.get(id);
    if (!prior) {
      seen.set(id, row);
      continue;
    }
    if (row.current && !prior.current) seen.set(id, row);
  }
  return [...seen.values()];
}
