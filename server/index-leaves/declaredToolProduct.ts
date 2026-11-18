// @ts-nocheck
/** declaredToolProduct (#1388). Pure move from server/index.ts. */
import { macAppInfo, macAppOfTool } from "../../electron/mac-apps.mjs";

export type Host = Record<string, any>;

/** The app an Apple app tool acts in (mac_mail_search: Mail), with the
 * prefix its name starts with as the product id, or undefined. */
export function macAppProduct(tool: string): { product: string; productId: string } | undefined {
  const app = macAppOfTool(tool);
  const info = app ? macAppInfo(app) : null;
  return info && tool.startsWith(`mac_${app}_`) ? { product: info.name, productId: `mac_${app}` } : undefined;
}

export function createDeclaredToolProduct(getHost: () => Host): any {
function declaredToolProduct(botId: string | undefined, name: string, input?: string): { product: string; productId: string } | undefined {
  const host = getHost();

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
  // An Apple app tool of the person's Mac (mac_mail_search) is served by the
  // Messages server: its step names its own app (Mail), never "Messages".
  const macApp = macAppProduct(parts.at(-1) ?? "");
  if (macApp) return macApp;
  if (!botId || !host.perspicaxMcp) return undefined;
  for (const candidate of parts.slice(0, -1).reverse()) {
    const declared = host.perspicaxMcp.apiName(botId, candidate);
    if (declared) return { product: declared, productId: candidate };
  }
  return undefined;

}
  return declaredToolProduct;
}
