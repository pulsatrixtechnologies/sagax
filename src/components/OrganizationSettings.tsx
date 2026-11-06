import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { api, ApiError, useStore } from "@/state/store";
import { ConnectedWorkspacesSettings } from "./ConnectedWorkspacesSettings";
import { RemoteComputerSection } from "./RemoteComputerSection";
import { CustomDomainSettings } from "./CustomDomainSettings";
import { PerspicaxOrgSettings } from "./PerspicaxOrgSettings";
import { ConnectServerWizard } from "./ConnectServerWizard";
import { OrgDirectory, type OrgPersonView, type PendingInviteView } from "./OrgDirectory";
import type { OrgRole } from "../../shared/org-role";
import { isPerspicaxOrg, type PerspicaxOrg } from "@/lib/perspicax-org";
import { OrgMemorySettings } from "./OrgMemorySettings";
import { SettingsGroup } from "./SettingsPrimitives";
import { OrganizationBotRows } from "./settings/OrganizationBotRules";

type ServerInvites = { org: { name: string }; people: OrgPersonView[]; pendingInvites: PendingInviteView[]; viewerRole?: OrgRole | null };

/** A solo server's invitations to its own sign-in list (GET /api/org/invites,
 * admin only): invite by email, the people who may sign in, and the
 * pending links. Not an organization: nothing to create or move. Renders
 * nothing where the route is refused (a member, an organization server). */
function ServerInvitesDirectory() {
  const [data, setData] = useState<ServerInvites | null>(null);
  const [lastInvite, setLastInvite] = useState<{ email: string; link?: string } | null>(null);
  const [error, setError] = useState("");
  const load = async (alive = () => true) => {
    try {
      const body = await api<ServerInvites>("/api/org/invites");
      if (alive()) setData({ org: { name: body.org?.name ?? "" }, people: body.people ?? [], pendingInvites: body.pendingInvites ?? [], viewerRole: body.viewerRole });
    } catch {
      if (alive()) setData(null);
    }
  };
  useEffect(() => {
    let cancelled = false;
    void load(() => !cancelled);
    return () => { cancelled = true; };
  }, []);
  if (!data) return null;
  const canManage = data.viewerRole === undefined || data.viewerRole === "owner" || data.viewerRole === "admin";
  if (!canManage) return null;
  return (
    <>
      <OrgDirectory
        org={{ name: data.org.name }}
        people={data.people}
        pendingInvites={data.pendingInvites}
        canManage
        lastInvite={lastInvite}
        onCreate={() => {}}
        onInvite={async (email) => {
          try {
            const issued = await api<{ invite?: { email?: string }; link?: string }>("/api/org/invites", { method: "POST", body: JSON.stringify({ email }) });
            setLastInvite({ email: issued.invite?.email ?? email, link: issued.link });
            setError("");
            await load();
          } catch (cause) {
            setError(t("org.inviteFailed"));
            throw cause;
          }
        }}
        onRevoke={async (token) => {
          try {
            await api(`/api/org/invites/${encodeURIComponent(token)}/revoke`, { method: "POST", body: "{}" });
            setLastInvite((current) => (current?.link?.endsWith(`token=${encodeURIComponent(token)}`) ? null : current));
            await load();
          } catch {
            setError(t("org.revokeFailed"));
          }
        }}
      />
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
    </>
  );
}

/** Settings → Organization (#2080 L3). Same page for everyone on Perspicax
 * (OrgBand + read-only rules). Solo: Server, people, bot rules (advanced),
 * memory. "This computer" access moved to Computer. */
export function OrganizationSettings({ memoryShown = false }: { advanced?: boolean; memoryShown?: boolean } = {}) {
  const { state: store } = useStore();
  const remoteActive = window.ogb?.remoteClient?.active === true;
  const [orgReady, setOrgReady] = useState(false);
  const [directoryError, setDirectoryError] = useState("");
  const [servers, setServers] = useState<{ activeId: string; count: number; activeName?: string } | null>(null);
  const [perspicaxOrg, setPerspicaxOrg] = useState<PerspicaxOrg | null>(null);

  const loadOrg = async (alive = () => true) => {
    try {
      const body = await api<unknown>("/api/org");
      if (!alive()) return;
      if (isPerspicaxOrg(body)) setPerspicaxOrg(body);
      setOrgReady(true);
      setDirectoryError("");
    } catch (error) {
      if (!alive()) return;
      if (error instanceof ApiError && error.status === 404) {
        setOrgReady(true);
        setDirectoryError("");
        return;
      }
      setDirectoryError(t("org.loadFailed"));
    }
  };

  useEffect(() => {
    let cancelled = false;
    void loadOrg(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(window.ogb?.environments?.state()).then((next) => {
      if (next && !cancelled) {
        const active = next.environments.find((entry) => entry.id === next.activeId);
        setServers({ activeId: next.activeId, count: next.environments.length, activeName: active?.name || active?.label });
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const connectedToAnotherServer = remoteActive || (servers ? servers.activeId !== "local" : false);
  const hasSavedServers = (servers?.count ?? 0) > 0;
  const showJoinOnly = !hasSavedServers && !connectedToAnotherServer;
  const serverState = connectedToAnotherServer
    ? t("servers.state.linked", { name: servers?.activeName || t("settings.servers.unnamed") })
    : t("servers.state.local");

  const memory = memoryShown ? (
    <SettingsGroup title={t("organization.group.memory")} groupId="organizationMemory">
      <OrgMemorySettings />
    </SettingsGroup>
  ) : null;

  if (perspicaxOrg) {
    return (
      <>
        <PerspicaxOrgSettings org={perspicaxOrg} onChanged={() => loadOrg()} />
        {memory}
      </>
    );
  }

  // Solo: Connect a server stays closed by default (#2080). This computer
  // access lives on Computer now.
  return <>
    {orgReady && (
      <SettingsGroup plain title={t("organization.group.server")} groupId="servers" accessory={<span className="min-w-0 truncate text-[13px] leading-[18px] text-ink-secondary">· {serverState}</span>}>
        {!showJoinOnly && <ConnectedWorkspacesSettings />}
        {remoteActive && <RemoteComputerSection />}
        <ConnectServerWizard defaultOpen={false} />
        {!remoteActive && store.config?.viewer?.operator !== false && <CustomDomainSettings />}
      </SettingsGroup>
    )}
    {orgReady && !remoteActive && <ServerInvitesDirectory />}
    {directoryError && <p role="alert" className="text-[13px] text-danger">{directoryError}</p>}
    <SettingsGroup advanced title={t("organization.group.botRules")} groupId="organizationBots">
      <OrganizationBotRows />
    </SettingsGroup>
    {memory}
  </>;
}
