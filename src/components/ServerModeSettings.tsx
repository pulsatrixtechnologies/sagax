// Server mode in Settings (src/lib/launch.ts, electron/environments.cjs).
// While the desktop app is locked to its organization's server, Settings >
// General's account card (settings/AccountCard.tsx) offers the one way out:
// Sign out, which signs out of the server (after a native confirmation) and
// returns to the launch screen. Sections about this computer itself say they
// are managed by the organization rather than offering a local setup.
import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { serverModeBridge } from "@/lib/launch";
import { ComputerSharingSettings } from "./ComputerSharingSettings";
import { Card, DescribedRow, PILL } from "./SettingsPrimitives";

export type ServerModeState = { active: false; personal?: boolean } | { active: true; id: string; name: string; origin: string; label?: string; orgName?: string };

/** Server mode as the desktop reports it; null in a browser, on another
 * page, and until the desktop answers. */
export function useServerMode(refresh = 0): ServerModeState | null {
  const bridge = typeof window === "undefined" ? null : serverModeBridge(window.ogb);
  const [state, setState] = useState<ServerModeState | null>(null);
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    void bridge.state().then((next) => { if (alive) setState(next); }).catch(() => {});
    return () => { alive = false; };
  }, [bridge, refresh]);
  return bridge ? state : null;
}

/** A section about this computer while its bots run on the organization's
 * server: read-only, managed there. */
export function ManagedByOrganization({ cardId, title }: { cardId: string; title: string }) {
  return (
    <Card cardId={cardId} title={title} subtitle={t("settings.serverMode.managed")}>
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-secondary">
        <Building2 size={13} aria-hidden="true" />
        {t("settings.serverMode.managedShort")}
      </span>
    </Card>
  );
}

/** Settings > Organization in server mode: what THIS computer lends the
 * organization's bots when this person asks (folders, terminal, screen
 * control), set in the desktop app and confirmed in a native dialog. Bots
 * never use the server's own machine. */
export function ServerModeComputerAccess() {
  const serverMode = useServerMode();
  const [open, setOpen] = useState(false);
  if (!serverMode?.active || !window.ogb?.computerSharing) return null;
  // 2026-11-07: the person's own computers are theirs to lend; no
  // server-wide admin switch gates them (Remote sessions > My devices).
  return (
    <div data-settings-card="organization.serverModeComputer">
      <DescribedRow
        label={t("settings.serverMode.computerTitle")}
        rowId="serverModeComputer"
        description={t("settings.serverMode.computerShort")}
        below={open && <div className="mt-2"><ComputerSharingSettings key={serverMode.id} workspace={serverMode} onClose={() => setOpen(false)} /></div>}
      >
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className={PILL}>
          {t("settings.serverMode.computerOpen")}
        </button>
      </DescribedRow>
    </div>
  );
}
