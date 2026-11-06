// @ts-nocheck
/** mountPersonalMcp (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMountPersonalMcp(getHost: () => Host): any {
async function mountPersonalMcp(   integrations: NonNullable<SendTurnInput["integrations"]>,   input: { botId: string; threadId: string; generation: string; customMcp: boolean; principal: string | null }, ) {
  const host = getHost();

  if (host.IDENTITY.kind !== "perspicax" || !input.customMcp || !input.principal) return;
  const principalId = input.principal.trim().toLowerCase();
  let servers: Record<string, PersonalMcpServer>;
  try { servers = host.personConnections.servers(principalId); } catch { return; }
  const github = host.personGithub(principalId);
  // lot 4: a name the organization declares for this person is theirs
  // (organization > Me); mountPluginMcp mounts it next.
  const orgClaimed = host.orgCapabilities.claimedNames(principalId);
  for (const [name, server] of Object.entries(servers)) {
    // server/turns/turn-mounts.ts, shared with the capabilities resolver: off, a
    // name the turn already has, a reserved name, no environment for a
    // command, no GitHub connection or token: not mounted
    const check = personalMcpPrecheck(name, server, { taken: (taken) => Object.hasOwn(integrations.custom ?? {}, taken) || orgClaimed.has(taken), hasEnvironment: Boolean(host.userSandbox), github });
    if ("skip" in check) continue;
    if (check.mount === "stdio") {
      integrations.custom = { ...integrations.custom, [name]: host.personalStdioIntegration(input.botId, input.threadId, input.generation, principalId, name) };
      continue;
    }
    if (server.kind !== "remote") continue;
    let headers = check.headers;
    // Checked again at each mount (cached): a name that now resolves to a
    // private address is not handed to the engine on this host.
    if (await host.personalHostRefusalCached(server.url)) continue;
    if (server.auth === "oauth") {
      const manager = host.personOAuth(principalId);
      const spec = { [name]: host.personalRemoteSpec(server) };
      await manager.refreshDue(spec).catch(() => undefined);
      const signed = manager.withAuthHeaders(spec)[name]!;
      if (!("url" in signed) || !Object.keys(signed.headers).length) continue;
      headers = signed.headers;
    }
    integrations.custom = { ...integrations.custom, [name]: { type: server.type, url: server.url, headers } };
  }

}
  return mountPersonalMcp;
}
