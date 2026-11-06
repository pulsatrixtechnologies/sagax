// @ts-nocheck
/** configForPerson (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createConfigForPerson(getHost: () => Host): any {
function configForPerson<T extends Parameters<typeof configForViewer>[0]>(status: T, viewer: ViewerIdentity | null): T & { viewer?: ViewerIdentity } {
  const host = getHost();
  let shown = host.configForViewer(status, viewer);
  // #2054: a member only sees their own named OpenAI-compatible servers
  // plus org-wide ones; another person's stay out of Settings.
  if (host.IDENTITY.kind === "perspicax" && shown && typeof shown === "object" && "openaiCompatServers" in shown) {
    const admin = Boolean((viewer as { orgAdmin?: boolean } | null)?.orgAdmin) || viewer?.role === "admin";
    shown = {
      ...shown,
      openaiCompatServers: host.compatServers(host.cfg, {
        principalId: viewer?.principalId?.trim().toLowerCase() || null,
        admin,
      }),
    };
  }
  const owner = host.personSettingsOwner(viewer?.principalId);
  if (!owner) return shown;
  const own = host.personSettings.get(owner);
  const base = shown as unknown as { features?: Record<string, unknown>; browserProfiles?: unknown[] };
  return {
    ...shown,
    personalSettings: true,
    // 2026-10-30 (lot 2): the person's own model switches
    myDisabledModels: own.disabledModels ?? [],
    features: { ...base.features, ...own.features },
    browserProfiles: [...(base.browserProfiles ?? []), ...own.browserProfiles.map((profile) => ({ ...profile, personal: true }))]
  };
}
  return configForPerson;
}
