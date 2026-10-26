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
import { BrowserPanel, type BrowserSignIn } from "./BrowserPanel";
import { LocalComputerAutoWarning } from "./LocalComputerAutoWarning";
import { RoutinesSection } from "./bot-settings/RoutinesSection";
import { SignInBanner } from "./SignInRequestCard";

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
  // Keep installation reachable before the engine is ready. Actual browser

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
  // A sign-in card's Open: the place the bot works. The built-in browser
  // opens at its page with the person already in control; a computer opens
  // on its screen, where the banner below offers Take control.
  const requestedSignIn = state.signInFocus?.botId === bot.id ? state.signInFocus : undefined;
  const [signInRequest, setSignInRequest] = useState<BrowserSignIn>();
  useEffect(() => {
    if (!requestedSignIn || requestedSignIn.consumed) return;
    const browser = requestedSignIn.place === "browser";
    setSoloView(browser ? "browser" : "screen");
    if (browser) setSignInRequest({ url: requestedSignIn.url, site: requestedSignIn.site, nonce: requestedSignIn.requestId });
    dispatch({ type: "signInFocusConsumed", requestId: requestedSignIn.requestId });
  }, [bot.id, dispatch, requestedSignIn]);

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
    let alive = true;
    setResolvedComputerSelection(null);
    setTeamComputer(null);
    setPhase("checking");
    setPolledFrame(null);
    setPreviewError(null);
    setVmFrame(null);
    setVmViewerUrl(null);
    setVmStatus(null);
    setVpsStatus(null);
    setLocalFrame(null);
    setError(null);
    // The selection may be optimistic for up to the profile debounce. Never
    // let it choose a provider until the PATCH lane confirms server state.
    if (!computerSelectionPersisted || !surfaceReady) return;
    if (bot.computer === undefined) {
      setPhase("auto-unavailable");
      return;
    }

    if (bot.computer === "off") {
      setPhase("off");
      return;
    }
    // Browser-only bots own no desktop: the Browser tab is their whole
    // screen, so this tab must not wake a boat or start host capture.
    if (bot.computer === "browser") {
      setPhase("browser");
      return;
    }
    if (bot.computer === "local") {
      if (!providerSupportsLocal) {
        setError(new LocalizedPanelError("computer.err.localEngine"));
      }
      setPhase(capabilitiesReady && localAvailable && providerSupportsLocal ? "local" : "local-unavailable");
      setResolvedComputerSelection({ botId: bot.id, threadId: bot.threadId, computer: bot.computer, cloudBackend });
      return;
    }
    if (bot.computer === "vm") {
      if (!vmSupported) {
        setError(new LocalizedPanelError("computer.err.vmEngine"));
        setPhase("vm-unavailable");
        return;
      }
      let retryTimer: number | undefined;
      api(threadPath("local-computer"))
        .then((rawStatus) => {
          if (!alive) return;
          const status: LocalVmStatus = rawStatus;
          setResolvedComputerSelection({ botId: bot.id, threadId: bot.threadId, computer: bot.computer, cloudBackend });
          setVmStatus(status);
          // parse at the boundary: our own status endpoint sends a string or nothing
          const viewerUrl = String(status.viewer_url ?? "");
          if (viewerUrl.startsWith("http") || viewerUrl.startsWith("/desktop-viewer#")) {
            setVmViewerUrl(new URL(viewerUrl, window.location.href).href);
          }
          if (status.ready) {
            vmReadinessAttempts.current = 0;
            setPhase("vm");
          } else if (
            status.container === "running" &&
            status.imageMatches &&
            status.managed &&
            status.network === "loopback" &&
            status.security === "hardened" &&
            status.persistence === "durable" &&
            !status.desktopReady &&
            vmReadinessAttempts.current < 15
          ) {
            vmReadinessAttempts.current += 1;
            setError(null);
            setPhase("checking");
            retryTimer = window.setTimeout(() => setRetry((n) => n + 1), 2000);
          }
          else {
            const canCreateHere =
              status.mode === "per-bot" &&
              status.container === "missing" &&
              status.image &&
              status.create_supported;
            setError(canCreateHere || status.resumable ? null : new LocalizedPanelError(
              "computer.err.vmOpenSettings", status.problem, "computer.err.vmNotReady",
            ));
            setPhase("vm-unavailable");
          }
        })
        .catch((e) => {
          if (!alive) return;
          setError(e.message);
          setPhase("vm-unavailable");
        });
      return () => {
        alive = false;
        if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      };
    }
    if (bot.computer === "cloud" && !cloudSupported) {
      // Its line is the cloud computer's own place view, below.
      setPhase("error");
      return;
    }
    if (bot.computer !== "cloud" && !capabilitiesReady) return;
    if (cloudBackend === "vps") {
      api(threadPath("computer"))
        .then((rawStatus) => {
          if (!alive) return;
          const status: VpsComputerStatus = rawStatus;
          setVpsStatus(status);
          setResolvedComputerSelection({
            botId: bot.id,
            threadId: bot.threadId,
            computer: bot.computer,
            cloudBackend,
          });
          if (!status.configured) {
            setError(new LocalizedPanelError("computer.err.vpsAlias"));
            setPhase("vps-unconfigured");
            return;
          }
          if (status.ready) {
            setBoatState(status.container ?? null);
            setPhase("ready");
            return;
          }
          // App updates can bump IMAGE_LAYER_VERSION while this bot still has
          // a managed container from the previous release. Provision refuses
          // to overwrite it by design, so surface the explicit replacement
          // path instead of automatically issuing a request that can only 409.
          if (status.managed && status.container !== "missing" && !status.imageMatches) {
            setError(status.problem);
            setPhase("vps-incompatible");
            return;
          }
          if (canManageCloud) {
            setPhase("starting");
            return api(`/api/bots/${bot.id}/computer/provision`, { method: "POST" }).then((result) => {
              if (!alive) return;
              setBoatState(result.container ?? null);
              if (result.ready) {
                setResolvedComputerSelection({
                  botId: bot.id,
                  threadId: bot.threadId,
                  computer: bot.computer,
                  cloudBackend,
                });
                setPhase("ready");
              }
              else {
                setError(result.problem ?? new LocalizedPanelError("computer.err.vpsNotReady"));
                setPhase("error");
              }
            });
          }
          setBoatState(status.container ?? null);
          setError(
            bot.autoStartVps
              ? new LocalizedPanelError("computer.err.vpsAuto", status.problem, "computer.err.vpsNoContainer")
              : new LocalizedPanelError("computer.err.vpsManual", status.problem, "computer.err.vpsNoContainer"),
          );
          setPhase(status.container === "stopped" ? "vps-stopped" : "vps-unconfigured");
        })
        .catch((e) => {
          if (!alive) return;
          setError(e.message);
          setPhase("error");
        });
      return () => {
        alive = false;
      };
    }
    // Opening the panel only looks. With Cloud computer chosen, the bot's
    // first computer call creates or wakes the Boat, or the person's own
    // Start it now / Wake it now button does; on Auto the panel only reports
    // an existing Boat.
    api(threadPath("computer"))
      .then((status) => {
        if (!alive) return;
        const action = resolveBoatPanelAction({
          // This conversation is on the cloud computer: the bot's Works on,
          // or a pin (the person's, or select_computer's).
          computer: livePlace === "cloud" ? "cloud" : undefined,
          configured: Boolean(status.configured),
          boatState: typeof status.box?.state === "string" ? status.box.state : null,
          canUseCloud: cloudSupported,
          autoLocal: false,
          teamComputer: typeof status.teamComputer?.id === "string" && typeof status.teamComputer?.name === "string",
          busy: profileBot.busy,
        });
        setResolvedComputerSelection({
          botId: bot.id,
          threadId: bot.threadId,
          computer: bot.computer,
          cloudBackend,
        });
        if (!status.configured && bot.computer === "cloud" && !status.teamComputer) {
          setPhase("unconfigured");
          return;
        }
        if (action === "team-boat") {
          setTeamComputer({ id: status.teamComputer.id, name: status.teamComputer.name,
            botId: bot.id, section: bot.section?.trim() ?? "" });
          setBoatState(typeof status.box?.state === "string" ? status.box.state : status.configured ? "missing" : "unavailable");
          setError(typeof status.problem === "string" ? status.problem : null);
          setPhase("team-boat");
          return;
        }
        if (action === "attach-ready-boat" || (bot.computer === "cloud" && action === "show-ready-boat")) {
          // A ready boat, the bot's own or the one this conversation was
          // moved to (select_computer): going straight to ready lets the
          // turn's live frames and the screenshot poll show what the bot is
          // doing.
          setBoatState(typeof status.box?.state === "string" ? status.box.state : null);
          setPhase("ready");
          return;
        }
        setBoatState(typeof status.box?.state === "string" ? status.box.state : null);
        setPhase(action);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message);
        setPhase("error");
      });
    return () => {
      alive = false;
    };
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
          const state = typeof status.box?.state === "string" ? status.box.state : null;
          setBoatState(state);
          if (isReadyBoatState(state)) setPhase("ready");
        })
        .catch(() => { /* the next tick tries again */ });
    };
    const timer = window.setInterval(check, 5_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [phase, threadPath, profileBot.busy, livePlace]);

  // Live frames of this conversation's screen come straight from the app's
  // stream, never through the store. Only a frame heard while this preview is
  // up may replace it, and the poll below waits while they keep coming.
  const pageVisible = usePageVisible();
  const lastLiveAt = useRef(0);
  const previewBusy = useRef(bot.busy);
  useEffect(() => { previewBusy.current = bot.busy; }, [bot.busy]);
  useEffect(() => {
    lastLiveAt.current = 0;
    if (!cloudPreviewReady) return;
    return listenLiveFrames({
      onFrame: (frame) => {
        if (frame.kind !== "screen" || frame.botId !== bot.id || frame.threadId !== bot.threadId) return;
        lastLiveAt.current = Date.now();
        setPolledFrame({ png: frame.png, mime: frame.mime ?? "image/png" });
        setPreviewError(null);
        setPreviewRefreshing(false);
      },
    });
  }, [cloudPreviewReady, bot.id, bot.threadId]);

  useEffect(() => {
    if (!cloudPreviewReady || viewerOpen || !pageVisible || pending || controlPending) return;
    let inFlight = false;
    let lastAttemptAt = -Infinity;
    let retryDelay: number | null = null;
    let contentionSince: number | null = null;
    const controller = new AbortController();
    setPreviewError(null);
    setPreviewRefreshing(true);
    const shoot = async () => {
      if (inFlight || controller.signal.aborted) return;
      if (Date.now() - lastAttemptAt < (retryDelay ?? (previewBusy.current ? 4000 : 30_000))) return;
      // Resume polling if a busy bot stops publishing frames. A single old
      // SSE event is not evidence of a working stream for the whole turn.
      if (previewBusy.current && Date.now() - lastLiveAt.current < 10_000) return;
      inFlight = true;
      retryDelay = null;
      const startedAt = Date.now();
      try {
        const { png, format } = await api(threadPath("computer/screenshot"), {
          method: "POST",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]),
        });
        if (!controller.signal.aborted && lastLiveAt.current <= startedAt) {
          if (typeof png !== "string" || !png.trim()) throw new LocalizedPanelError("computer.err.emptyFrame");
          setPolledFrame({ png, mime: format === "jpeg" ? "image/jpeg" : "image/png" });
          setPreviewError(null);
          setPreviewRefreshing(false);
          contentionSince = null;
        }
      } catch (e) {
        if (!controller.signal.aborted && lastLiveAt.current <= startedAt) {
          // A canceled client request can leave its capture running on the
          // host. Contention is temporary, not a disconnected computer.
          if (e instanceof ApiError && isRemoteScreenshotContention(e)) {
            retryDelay = 1000;
            contentionSince ??= Date.now();
            const prolonged = Date.now() - contentionSince >= 10_000;
            setPreviewError(prolonged ? e : null);
            setPreviewRefreshing(!prolonged);
          } else {
            contentionSince = null;
            setPreviewRefreshing(false);
            setPreviewError(e instanceof Error && e.name === "TimeoutError"
              ? new LocalizedPanelError("computer.err.frameTimeout")
              : e instanceof Error ? e : new LocalizedPanelError("computer.err.screenUnavailable"));
          }
        }
      } finally {
        inFlight = false;
        lastAttemptAt = Date.now();
      }
    };
    void shoot();
    // Read the current cadence without aborting a capture on every busy
    // transition. Only connection/action changes replace its generation.
    const timer = setInterval(shoot, 1000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [cloudPreviewReady, threadPath, cloudBackend, viewerOpen, pageVisible, pending, controlPending, previewRetry]);

  // Local VM preview comes directly from Cua Driver through the harness. It
  // does not use the password-protected noVNC viewer or cloud endpoints.
  useEffect(() => {
    if (phase !== "vm" || !computerStatusCurrent || viewerOpen || !pageVisible) return;
    const controller = new AbortController();
    let inFlight = false;
    let lastAttemptAt = -Infinity;
    let retryDelay: number | null = null;
    let initialAttempt = true;
    const shoot = async () => {
      if (inFlight || controller.signal.aborted) return;
      if (Date.now() - lastAttemptAt < (retryDelay ?? (bot.busy ? 3000 : 30_000))) return;
      inFlight = true;
      retryDelay = null;
      try {
        const { image } = await api(threadPath("local-computer/screenshot"), { method: "POST", signal: controller.signal });
        if (!controller.signal.aborted && typeof image === "string") {
          setVmFrame(image);
          setPreviewError(null);
        }
      } catch (e) {
        // The first miss leaves the pane with nothing to show, so it stays a
        // panel error. Later transient misses are the preview's own retry
        // business — they keep the last frame, back off, and never rewrite
        // the panel banner every tick.
        if (!controller.signal.aborted) {
          retryDelay = 5000;
          if (initialAttempt) setError(e instanceof Error ? e.message : String(e));
          else setPreviewError(e instanceof Error ? e : new LocalizedPanelError("computer.err.screenUnavailable"));
        }
      } finally {
        inFlight = false;
        initialAttempt = false;
        lastAttemptAt = Date.now();
      }
    };
    void shoot();
    const timer = window.setInterval(() => void shoot(), bot.busy ? 3000 : 30_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [phase, computerStatusCurrent, threadPath, viewerOpen, pageVisible, bot.busy, setError, setPreviewError, setVmFrame]);

  // local preview: frames from the Electron main process. The FIRST capture
  // attempt is what makes macOS show the Screen Recording prompt (there is
  // no reliable pre-grant flow on macOS 15+), so repeated empty frames mean
  // the user denied — surface the Settings repair path instead of spinning.
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
  // The bot's open sign-in request, from its plea: the panel's banner names
  // the site and settles the card, as the card's own Done and Cancel do.
  const signInHelp = control.help ?? null;
  const signInAsker = signInHelp ? state.bots.find((candidate) => candidate.id === signInHelp.botId)?.name ?? bot.name : bot.name;


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
    activeRemoteSessions, remoteHostRows, catalogHosts, onPickRemoteHost, onAttachRemoteHost, onDetachRemoteHost,
  } = useRemoteHosts(bot.id, bridgeStatus);
  // A computer's plea gets Take control in its banner; the built-in
  // browser's own toolbar has one, and this computer is taken in person.
  const bannerTakesControl = Boolean(signInHelp && signInHelp.place !== "browser" && signInHelp.place !== "local" &&
    (cloudPreviewReady || phase === "vm" || currentTeamComputer));
  const signInBanner = (takeControl?: () => void) => signInHelp && (
    <SignInBanner
      help={signInHelp}
      askerName={signInAsker}
      takeControl={takeControl && { onClick: takeControl, disabled: controlPending || pending === "join", pending: pending === "join" }}
      onError={setError}
    />
  );


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
    <>
    {signInHelp && signInHelp.place !== "browser" && (
      <div className="mb-3">{signInBanner(bannerTakesControl && !control.held
        ? () => phase === "vm" || cloudPreviewReady ? void openDesktop() : void controlAction("take")
        : undefined)}</div>
    )}
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
    </>

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
        browser={browserOffered ? <>
          {signInHelp?.place === "browser" && <div className="mb-3">{signInBanner()}</div>}
          <BrowserPanel bot={bot} signIn={signInRequest} />
        </> : null}
        remoteHosts={remoteHostRows}
        remoteCatalog={catalogHosts}
        remoteSessions={activeRemoteSessions}
        onPickRemoteHost={onPickRemoteHost}
        onAttachRemoteHost={onAttachRemoteHost}
        onDetachRemoteHost={onDetachRemoteHost}

      />
      {!embedded && <div className="mt-6">
        <RoutinesSection key={bot.id} bot={bot} routines={botRoutines} runs={state.routineRuns} defaultRunOn={cloudRoutineReady ? "cloud" : "maus"} />
      </div>}
    </div>
  ) : browserOffered && soloView === "browser" ? (
    <div className={embedded ? "pb-5" : "flex-1 overflow-y-auto px-5 pb-5"}>
      {soloPicker}
      <div className="mt-3">
        {signInHelp?.place === "browser" && <div className="mb-3">{signInBanner()}</div>}
        <BrowserScreen><BrowserPanel bot={bot} signIn={signInRequest} /></BrowserScreen>
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
