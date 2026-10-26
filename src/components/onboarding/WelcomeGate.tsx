// Decides what first run looks like for whoever opened the app. The desktop
// app's own window is the owner of its own server and gets the welcome flow
// exactly as before, without waiting on anything new. Any other page (a
// browser, or a hosted workspace the desktop app opened with its reduced
// bridge) asks its server who it is first. A hosted workspace's admin gets
// the hosted beats and a hosted member a quiet note. A Cloud home opens on
// its engine sign-in (CloudEngineSignIn) rather than this flow. A session
// that cannot save the workspace config is never shown a tour it could not
// finish.
//
// On the desktop app's own window, the launch screen (no server or server,
// src/lib/launch.ts) comes first on a first run, and again after server mode
// was left (Settings > General > Server > Change). Settings and the tour's
// server row open it on request.
import { useEffect, useState } from "react";
import { emailGateDone } from "@/lib/analytics";
import { launchBridges, launchDue, serverModeBridge } from "@/lib/launch";
import { hostedMember, LOCAL_VIEWER, welcomeDue, welcomeViewer, type WelcomeViewer } from "@/lib/onboarding";
import type { FirstRunStep } from "@/lib/first-run";
import { api, useStore } from "@/state/store";
import { OrgEngineSetupGate } from "@/components/OrgEngineSetup";
import { GuidedFirstRun } from "./GuidedFirstRun";
import { LaunchScreen } from "./LaunchScreen";
import { SharedWorkspaceHint } from "./SharedWorkspaceHint";
import { WelcomeFlow } from "./WelcomeFlow";

/** Only the desktop app's own pages get the full bridge; `remoteClient` is
 * part of it. A remote page the desktop app loads (Server → Connect hosted
 * workspace…) gets a reduced, still truthy `window.ogb` without it, and is
 * no more the owner than a browser is. */
export function localDesktopPage(): boolean {
  return window.ogb?.remoteClient !== undefined;
}

/** Null while the answer is on its way. The desktop app's own page knows at
 * once: its own server's owner, or a remote client, which never gets a
 * first-run surface anyway. A failed answer keeps the old behaviour. */
export function useWelcomeViewer(): WelcomeViewer | null {
  const local = localDesktopPage();
  const [viewer, setViewer] = useState<WelcomeViewer | null>(local ? LOCAL_VIEWER : null);
  useEffect(() => {
    if (local) return;
    let active = true;
    void api("/api/auth/session", { timeoutMs: 10_000 })
      .then((session) => {
        if (active) setViewer(welcomeViewer(session));
      })
      .catch(() => {
        if (active) setViewer(LOCAL_VIEWER);
      });
    return () => {
      active = false;
    };
  }, [local]);
  return viewer;
}

/** Opens the welcome flow on a fresh workspace (the server's onboarding
 * record says so) or on request from Settings. The decision waits for the
 * config to arrive, so a returning user never sees the tour flash. */
export function WelcomeGate({ viewer }: { viewer: WelcomeViewer | null }) {
  const { state, dispatch } = useStore();
  const [dismissed, setDismissed] = useState(false);
  // Set when the engines beat's server row opened the launch screen, so
  // choosing no server there brings the person back to that beat rather
  // than the greeting.
  const [resumeAt, setResumeAt] = useState<FirstRunStep | undefined>(undefined);
  // Set once "No server" was chosen this visit, so the tour never
  // waits on that choice being saved.
  const [launchChosen, setLaunchChosen] = useState(false);
  // Whether the desktop is in server mode; null until it answers.
  const [serverMode, setServerMode] = useState<boolean | null>(null);
  const bridges = viewer && !viewer.hosted ? launchBridges(window.ogb) : null;
  const serverModeState = bridges ? serverModeBridge(window.ogb) : null;
  useEffect(() => {
    if (!serverModeState) return;
    let active = true;
    void serverModeState
      .state()
      .then((state) => {
        if (active) setServerMode(state.active);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [serverModeState]);
  const remoteClient = window.ogb?.remoteClient?.active === true;
  if (!viewer) return null;
  // Only a hosted workspace is a team's by definition. Elsewhere a session
  // without admin scope is often the owner's own phone or browser, so it
  // gets no new note: the tour it cannot save simply does not open itself.
  if (hostedMember(viewer)) {
    return remoteClient ? null : (
      <SharedWorkspaceHint
        replay={state.welcomeOpen}
        onClose={() => {
          if (state.welcomeOpen) dispatch({ type: "toggleWelcome", open: false });
        }}
      />
    );
  }
  const due =
    !dismissed &&
    welcomeDue(state.config, {
      remoteClient,
      legacyDone: emailGateDone(),
      hosted: viewer.hosted,
      canSave: viewer.canSave,
      cloudHome: viewer.cloudHome,
    });
  if (bridges && state.launchOpen) {
    return (
      <LaunchScreen
        bridges={bridges}
        initialMode={state.launchMode}
        onSolo={() => {
          setLaunchChosen(true);
          dispatch({ type: "toggleLaunch", open: false });
        }}
      />
    );
  }
  const launchMode = state.config?.onboarding?.launchMode;
  if (bridges && !launchChosen && launchDue(state.config, { welcomeDue: due, serverMode })) {
    return (
      <LaunchScreen
        bridges={bridges}
        initialMode={launchMode === "server" ? "server" : "solo"}
        onSolo={() => setLaunchChosen(true)}
      />
    );
  }
  // Explicit desktop connection Settings need no local provider onboarding.
  // Organisation remains optional; closing Settings resumes the normal tour.
  if (state.appSettingsOpen && state.appSettingsSection === "organization") return null;
  // On an organization server, a person with no engine that answers them
  // gets the step to connect their own (OrgEngineSetup.tsx): a member, who
  // never gets the welcome flow, and an admin once it is done.
  if (!state.welcomeOpen && !due) return <OrgEngineSetupGate />;
  const replay = state.welcomeOpen && !due;
  const dismiss = () => {
    setDismissed(true);
    setResumeAt(undefined);
    dispatch({ type: "toggleWelcome", open: false });
  };
  // A hosted team workspace keeps the managed welcome flow: its organization
  // assigns the models, so the connect-an-engine / create-a-bot guide does not
  // apply, and the hosted greeting (read-only name and email) still stands.
  if (viewer.hosted) {
    const bot = state.bots.find((b) => !b.hidden) ?? null;
    return (
      <WelcomeFlow
        bot={bot}
        replay={replay}
        hosted
        profileManaged={viewer.profileManaged}
        onDone={() => {
          dismiss();
          // the first real finish hands over to the guided tour; a replay does not
          if (!replay) dispatch({ type: "toggleTour", open: true });
        }}
      />
    );
  }
  // Everyone else gets the guided first run: connect an engine, create the
  // first bot, send the first message. One dedicated, dismissible guide over
  // the existing screens, never a widget inside the conversation.
  return (
    <GuidedFirstRun
      replay={replay}
      initialStep={resumeAt}
      onOpenServer={() => {
        setResumeAt("engine");
        dispatch({ type: "toggleLaunch", open: true, mode: "server" });
      }}
      onDone={dismiss}
    />
  );
}
