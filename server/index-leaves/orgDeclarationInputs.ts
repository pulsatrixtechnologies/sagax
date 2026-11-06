// @ts-nocheck
/** orgDeclarationInputs (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOrgDeclarationInputs(getHost: () => Host): any {
function orgDeclarationInputs(principal: string | undefined) {
  const host = getHost();

  if (host.IDENTITY.kind !== "perspicax") return [];
  const person = principal?.trim().toLowerCase();
  const mounts = new Map(host.orgCapabilityMounts(person).map((mount) => [mount.view.id, mount] as const));
  const label = "Perspicax";
  return host.orgCapabilities.views().map((view) => {
    const mount = mounts.get(view.id);
    return {
      id: view.id, mount: view.mount, form: view.form, name: view.name, ...(view.description ? { description: view.description } : {}),
      mode: view.mode, enabled: view.enabled, member: Boolean(person) && host.orgMemberActive(person!),
      active: Boolean(person) && host.orgCapabilities.activeFor(view, person),
      installState: view.state, ...(view.version ? { version: view.version } : {}), sourceLabel: label,
      ...(mount?.dir ? { dir: mount.dir } : {}), ...(mount?.contents ? { contents: mount.contents } : {}),
      mcpServers: mount ? Object.keys(mount.mcpServers) : view.form === "mcp" ? [view.mount] : []
    };
  });

}
  return orgDeclarationInputs;
}
