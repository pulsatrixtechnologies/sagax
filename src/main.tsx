import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import {
  BROWSER_SIGN_IN_FAILED, previewBrowserSignIn, resolveSessionState, SERVICE_TRUST_REASON, takeBrowserSignInFromLocation, takePairingFromLocation, takeInvitedEmailFromLocation,
} from "./lib/session";
import { bootstrapBrand } from "./lib/brand";
import { applySkin, applySkinDepth, applySkinTexture, installSkinAutoFollow, readSkin, readSkinDepth, readSkinTexture } from "./lib/skins";
import { applyFont, readFont } from "./lib/fonts";
import { applyAccessibility, installAccessibility } from "./lib/accessibility-preferences";
import { installDesktopShellPreferences } from "./lib/desktop-shell-preferences";
import { migrateInterfaceModeToAdvancedOnce, retireLegacyInterfaceMode } from "./lib/interface-mode";
import { BrowserSignInPage } from "./pair/BrowserSignInPage";
import { PairPage } from "./pair/PairPage";
import { rememberOpenThreadHash } from "./lib/open-thread-hash";
import { syncUserPreferences } from "./lib/user-preferences-sync";
import { cacheSignInProfileFromSession } from "./lib/sign-in-profile-cache";
import { startPresence } from "./lib/presence";
import { startRoutineAwayBeat } from "./lib/routine-away-beat";
import { installAnimationPause } from "./lib/animation-pause";
import { installConsoleRing } from "./lib/console-ring";
import { installOverlayScrollbars } from "./lib/overlay-scrollbars";
import { syncDesktopAppearance } from "./lib/desktop-appearance-sync";
import { JoinPage, takeInviteTokenFromLocation } from "./pair/JoinPage";
import "./styles.css";

// Before the first paint, not inside a component: stamping the skin during
// render would show one frame of the default palette first. The brand (window
// title, accent) is fetched the same way so a white-labelled deployment never
// flashes the default name; it waits at most a moment and falls back silently.
// The detached Hibou 98 assistant window loads this bundle too, on its own
// query; it draws only the assistant (electron/retro-assistant-window.mjs).
const detachedAssistant = new URLSearchParams(location.search).get("omb-retro-assistant") === "1";
if (detachedAssistant) document.documentElement.dataset.retroDetached = "";
// A floating bot's desktop window loads it too, on its own query: it draws
// one bot and its balloon (electron/floating-bot-window.mjs).
const floatingBot = new URLSearchParams(location.search).get("omb-floating-bot") === "1";
if (floatingBot) document.documentElement.dataset.floatingBot = "";
// After the window flags, so a floating mascot or Hibou 98 is not paused
// just because its window is never the focused one.
installAnimationPause();
// The window's console lines, redacted, for Settings > Download logs.
installConsoleRing();
// Scrollbars draw over the content and fade when unused (styles.css).
installOverlayScrollbars();

// Slice 7: an "Open in Sagax" link survives the sign-in (/pair, Perspicax).
rememberOpenThreadHash();

// The old always-on key is not a choice. Drop it before the first paint.
retireLegacyInterfaceMode();
applySkin(readSkin());
applySkinDepth(readSkinDepth());
applySkinTexture(readSkinTexture());
// Auto (Settings > Appearance > Skin): the system's light or dark, live.
installSkinAutoFollow();
applyFont(readFont());
// Settings > Appearance > Accessibility: motion, contrast, text size.
installAccessibility();
// Hardware acceleration and spell checking, handed to the desktop shell.
installDesktopShellPreferences();

/** A pairing link lands on /pair. A remote browser without a session lands
 * there too, because every API call would otherwise fail with "pair this
 * device"; on the owner's own machine the server trusts loopback and this
 * check is a single fast request. */
async function chooseRoot(): Promise<React.ReactNode> {
  if (detachedAssistant) {
    const { DetachedAssistant } = await import("./components/retro-assistant/DetachedAssistant");
    return <DetachedAssistant />;
  }
  if (floatingBot) {
    const { FloatingBotWindow } = await import("./components/floating-bots/FloatingBotWindow");
    return <FloatingBotWindow />;
  }
  // An invite link works without a session: redeeming it is the sign-in.
  if (location.pathname === "/join") return <JoinPage initialToken={takeInviteTokenFromLocation()} />;
  if (location.pathname === "/pair") {
    // A browser sign-in link carries a one-time credential: whose server it is, then one Continue.
    const signIn = takeBrowserSignInFromLocation();
    if (signIn) {
      const preview = await previewBrowserSignIn(signIn);
      return preview ? <BrowserSignInPage credential={signIn} owner={preview.owner} /> : <PairPage initialCode={null} reason={BROWSER_SIGN_IN_FAILED} />;
    }
    const pairing = takePairingFromLocation();
    return <PairPage initialCode={pairing.code} autoSubmit={pairing.auto} initialEmail={takeInvitedEmailFromLocation()} />;
  }
  // 2026-10-20: a deploy, a restart or a provider that is slow to confirm a
  // sign-in is retried in silence; the sign-in screen only for a real end.
  const session = await resolveSessionState();
  if (session.kind === "session") {
    try {
      const res = await fetch("/api/auth/session", { credentials: "same-origin" });
      if (res.ok) cacheSignInProfileFromSession(await res.json());
    } catch {
      /* offline */
    }
  }
  if (session.kind === "unauthenticated") return <PairPage initialCode={null} reason={session.error} />;
  // A service-trust server answers this machine's requests without a session
  // but refuses to let it manage anything: sign in first, as a remote browser would.
  if (session.kind === "loopback" && session.trust === "service") return <PairPage initialCode={null} reason={SERVICE_TRUST_REASON} />;
  if (location.pathname === "/desktop-viewer") {
    const { DesktopViewer } = await import("./components/DesktopViewer");
    return <DesktopViewer />;
  }
  // The experimental Data window: one bot's Data results on their own
  // (src/components/data/DataWindow.tsx, electron/data-window.mjs).
  const dataWindow = location.pathname === "/data-window";
  // A signed-in person on an organization server: their preferences come
  // from the server before the app draws (src/lib/user-preferences-sync.ts).
  if (session.kind === "session") {
    await syncUserPreferences();
    applySkin(readSkin());
    applySkinDepth(readSkinDepth());
    applySkinTexture(readSkinTexture());
    applyFont(readFont());
    applyAccessibility();
    // online, away, offline (organization server; elsewhere the route answers
    // 404). The main window reports it; a Data window beside it does not.
    if (!dataWindow) void startPresence();
  }
  // Once per person: a stored Simple becomes Advanced (2026-10-16). After
  // the organization record above, so its marker counts and no device moves
  // the person twice; a Simple chosen afterwards stays.
  migrateInterfaceModeToAdvancedOnce();
  // The desktop app on a personal computer hands its look to the paired
  // phone (Same as my computer) and wears a look the phone chose
  // (src/lib/desktop-appearance-sync.ts). Elsewhere the route answers 404.
  if (session.kind === "loopback" && !dataWindow) void syncDesktopAppearance();
  // "Only when I'm here" routines on a solo server (src/lib/routine-away-beat.ts;
  // an organization server answers 404 and its presence is the signal).
  if ((session.kind === "loopback" || session.kind === "session") && !dataWindow) void startRoutineAwayBeat();
  if (dataWindow) {
    const { DataWindow } = await import("./components/data/DataWindow");
    return <DataWindow />;
  }
  return <App />;
}

// A floating bot's window makes no request of its own: its texts arrive translated from the main page.
void Promise.all([floatingBot ? undefined : bootstrapBrand(), chooseRoot()]).then(([, root]) => {
  createRoot(document.getElementById("root")!).render(<StrictMode>{root}</StrictMode>);
});
