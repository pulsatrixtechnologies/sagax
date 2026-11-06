// @ts-nocheck
/** mcpServerSummary (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMcpServerSummary(getHost: () => Host): any {
function mcpServerSummary(name: string): { transport?: string; url?: string; command?: string; valueNames: string[] } | undefined {
  const host = getHost();

  const raw = (host.cfg.mcpServers ?? {})[name];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const spec = raw as Record<string, unknown>;
  const names = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).slice(0, 50) : [];
  let url: string | undefined;
  if (typeof spec.url === "string") {
    try {
      const parsed = new URL(spec.url);
      url = `${parsed.origin}${parsed.pathname}`;
    } catch { url = undefined; }
  }
  return {
    ...(typeof spec.type === "string" ? { transport: spec.type.slice(0, 20) } : url ? { transport: "http" } : typeof spec.command === "string" ? { transport: "stdio" } : {}),
    ...(url ? { url } : {}),
    ...(typeof spec.command === "string" ? { command: spec.command.split(/[\\/]/).pop()!.slice(0, 200) } : {}),
    valueNames: [...names(spec.headers), ...names(spec.env)]
  };

}
  return mcpServerSummary;
}
