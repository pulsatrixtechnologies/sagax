import { useEffect } from "react";
import { StoreProvider } from "@/state/store";
import { shallowEqual, useStoreSelector } from "@/state/store-selector";
import { useWelcomeViewer, WelcomeGate } from "@/components/onboarding/WelcomeGate";
import { GuidedTour } from "@/components/onboarding/GuidedTour";
import { OpenAtLoginOffer } from "@/components/OpenAtLoginOffer";
import { LiveCallHost } from "@/components/LiveCallHost";
import { ThreadRefsProvider } from "@/components/ThreadRefs";
import { initAnalytics } from "@/lib/analytics";
import { WorkspaceBackupRecovery } from "@/components/workspace-backup-recovery";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { DesktopCapabilitiesProvider } from "@/components/DesktopCapabilities";
import { DataWindowViewSync } from "@/components/DataWindowButton";
import { MAUS_COLORS } from "@/lib/mascot";
import { botSwitchActive, useBotAccent, useBotAccentEnabled, useBotSwitch } from "@/lib/bot-accent";
import { usePageLookSync } from "@/lib/page-look-sync";
import { useShellNavigation } from "./App.tsx-parts/useShellNavigation";
import { useShellEffects } from "./App.tsx-parts/useShellEffects";
import { ShellLayout } from "./App.tsx-parts/ShellLayout";

export function Shell() {
  const shell = useShellNavigation();
  useShellEffects(shell);
  return <ShellLayout {...shell} />;
}

/** The person's look, for the bar and the frame of their published pages
 * (src/lib/page-look-sync.ts). */
function PageLookSync() {
  const connected = useStoreSelector((current) => current.connected);
  usePageLookSync(connected);
  return null;
}

/** The open bot's colour as the accent, when Settings > Appearance says so. */
function BotAccentSync() {
  const state = useStoreSelector((current) => ({ activeView: current.activeView, appSettingsOpen: current.appSettingsOpen, pluginsOpen: current.pluginsOpen }), shallowEqual);
  const colorKey = useStoreSelector((current) => current.bots.find((candidate) => candidate.id === current.selectedId)?.color);
  const color = colorKey ? MAUS_COLORS[colorKey] : null;
  useBotAccent(color);
  const accentEnabled = useBotAccentEnabled();
  // The switches in the bot's own panel and screens take its colour, setting or not.
  useBotSwitch(
    color,
    botSwitchActive({ hasBot: Boolean(colorKey), activeView: state.activeView, appSettingsOpen: state.appSettingsOpen, pluginsOpen: state.pluginsOpen, accentEnabled }),
  );
  return null;
}

function Application() {
  useEffect(() => {
    initAnalytics();
  }, []);
  const viewer = useWelcomeViewer();
  return (
    <DesktopCapabilitiesProvider>
      <StoreProvider>
        <ConfirmProvider>
          <ThreadRefsProvider>
            <Shell />
          </ThreadRefsProvider>
          <WelcomeGate viewer={viewer} />
          <GuidedTour />
          <OpenAtLoginOffer />
          <LiveCallHost />
          <DataWindowViewSync />
          <BotAccentSync />
          <PageLookSync />
        </ConfirmProvider>
      </StoreProvider>
    </DesktopCapabilitiesProvider>
  );
}

export default function App() {
  return <WorkspaceBackupRecovery><Application /></WorkspaceBackupRecovery>;
}
