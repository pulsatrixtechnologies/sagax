// @ts-nocheck
/** mcpServerNamesResponse (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMcpServerNamesResponse(getHost: () => Host): any {
function mcpServerNamesResponse(viewer?: string | null) {
  const host = getHost();

  const full = host.mcpServerResponse(viewer);
  return {
    servers: full.servers.map((server) => {
      const row = server as Record<string, unknown>;
      return {
        name: String(row.name),
        ...(typeof row.type === "string" ? { type: row.type } : {}),
        ...(typeof row.enabled === "boolean" ? { enabled: row.enabled } : {}),
        ...(typeof row.auth === "string" ? { auth: row.auth } : {}),
        ...(typeof row.source === "string" ? { source: row.source } : {}),
        ...(typeof row.managedBy === "string" ? { managedBy: row.managedBy } : {}),
        ...(typeof row.github === "string" ? { github: row.github } : {}),
        ...(row.scope === "person" || row.scope === "installation" ? { scope: row.scope } : {})
      };
    }),
    ...(full.managed ? { managed: { organizationName: full.managed.organizationName } } : {})
  };

}
  return mcpServerNamesResponse;
}
