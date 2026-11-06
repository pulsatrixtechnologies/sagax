// @ts-nocheck
/** declaredToolProduct (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDeclaredToolProduct(getHost: () => Host): any {
function declaredToolProduct(botId: string | undefined, name: string, input?: string): { product: string; productId: string } | undefined {
  const host = getHost();

  if (!botId || !host.perspicaxMcp) return undefined;
  let inner = name.replace(/^mcp__/, "");
  // pi's `mcp` gateway and Grok's use_tool name the tool in their input
  const meta = name.trim().toLowerCase().replace(/\s+/g, "_");
  if ((meta === "mcp" || meta === "use_tool") && input) {
    try {
      const args = JSON.parse(input) as { tool?: unknown; tool_name?: unknown };
      const tool = meta === "mcp" ? args.tool : args.tool_name;
      if (typeof tool === "string") inner = tool;
    } catch {
      // not JSON: the name alone
    }
  }
  const parts = inner.split("__").filter(Boolean);
  for (const candidate of parts.slice(0, -1).reverse()) {
    const declared = host.perspicaxMcp.apiName(botId, candidate);
    if (declared) return { product: declared, productId: candidate };
  }
  return undefined;

}
  return declaredToolProduct;
}
