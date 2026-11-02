import { boatCapableEngine, cloudEngineOf } from "@/lib/remote-desktop";
import { canWorkOnCloud } from "../../../shared/cloud-computer";
import { useCallback, useEffect, useRef, useState } from "react";
import { canEditBotField } from "@/lib/bot-capabilities";
import { canManageKeys } from "@/lib/viewer";
import { api, currentTaskBot, useStore, type Bot } from "@/state/store";
import { effectivePlace, placeOffered } from "@/lib/place";
import type { CloudBackend } from "../../../shared/wire";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import {
  instanceSupportsLocalComputer,
  localComputerDisabledReason,
  localComputerSelectable,
  persistedComputerSelectionMatches,
  isReadyBoatState,
  shouldPollCloudPreview,
} from "@/lib/local-computer";
import { usePlaceSeat } from "@/lib/place-view";
import { browserAvailable, builtInBrowserEnabled } from "@/lib/feature-flags";
import { browserTeachPending, onBrowserTeachRequest } from "@/lib/teach-request";
import { useDesktopBridgeStatus } from "@/lib/desktop-bridge";
import { attachPhaseResolve } from "./attachPhaseResolve";
import type { ComputerPending, LocalVmStatus, Phase, VpsComputerStatus } from "./types";

/** Connection, capabilities, phase resolve and boat watch for ComputerPanel. */
export function useComputerPanelSession(profileBot: Bot) {
  const { state, dispatch, flushBotPatches } = useStore();
  // Where this bot's current conversation works and whether a turn is acting
  // there now: the tab for that place carries the live dot.
  const liveTask = profileBot.tasks?.find((task) => task.threadId === profileBot.threadId);
  const livePlace = effectivePlace(profileBot, liveTask);
  // Browser mode: the bot's live browser in the screen's frame, from the
  // screen picker's Browser chip, where this server has the built-in browser.
  const browserOffered = builtInBrowserEnabled(state.config) || browserAvailable(state.config);
  // A bot that works on its browser opens on it.
  // So does one the person asked to show a task to (Teach a task).
  const [soloView, setSoloView] = useState<"screen" | "browser">(() => profileBot.computer === "browser" || browserTeachPending(profileBot.id) ? "browser" : "screen");
  useEffect(() => onBrowserTeachRequest((botId) => { if (botId === profileBot.id) setSoloView("browser"); }), [profileBot.id]);
  const threadBot = currentTaskBot(profileBot);
  const connectionKey = `${profileBot.id}:${profileBot.threadId}:${livePlace}:${profileBot.cloudBackend ?? "box"}:${threadBot.modelSelection.instanceId}`;
  const [autoSurface, setAutoSurface] = useState<{ key: string; surface: Bot["computer"] } | null>(null);
  const autoSurfaceCurrent = autoSurface?.key === connectionKey;
  const surfaceReady = livePlace !== "auto" || autoSurfaceCurrent;
  // Profile defaults belong to Edit persona > Access (Works on). The screen
  // and capability checks belong to the selected conversation, not that default.
  const bot = { ...threadBot, computer: livePlace === "auto"
    ? autoSurfaceCurrent ? autoSurface.surface : undefined : livePlace };
  const viewerConnectionKey = `${bot.id}:${bot.threadId}:${bot.computer}:${bot.cloudBackend ?? "box"}`;
  const viewerConnection = useRef(viewerConnectionKey);
  viewerConnection.current = viewerConnectionKey;
  const desktopJoin = useRef<AbortController | null>(null);
  useEffect(() => () => desktopJoin.current?.abort(), [viewerConnectionKey]);
  const threadPath = useCallback((suffix: string) =>
  `/api/bots/${profileBot.id}/${suffix}?threadId=${encodeURIComponent(profileBot.threadId)}`,
  [profileBot.id, profileBot.threadId]);
  const canManageCloud = profileBot.computer === "cloud" && livePlace === "cloud";
  const canManageVm = profileBot.computer === "vm" && livePlace === "vm";
  // Delete VM writes where the bot runs. Works on, in Edit persona > Access,
  // is the one control for that choice. The Boat key is an
  // installation secret. Both are refused to an organization member.
  const editComputer = canEditBotField(state.config, profileBot, "computer");
  const manageKeys = canManageKeys(state.config);
  const { capabilities, ready: capabilitiesReady } = useDesktopCapabilities();
  const localAvailable = capabilities.localComputer.available;
  const isLinux = capabilities.host.platform === "linux";
  const providerSupportsLocal = instanceSupportsLocalComputer(state.instances, bot);
  // An OMB Cloud home never offers this computer (shared/cloud-home.ts).
  const localSelectable = placeOffered("local", state.config) && localComputerSelectable({ capabilities, providerSupportsLocal });
  const [localAutoWarningTarget, setLocalAutoWarningTarget] = useState<string | null>(null);
  const localDisabledReason = localComputerDisabledReason({ capabilities, providerSupportsLocal });
  // Where this app runs and who is looking: every place below is worded
  // from it (shared/place-view.ts), the same as the chip and a failed row.
  const placeSeat = usePlaceSeat(state.config, capabilities.host.platform);
  const [phase, setPhase] = useState<Phase>("checking");
  const [persistedComputerSelection, setPersistedComputerSelection] = useState<{
    botId: string;
    computer: Bot["computer"];
    cloudBackend: CloudBackend;
    section: string;
  } | null>(null);
  const [resolvedComputerSelection, setResolvedComputerSelection] = useState<{
    botId: string;
    threadId: string;
    computer: Bot["computer"];
    cloudBackend: CloudBackend;
  } | null>(null);
  const [teamComputer, setTeamComputer] = useState<{
    id: string; name: string; botId: string; section: string;
  } | null>(null);
  const cloudBackend = bot.cloudBackend ?? "box";
  const computerSelectionPersisted = Boolean(
  persistedComputerSelection
  && persistedComputerSelection.botId === bot.id
  && persistedComputerSelection.computer === profileBot.computer
  && persistedComputerSelection.cloudBackend === cloudBackend
  && persistedComputerSelection.section === (bot.section?.trim() ?? ""),
  );
  const computerStatusCurrent = Boolean(
  resolvedComputerSelection
  && resolvedComputerSelection.botId === bot.id
  && resolvedComputerSelection.threadId === bot.threadId
  && resolvedComputerSelection.computer === bot.computer
  && resolvedComputerSelection.cloudBackend === cloudBackend,
  );
  const currentTeamComputer = computerStatusCurrent && livePlace === "auto" && cloudBackend === "box"
  && teamComputer?.botId === bot.id && teamComputer.section === (bot.section?.trim() ?? "")
  ? teamComputer : null;
  const cloudPreviewReady = computerStatusCurrent && shouldPollCloudPreview({
    computer: bot.computer,
    cloudBackend,
    phase,
    botId: bot.id,
    resolvedBotId: resolvedComputerSelection?.botId ?? null,
    resolvedComputer: resolvedComputerSelection?.computer ?? null,
    resolvedCloudBackend: resolvedComputerSelection?.cloudBackend ?? null,
  });
  useEffect(() => {
    let alive = true;
    setPersistedComputerSelection(null);
    void flushBotPatches(bot.id).then((persistedBot) => {
      if (!alive) return;
      if (persistedBot && !persistedComputerSelectionMatches({
        computer: profileBot.computer,
        cloudBackend,
        persistedBot,
      })) return;
      if (persistedBot && (persistedBot.section?.trim() ?? "") !== (bot.section?.trim() ?? "")) return;
      setPersistedComputerSelection({
        botId: bot.id,
        computer: profileBot.computer,
        cloudBackend,
        section: bot.section?.trim() ?? "",
      });
    });
    return () => {
      alive = false;
    };
  }, [bot.id, profileBot.computer, bot.section, cloudBackend, flushBotPatches]);
  const [boatState, setBoatState] = useState<string | null>(null);
  const [polledFrame, setPolledFrame] = useState<{ png: string; mime: string } | null>(null);
  const [previewError, setPreviewError] = useState<Error | string | null>(null);
  const [previewRefreshing, setPreviewRefreshing] = useState(false);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [vmFrame, setVmFrame] = useState<string | null>(null);
  // The Local VM's interactive noVNC viewer (passworded, autoconnect). The
  // preview below is a periodic screenshot that swallows clicks — this URL is
  // the only way a person can actually drive the VM.
  const [vmViewerUrl, setVmViewerUrl] = useState<string | null>(null);
  const [vmStatus, setVmStatus] = useState<LocalVmStatus | null>(null);
  const [vpsStatus, setVpsStatus] = useState<VpsComputerStatus | null>(null);
  const [localFrame, setLocalFrame] = useState<string | null>(null);
  const [pending, setPending] = useState<ComputerPending>(null);
  const [controlPending, setControlPending] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [error, setError] = useState<Error | string | null>(null);
  // bumped when a Boat API key is saved inline, to re-run the spin-up flow
  const [retry, setRetry] = useState(0);
  // Auto is a server decision (including an existing Local VM). Do not guess
  // host-vs-cloud from desktop capabilities and show a different computer.
  useEffect(() => {
    if (livePlace !== "auto" || !computerSelectionPersisted) return;
    const controller = new AbortController();
    setAutoSurface(null);
    void api(threadPath("computer"), { signal: controller.signal }).then((status) => {
      if (controller.signal.aborted) return;
      const surface = status.surface;
      setAutoSurface({ key: connectionKey, surface:
        surface === "cloud" || surface === "vm" || surface === "local" || surface === "browser" || surface === "off"
        ? surface : undefined });
    }).catch((cause) => {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause : String(cause));
      setPhase("error");
    });
    return () => controller.abort();
  }, [connectionKey, livePlace, computerSelectionPersisted, threadPath, retry]);
  const vmResumable = phase === "vm-unavailable" && vmStatus?.resumable === true;
  const vmReadinessAttempts = useRef(0);
  const vmActionController = useRef<AbortController | null>(null);
  useEffect(() => {
    if (vmActionController.current?.signal.aborted) {
      vmActionController.current = null;
      setPending(null);
    }
    return () => { vmActionController.current?.abort(); };
  }, [bot.id, bot.threadId, bot.computer]);
  const selectedInstance = state.instances.find(
  (instance) => instance.instanceId === bot.modelSelection.instanceId,
  );
  // Pause the screenshot poll while this bot's viewer is open; seed from the
  // live viewer so a remount/switch mid-session doesn't wrongly resume it.
  useEffect(() => {
    let alive = true;
    const dv = window.ogb?.desktopViewer;
    if (dv?.currentState) {
      void dv
      .currentState()
      .then((s) => {
        if (alive) setViewerOpen(s.open && s.contextId === bot.id);
      })
      .catch(() => {});
    }
    const off = dv?.onState((viewer) => {
      if (viewer.contextId === bot.id) setViewerOpen(viewer.open);
    });
    return () => {
      alive = false;
      off?.();
    };
  }, [bot.id]);

  useEffect(() => {
    vmReadinessAttempts.current = 0;
  }, [bot.id, bot.computer]);
  const vmSupported = Boolean(
  selectedInstance?.snapshot.state === "available" &&
  selectedInstance.capabilities?.computerMcp,
  );
  // One rule for both cloud backends (shared/cloud-computer.ts).
  const cloudSupported = canWorkOnCloud(cloudEngineOf(selectedInstance));
  const bridgeStatus = useDesktopBridgeStatus();
  const botRoutines = state.routines
  .filter((routine) => routine.botId === bot.id)
  .sort((a, b) => Number(b.enabled) - Number(a.enabled) || (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity));
  const cloudRoutineReady = Boolean(
  state.config?.box.configured &&
  boatCapableEngine(state.instances, bot.modelSelection.instanceId)?.snapshot.state === "available",
  );
  // resolve the mode on open; boat endpoints are only ever hit on the
  // cloud path, so local/off can never render a JSON error as an image
  useEffect(() => {
    return attachPhaseResolve({
      bot,
      profileBotBusy: profileBot.busy,
      cloudBackend,
      computerSelectionPersisted,
      surfaceReady,
      providerSupportsLocal,
      capabilitiesReady,
      localAvailable,
      vmSupported,
      cloudSupported,
      canManageCloud,
      livePlace,
      threadPath,
      vmReadinessAttempts,
      setResolvedComputerSelection,
      setTeamComputer,
      setPhase,
      setPolledFrame,
      setPreviewError,
      setVmFrame,
      setVmViewerUrl,
      setVmStatus,
      setVpsStatus,
      setLocalFrame,
      setError,
      setBoatState,
      setRetry,
    }) ?? undefined;
  }, [
  bot.id,
  bot.threadId,
  bot.computer,
  bot.section,
  bot.autoStartVps,
  cloudBackend,
  retry,
  capabilitiesReady,
  localSelectable,
  isLinux,
  providerSupportsLocal,
  selectedInstance?.driverKind,
  vmSupported,
  cloudSupported,
  state.config?.vps?.sshAlias,
  computerSelectionPersisted,
  surfaceReady,
  canManageCloud,
  livePlace,
  threadPath,
  ]);

  // busy-boat waits for the turn's own provisioning. Nothing else re-runs the
  // resolve effect until the turn ends, so watch the boat ourselves and attach
  // as soon as it is ready — the screen should appear mid-turn, not after.
  useEffect(() => {
    if (phase !== "busy-boat") return;
    let alive = true;
    const check = () => {
      // The turn ended: settle on what this conversation's cloud computer
      // is now (the bot's Works on, or a pin to it), and stop looking.
      if (!profileBot.busy && livePlace === "cloud") {
        setRetry((n) => n + 1);
        return;
      }
      api(threadPath("computer"))
      .then((status) => {
        if (!alive) return;
        const next = typeof status.box?.state === "string" ? status.box.state : null;
        setBoatState(next);
        if (isReadyBoatState(next)) setPhase("ready");
      })
      .catch(() => { /* the next tick tries again */ });
    };
    const timer = window.setInterval(check, 5_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [phase, threadPath, profileBot.busy, livePlace]);
  return {
    state,
    dispatch,
    livePlace,
    browserOffered,
    soloView,
    setSoloView,
    autoSurface,
    autoSurfaceCurrent,
    surfaceReady,
    bot,
    viewerConnectionKey,
    viewerConnection,
    desktopJoin,
    threadPath,
    canManageCloud,
    canManageVm,
    editComputer,
    manageKeys,
    capabilitiesReady,
    localAvailable,
    isLinux,
    providerSupportsLocal,
    localSelectable,
    localAutoWarningTarget,
    setLocalAutoWarningTarget,
    localDisabledReason,
    placeSeat,
    phase,
    setPhase,
    setPersistedComputerSelection,
    resolvedComputerSelection,
    setResolvedComputerSelection,
    teamComputer,
    setTeamComputer,
    cloudBackend,
    computerSelectionPersisted,
    computerStatusCurrent,
    currentTeamComputer,
    cloudPreviewReady,
    boatState,
    setBoatState,
    polledFrame,
    setPolledFrame,
    previewError,
    setPreviewError,
    previewRefreshing,
    setPreviewRefreshing,
    previewRetry,
    setPreviewRetry,
    vmFrame,
    setVmFrame,
    vmViewerUrl,
    setVmViewerUrl,
    vmStatus,
    setVmStatus,
    vpsStatus,
    setVpsStatus,
    localFrame,
    setLocalFrame,
    pending,
    setPending,
    controlPending,
    setControlPending,
    viewerOpen,
    error,
    setError,
    retry,
    setRetry,
    vmResumable,
    vmReadinessAttempts,
    vmActionController,
    selectedInstance,
    vmSupported,
    cloudSupported,
    bridgeStatus,
    botRoutines,
    cloudRoutineReady,
  };
}
