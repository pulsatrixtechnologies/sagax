// The bot's computer, in the right-side slot. Where it runs decides the
// whole flow: explicit cloud → provision the boat on open (idempotent) and preview
// via SSE frames or a ~4s screenshot poll. macOS local mode keeps the legacy
// in-panel capture. Linux local mode is an automation readiness state and its
// separate preview remains explicitly user-initiated. Auto only reads an
// existing Boat's state: opening this panel never creates, wakes, bootstraps
// or opens one. A conversation's selected surface owns its preview;
// its profile default owns lifecycle actions and the Works on picker.
// An inherited team Boat is shown as a shared resource, managed from Team map;
// it must never fall back to this host or become a private Cloud selection.
import { useState } from "react";
import { Globe, Monitor } from "lucide-react";
import type { Bot } from "@/state/store";
import { useCaptionChrome } from "@/components/DesktopCapabilities";
import { useAndroidUsbDevices } from "./AndroidDevicePanel";
import { openPlaceAction } from "@/lib/place-view";
import type { PlaceActionId } from "../../shared/place-view";
import { t } from "@/lib/i18n";
import { requestSettingsCard } from "./SettingsPrimitives";
import { BrowserScreen, OrgComputerTab, ScreenPicker } from "./computer/OrgComputerTab";
import { BrowserPanel } from "./BrowserPanel";
import { BotRemoteHostsSection } from "./remote-session/BotRemoteHostsSection";
import { LocalComputerAutoWarning } from "./LocalComputerAutoWarning";
import { RoutinesSection } from "./bot-settings/RoutinesSection";

import { usePanelResize } from "./ComputerPanel.tsx-parts/usePanelResize";
import { useComputerPanelSession } from "./ComputerPanel.tsx-parts/useComputerPanelSession";
import { useComputerPreview } from "./ComputerPanel.tsx-parts/useComputerPreview";
import { useComputerControl } from "./ComputerPanel.tsx-parts/useComputerControl";
import { useComputerActions } from "./ComputerPanel.tsx-parts/useComputerActions";
import { useRemoteHosts } from "./ComputerPanel.tsx-parts/useRemoteHosts";
import { ComputerDeviceBody } from "./ComputerPanel.tsx-parts/DeviceBody";
import { ComputerPanelChrome } from "./ComputerPanel.tsx-parts/PanelChrome";
import { buildComputerMoreItems } from "./ComputerPanel.tsx-parts/buildMoreItems";
import { buildPlaceViews } from "./ComputerPanel.tsx-parts/buildPlaceViews";

export function ComputerPanel({
  bot: profileBot,
  onOpenVmWorkspace,
  embedded = false,
}: {
  bot: Bot;
  onOpenVmWorkspace?: (botId: string) => void;
  /** Rendered as the Computer tab of the bot panel: no column of its own,
   * no header or resize handle, just the body. */
  embedded?: boolean;
}) {
  // Docked flush under the Windows caption corner: drop the header 16px.
  const { padClass } = useCaptionChrome();
  const {
    panelWidth, separatorRef, separatorWidth,
    onResizeStart, onResizeMove, onResizeEnd, onSeparatorKeyDown,
  } = usePanelResize();
  const session = useComputerPanelSession(profileBot);
  const {
    state, dispatch, livePlace, browserOffered, soloView, setSoloView,
    autoSurface, autoSurfaceCurrent, bot, viewerConnectionKey, viewerConnection,
    desktopJoin, threadPath, canManageCloud, canManageVm, editComputer, manageKeys,
    isLinux, localSelectable, localAutoWarningTarget, setLocalAutoWarningTarget,
    localDisabledReason, placeSeat, phase, setPhase, setResolvedComputerSelection,
    cloudBackend, computerStatusCurrent, currentTeamComputer, cloudPreviewReady,
    boatState, setBoatState, polledFrame, setPolledFrame, previewError, setPreviewError,
    previewRefreshing, setPreviewRefreshing, previewRetry, setPreviewRetry,
    vmFrame, setVmFrame, vmViewerUrl, vmStatus, setVmStatus, vpsStatus, setVpsStatus,
    localFrame, setLocalFrame, pending, setPending, controlPending, setControlPending,
    viewerOpen, error, setError, setRetry, vmResumable, vmReadinessAttempts,
    vmActionController, bridgeStatus, botRoutines, cloudRoutineReady,
  } = session;

  const androidStatus = useAndroidUsbDevices();
  const androidConnected = androidStatus.devices.length > 0;
  const [localMisses, setLocalMisses] = useState(0);
  const { lastLiveAt, frameSrc, previewOpensDesktop } = useComputerPreview({
    botId: bot.id,
    botThreadId: bot.threadId,
    botBusy: bot.busy,
    botComputer: bot.computer,
    phase,
    cloudPreviewReady,
    computerStatusCurrent,
    cloudBackend,
    viewerOpen,
    pending,
    controlPending,
    previewRetry,
    isLinux,
    vmViewerUrl,
    polledFrame,
    vmFrame,
    localFrame,
    threadPath,
    setPolledFrame,
    setPreviewError,
    setPreviewRefreshing,
    setVmFrame,
    setLocalFrame,
    setLocalMisses,
    setError,
  });

  const control = state.computerControl[bot.id] ?? { held: false, helpReason: null };
  const { controlAction, openDesktop } = useComputerControl({
    bot,
    control,
    cloudPreviewReady,
    cloudBackend,
    vmViewerUrl,
    viewerConnection,
    viewerConnectionKey,
    desktopJoin,
    threadPath,
    dispatch,
    setPending,
    setControlPending,
    setError,
  });

  const { run, startCloudComputer, runVmAction, replaceVpsComputer } = useComputerActions({
    bot,
    cloudBackend,
    canManageCloud,
    vmStatus,
    threadPath,
    vmActionController,
    vmReadinessAttempts,
    setPending,
    setError,
    setBoatState,
    setResolvedComputerSelection,
    setPhase,
    setVmStatus,
    setVpsStatus,
    setRetry,
  });

  // Organization server (a desktop bridge status exists): the computer is
  // the person's server environment or their own PC, never this bot's own
  // (src/components/computer/OrgComputerTab.tsx). Enrolled hosts attached
  // to this bot appear as places (2026-11-01).
  const {
    activeRemoteSessions, remoteHostRows, reloadRemoteHosts, reloadRemoteSessions, onPickRemoteHost,
  } = useRemoteHosts(bot.id, bridgeStatus);

  const openVmSettings = () => {
    window.sessionStorage.setItem("openmausbot.settings.section", "computer");
    dispatch({ type: "toggleAppSettings", open: true });
  };

  const openConnectionSettings = () => {
    requestSettingsCard("connections.integrations");
    dispatch({ type: "toggleAppSettings", open: true, section: "connections" });
  };

  const { errorText, busyBoat, cloudRefused, cloudView, autoView, emptyState } = buildPlaceViews({
    bot,
    profileBotBusy: profileBot.busy,
    boatState,
    computerStatusCurrent,
    livePlace,
    cloudBackend,
    phase,
    error,
    placeSeat,
    config: state.config,
    instances: state.instances,
    localSelectable,
    localDisabledReason,
    currentTeamComputer,
    boxIncluded: state.config?.box?.included,
  });

  /** A place's action from inside this panel: what the panel holds itself
   * (start, wake, try again, Local VM setup) runs here; anything else opens
   * where it is changed. */
  const runPlaceAction = (id: PlaceActionId) => {
    if (id === "start" || id === "wake") return startCloudComputer();
    if (id === "try-again") return setRetry((n) => n + 1);
    if (id === "open-vm-settings") return openVmSettings();
    openPlaceAction(id, { botId: profileBot.id, threadId: profileBot.threadId }, dispatch);
  };
  /** Whether this panel offers the action: not one it already is (watching,
   * the panel itself), and a start or wake only for this bot's own chosen
   * cloud computer while no turn holds it. */
  const panelOffers = (id: PlaceActionId | undefined): id is PlaceActionId => Boolean(id) && id !== "watch" && id !== "open-computer-panel"
    && ((id !== "start" && id !== "wake") || (canManageCloud && !profileBot.busy));

  // Screen and Browser on a solo server, when it has the built-in browser.
  const soloPicker = browserOffered ? (
    <div className="mt-2 flex justify-center">
      <ScreenPicker
        items={[
          { key: "screen", label: t("computer.view.screen"), icon: Monitor },
          { key: "browser", label: t("computer.view.browser"), icon: Globe },
        ]}
        chosen={soloView}
        onPick={(key) => setSoloView(key === "browser" ? "browser" : "screen")}
      />
    </div>
  ) : null;

  // The main desktop action shows when no help request or hand-back card
  // already offers it: a ready Local VM, or a ready cloud computer.
  const primaryDesktop = (phase === "vm" || cloudPreviewReady) && !control.helpReason;
  const moreItems = buildComputerMoreItems({
    phase, vmStatus, cloudPreviewReady, canManageCloud, cloudBackend, boatState,
    pending, profileBotBusy: profileBot.busy, editComputer, primaryDesktop, canManageVm, bot,
    onOpenVmWorkspace, run, runVmAction, dispatch,
  });

  const deviceBody = (
    <ComputerDeviceBody
      embedded={embedded}
      soloPicker={soloPicker}
      bot={bot}
      phase={phase}
      cloudBackend={cloudBackend}
      computerStatusCurrent={computerStatusCurrent}
      currentTeamComputer={currentTeamComputer}
      autoView={autoView}
      cloudView={cloudView}
      cloudPreviewReady={cloudPreviewReady}
      frameSrc={frameSrc}
      previewOpensDesktop={previewOpensDesktop}
      previewError={previewError}
      previewRefreshing={previewRefreshing}
      previewRetry={previewRetry}
      pending={pending}
      controlPending={controlPending}
      control={control}
      lastLiveAt={lastLiveAt}
      setPolledFrame={setPolledFrame}
      setPreviewError={setPreviewError}
      setPreviewRefreshing={setPreviewRefreshing}
      setPreviewRetry={setPreviewRetry}
      openDesktop={openDesktop}
      busyBoat={busyBoat}
      isLinux={isLinux}
      localMisses={localMisses}
      vmResumable={vmResumable}
      emptyState={emptyState}
      panelOffers={panelOffers}
      runPlaceAction={runPlaceAction}
      editComputer={editComputer}
      dispatch={dispatch}
      vmStatus={vmStatus}
      canManageVm={canManageVm}
      canManageCloud={canManageCloud}
      runVmAction={runVmAction}
      openVmSettings={openVmSettings}
      openConnectionSettings={openConnectionSettings}
      vpsStatus={vpsStatus}
      run={run}
      replaceVpsComputer={replaceVpsComputer}
      errorText={errorText}
      cloudRefused={cloudRefused}
      manageKeys={manageKeys}
      controlAction={controlAction}
      primaryDesktop={primaryDesktop}
      moreItems={moreItems}
      vmViewerUrl={vmViewerUrl}
      botRoutines={botRoutines}
      routineRuns={state.routineRuns}
      cloudRoutineReady={cloudRoutineReady}
      androidConnected={androidConnected}
      androidStatus={androidStatus}
    />
  );

  const body = bridgeStatus ? (
    <div className={embedded ? "pb-5" : "flex-1 overflow-y-auto px-5 pb-5"}>
      <OrgComputerTab
        bridge={bridgeStatus}
        // The conversation's own place (its pin, else Works on), not the
        // server's Auto guess, which knows no server environment.
        place={livePlace}
        computerOff={livePlace === "off"}
        botName={bot.name}
        botId={bot.id}
        bot={bot}
        threadId={bot.threadId}
        inUse={livePlace === "auto" ? (autoSurfaceCurrent && autoSurface ? (autoSurface.surface ?? "unknown") : "unknown") : livePlace}
        browser={browserOffered ? <BrowserPanel bot={bot} /> : null}
        remoteHosts={remoteHostRows}
        remoteSessions={activeRemoteSessions}
        onPickRemoteHost={onPickRemoteHost}
      />
      <BotRemoteHostsSection botId={bot.id} onChanged={() => { reloadRemoteHosts(); reloadRemoteSessions(); }} />
      {!embedded && <div className="mt-6">
        <RoutinesSection key={bot.id} bot={bot} routines={botRoutines} runs={state.routineRuns} defaultRunOn={cloudRoutineReady ? "cloud" : "maus"} />
      </div>}
    </div>
  ) : browserOffered && soloView === "browser" ? (
    <div className={embedded ? "pb-5" : "flex-1 overflow-y-auto px-5 pb-5"}>
      {soloPicker}
      <div className="mt-3">
        <BrowserScreen><BrowserPanel bot={bot} /></BrowserScreen>
      </div>
    </div>
  ) : deviceBody;

  // The computer view shows directly: Data opens in its own window from the
  // chat header (experimental, src/lib/data-window.ts).
  const shown = body;

  return (
    <>
    {embedded ? null : (
      <ComputerPanelChrome
        padClass={padClass}
        panelWidth={panelWidth}
        separatorRef={separatorRef}
        separatorWidth={separatorWidth}
        onSeparatorKeyDown={onSeparatorKeyDown}
        onResizeStart={onResizeStart}
        onResizeMove={onResizeMove}
        onResizeEnd={onResizeEnd}
        onBack={() => {
          dispatch({ type: "toggleComputer", open: false });
          dispatch({ type: "toggleSettings", open: true });
        }}
        onClose={() => dispatch({ type: "toggleComputer", open: false })}
      >
        {shown}
      </ComputerPanelChrome>
    )}
    {embedded && shown}
    <LocalComputerAutoWarning
      open={localAutoWarningTarget !== null}
      onCancel={() => setLocalAutoWarningTarget(null)}
      onConfirm={() => {
        const targetBotId = localAutoWarningTarget;
        setLocalAutoWarningTarget(null);
        if (!targetBotId) return;
        if (targetBotId === bot.id) {
          setResolvedComputerSelection(null);
          setPhase("checking");
        }
        dispatch({
          type: "updateBot",
          botId: targetBotId,
          patch: { computer: "local", acknowledgeLocalAuto: true },
        });
      }}
    />
    </>
  );
}
