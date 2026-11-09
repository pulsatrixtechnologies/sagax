import { useEffect } from "react";
import { StoreProvider } from "@/state/store";
import { shallowEqual, useStoreSelector } from "@/state/store-selector";
import { useWelcomeViewer } from "@/components/onboarding/welcome-viewer";
import { lazyScreen } from "@/components/lazy-screen";
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

// Welcome / tour / open-at-login stay off the critical startup path: the
// chat shell paints first, then these chunks load (Refs #1971). Behaviour is
// unchanged once the chunk arrives; an already-finished tour still mounts
// as a no-op gate.
const WelcomeGate = lazyScreen("WelcomeGate", async () => (await import("@/components/onboarding/WelcomeGate")).WelcomeGate);
const GuidedTour = lazyScreen("GuidedTour", async () => (await import("@/components/onboarding/GuidedTour")).GuidedTour);
const OpenAtLoginOffer = lazyScreen("OpenAtLoginOffer", async () => (await import("@/components/OpenAtLoginOffer")).OpenAtLoginOffer);

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

/** While the window draws the stored snapshot of the last launch
 * (src/lib/ui-snapshot.ts), it takes no input: no click, key, paste or drop
 * reaches the page until the server's own snapshot has replaced it, a few
 * hundred milliseconds. Nothing is drawn: the layer is transparent. */
function ProvisionalInputGuard() {
  const provisional = useStoreSelector((current) => current.provisional === true);
  useEffect(() => {
    if (!provisional) return;
    const stop = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const kinds = ["keydown", "keypress", "keyup", "beforeinput", "paste", "drop", "dragover", "contextmenu", "wheel"] as const;
    for (const kind of kinds) window.addEventListener(kind, stop, { capture: true, passive: false });
    return () => {
      for (const kind of kinds) window.removeEventListener(kind, stop, { capture: true });
    };
  }, [provisional]);
  return provisional ? <div aria-hidden="true" data-provisional-guard="" className="fixed inset-0 z-[2147483647] bg-transparent" /> : null;
}

function Application() {
  useEffect(() => {
    initAnalytics();
  }, []);
  useEffect(() => {
    const preload = () => {
      void WelcomeGate.preload().catch(() => {});
      void GuidedTour.preload().catch(() => {});
      void OpenAtLoginOffer.preload().catch(() => {});
    };
    if (typeof requestIdleCallback === "function") {
      const handle = requestIdleCallback(preload, { timeout: 2_000 });
      return () => cancelIdleCallback(handle);
    }
    const timer = setTimeout(preload, 1_000);
    return () => clearTimeout(timer);
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
          <ProvisionalInputGuard />
        </ConfirmProvider>
      </StoreProvider>
    </DesktopCapabilitiesProvider>
  );
}

export default function App() {
  return <WorkspaceBackupRecovery><Application /></WorkspaceBackupRecovery>;
}
