// Schema helpers of the agents catalog, imported by the tool definition
// files. Never import server/index.ts.

/** #4518: a schema whose field texts another tool of the same catalog
 * already sends (propose_routine_action's changes are propose_routine's
 * fields, update_artifact's are save_artifact's): the same shape, types,
 * enums and limits, without the repeated `description` strings. The tool
 * that keeps them is always listed beside it (agents-catalog-budget.test.ts). */
export function withoutFieldDescriptions<T>(schema: T): T {
  if (Array.isArray(schema)) return schema.map((entry) => withoutFieldDescriptions(entry)) as T;
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(Object.entries(schema)
    .filter(([key, value]) => !(key === "description" && typeof value === "string"))
    .map(([key, value]) => [key, withoutFieldDescriptions(value)])) as T;
}
