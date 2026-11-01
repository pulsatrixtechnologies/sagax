// The sidebar's foot (owner, 2026-10-27): the same row as the profile row of the
// reference design, one state at every width:
//   - the avatar and the FULL name, normal weight, no background pill (it
//     opens the account menu, as before);
//   - to the right, a separate round button with the apps grid icon, which
//     opens Connect apps. The apps that are connected are only a discreet
//     dot on it and the list in its tooltip (no overlapping logos);
//   - a waiting update is the same kind of round button beside it.
// No hover animation and no stacked state: the name is cut only when the row
// really has no room left for it.
import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { api, useStore } from "@/state/store";
import { connectedAppItems, type AccountConnector } from "@/lib/connected-apps";
import type { PluginItem } from "@/lib/plugins-model";
import { SidebarProfileMenu, SidebarRoutinesBadge } from "./SidebarProfileMenu";
import type { SidebarMenuItem } from "./SidebarPopoverMenu";
import { SidebarUpdatePill } from "./SidebarUpdatePill";

/** The connected apps, read from the same routes as the Connect apps panel
 * (its MCP servers, its catalog, and the Providers list's connectors of the
 * person's own Claude account); read again each time that panel closes
 * (what was just connected shows). The account's connectors can take a while
 * (the engine is asked): the servers show first, the connectors join them. */
export function useConnectedApps(): PluginItem[] {
  const { state } = useStore();
  const [apps, setApps] = useState<PluginItem[]>([]);
  const panelOpen = state.pluginsOpen;
  useEffect(() => {
    if (panelOpen) return;
    let cancelled = false;
    let servers: { servers?: unknown; featured?: unknown } = {};
    let account: AccountConnector[] = [];
    const publish = () => {
      if (cancelled) return;
      setApps(connectedAppItems({
        servers: (servers.servers as Parameters<typeof connectedAppItems>[0]["servers"]) ?? [],
        featured: (servers.featured as Parameters<typeof connectedAppItems>[0]["featured"]) ?? [],
        account,
      }));
    };
    void Promise.all([
      api("/api/mcp/servers").catch(() => null),
      api("/api/plugins/search").catch(() => null),
    ]).then(([mcp, search]) => {
      servers = { servers: mcp?.servers ?? [], featured: search?.featured ?? [] };
      publish();
    });
    void api(HARNESS_CONNECTORS_ROUTE, { timeoutMs: 90_000 }).then((answer) => {
      account = answer?.claude?.available && Array.isArray(answer.claude.connectors) ? answer.claude.connectors : [];
      publish();
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [panelOpen]);
  return apps;
}

/** The connectors of the person's own Claude account (server/harness-connectors.ts). */
const HARNESS_CONNECTORS_ROUTE = "/api/me/harness-connectors";

/** The apps grid of the foot's round button: three squares and a plus. */
export function AppsGridIcon({ size = 18 }: { size?: number }) {
  return (
    <svg data-apps-grid-icon="" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M17.5 14v7M14 17.5h7" />
    </svg>
  );
}

/** The foot's round Connect apps button: the apps grid on a quiet dark
 * circle. The connected apps are the tooltip's list and a small dot. */
export function FootConnectApps({ apps, onOpen }: { apps: readonly PluginItem[]; onOpen: () => void }) {
  const label = t("chat.connectApps.pill");
  const title = apps.length > 0 ? `${label} (${apps.map((app) => app.name).join(", ")})` : label;
  return (
    <button
      type="button"
      data-tour="nav-apps"
      data-sidebar-connect-apps=""
      data-connected-count={apps.length}
      onClick={onOpen}
      aria-label={label}
      title={title}
      className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-sidebar-card text-sidebar-ink-secondary outline-none transition-colors hover:bg-sidebar-elevated-hover hover:text-sidebar-ink focus-visible:ring-2 focus-visible:ring-focus"
    >
      <AppsGridIcon />
      {apps.length > 0 && (
        <span data-connected-dot="" aria-hidden="true" className="absolute right-1 top-1 size-1.5 rounded-full bg-accent" />
      )}
    </button>
  );
}

export function SidebarFoot({ places, onOpenApps }: { places?: SidebarMenuItem[]; onOpenApps: () => void }) {
  const apps = useConnectedApps();
  return (
    <div data-sidebar-account-row className="-mx-1.5 flex items-center gap-1.5">
      <SidebarProfileMenu avatarOnly withName places={places} />
      {/* a waiting update: the same kind of round button, beside the grid */}
      <SidebarUpdatePill layout="compact" />
      <FootConnectApps apps={apps} onOpen={onOpenApps} />
      <SidebarRoutinesBadge />
    </div>
  );
}

/** The rail's foot (icons density, chosen or automatic at medium widths):
 * the wide foot's row stacked in the 80px column. The same pieces, so
 * nothing the wide foot reaches is lost: a waiting update and the active
 * routines (each only when there is one), the round apps-grid button, then
 * the avatar (its menu holds Settings, Approvals, Code and the rest). The
 * name has no room; it is the avatar's accessible name and tooltip. */
export function SidebarRailFoot({ places, onOpenApps }: { places?: SidebarMenuItem[]; onOpenApps: () => void }) {
  const apps = useConnectedApps();
  return (
    <>
      <div data-sidebar-rail-foot="" className="flex flex-col items-center gap-2 pt-1">
        <SidebarUpdatePill layout="compact" />
        <SidebarRoutinesBadge />
        <FootConnectApps apps={apps} onOpen={onOpenApps} />
      </div>
      <div data-sidebar-account-rail="" className="flex h-10 items-center justify-center">
        <SidebarProfileMenu avatarOnly places={places} />
      </div>
    </>
  );
}
