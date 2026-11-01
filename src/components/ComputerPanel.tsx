import { boatCapableEngine, cloudEngineOf } from "@/lib/remote-desktop";
import { canWorkOnCloud } from "../../shared/cloud-computer";
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
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { waitForLocalVmReady } from "@/lib/local-vm-readiness";
import {
  Columns2,
  Globe,
  Hand,
  Loader2,
  Maximize2,
  Monitor,
  Moon,
  Power,
  ChevronLeft,
  PanelRight,
  Settings2,
} from "lucide-react";
import { canEditBotField } from "@/lib/bot-capabilities";
import { canManageKeys } from "@/lib/viewer";
import { api, ApiError, currentTaskBot, useStore, type Bot } from "@/state/store";
import { effectivePlace, placeOffered } from "@/lib/place";
import type { CloudBackend } from "../../shared/wire";
import { cn } from "@/lib/cn";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { useCaptionChrome } from "@/components/DesktopCapabilities";
import { usePageVisible } from "@/lib/page-visible";
import { listenLiveFrames } from "@/lib/live-events";
import { CloudScreenPreview } from "./CloudScreenPreview";
import { isActiveTurnRefusal, isRemoteScreenshotContention } from "@/lib/remote-desktop";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { RoutinesSection } from "./bot-settings/RoutinesSection";
import { AndroidDevicePanel, useAndroidUsbDevices } from "./AndroidDevicePanel";
import { transitionComputerControlLease, type ComputerControlAction } from "@/lib/computer-control";
import { LocalScreenPreview } from "./LocalScreenPreview";
import { LinuxLocalControl } from "./LinuxLocalControl";
import { MacLocalControl } from "./MacLocalControl";
import { LocalComputerAutoWarning } from "./LocalComputerAutoWarning";
import { ComputerMoreMenu, type ComputerMoreItem } from "./computer/ComputerMoreMenu";
import {
  busyBoatView,
  instanceSupportsLocalComputer,
  localComputerDisabledReason,
  localComputerSelectable,
  persistedComputerSelectionMatches,
  isReadyBoatState,
  resolveBoatPanelAction,
  shouldPollCloudPreview,
} from "@/lib/local-computer";
import { openPlaceAction, placeBlocked, placeFacts, placeViewFor, usePlaceSeat } from "@/lib/place-view";
import { cloudRefusal, type PlaceActionId, type PlaceFacts, type PlaceView } from "../../shared/place-view";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { requestSettingsCard } from "./SettingsPrimitives";
import { SettingsText } from "./SettingsLink";
import { BrowserScreen, OrgComputerTab, ScreenPicker } from "./computer/OrgComputerTab";
import { BrowserPanel } from "./BrowserPanel";
import { browserAvailable, builtInBrowserEnabled } from "@/lib/feature-flags";
import { browserTeachPending, onBrowserTeachRequest } from "@/lib/teach-request";
import { withTeachBot } from "@/lib/computer-teach-client";
import { BotRemoteHostsSection } from "./remote-session/BotRemoteHostsSection";
import { openBotRemoteHost, fetchBotRemoteHosts } from "./remote-session/bot-remote-hosts-client";
import { useRemoteSessions } from "./remote-session/use-remote-sessions";
import type { UnattendedHostRow } from "../../shared/remote-unattended-host";

import { useDesktopBridgeStatus } from "@/lib/desktop-bridge";
import { readableError } from "@/lib/plain-error";

/** Keep local failure copy translatable while it remains in panel state. */
class LocalizedPanelError extends Error {
  constructor(
    readonly key: LocaleKey,
    readonly problem?: string | null,
    readonly fallbackKey?: LocaleKey,
  ) {
    super(key);
  }
}

function panelErrorText(error: Error | string | null): string | null {
  if (error instanceof LocalizedPanelError) {
    return t(error.key, error.fallbackKey ? { problem: error.problem ?? t(error.fallbackKey) } : undefined);
  }
  if (error == null) return null;
  return readableError(error);
}

interface VpsComputerStatus {
  configured: boolean;
  imageMatches: boolean;
  managed: boolean;
  container: "running" | "stopped" | "missing";
  ready: boolean;
  problem: string | null;
}

type Phase =
  | "checking"
  | "unconfigured"
  | "starting"
  | "busy-boat"
  | "ready"
  | "vm"
  | "vm-unavailable"
  | "vps-unconfigured"
  | "vps-incompatible"
  | "vps-stopped"
  | "local"
  | "local-unavailable"
  | "auto-unavailable"
  | "team-boat"
  | "show-ready-boat"
  | "show-sleeping-boat"
  | "show-pending-boat"
  | "cloud-new"
  | "cloud-asleep"
  | "browser"
  | "off"
  | "error";

interface LocalVmStatus {
  /** Optional: a hosted server can lag behind this app. */
  resumable?: boolean;
  stop_reason?: "idle" | null;
  mode: "shared" | "per-bot" | "pool";
  max_instances: number;
  image: boolean;
  create_supported: boolean;
  container: "running" | "stopped" | "missing";
  imageMatches: boolean;
  managed: boolean;
  network: "loopback" | "unsafe" | "unknown";
  security: "hardened" | "unsafe" | "unknown";
  persistence: "durable" | "unsafe" | "unknown";
  desktopReady: boolean;
  ready: boolean;
  problem: string | null;
  viewer_url: string;
}

const computerControlSnapshotSchema = z.object({
  held: z.boolean().optional().default(false),
  helpReason: z.string().nullable().optional().default(null),
}).passthrough();

const PANEL_WIDTH_KEY = "omb-settings-panel-width";
const PANEL_MIN_WIDTH = 320;
const PANEL_MAX_WIDTH = 720;
const PANEL_DEFAULT_WIDTH = 420;
const PANEL_RESIZE_STEP = 40;

function readPanelWidth(): number {
  try {
    const stored = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    if (Number.isFinite(stored) && stored >= PANEL_MIN_WIDTH && stored <= PANEL_MAX_WIDTH) return stored;
  } catch {
    /* storage blocked — default width */
  }
  return PANEL_DEFAULT_WIDTH;
}

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
  // The panel is a fixed column by default; a drag handle on its left edge
  // makes it wide enough to actually read a page in the Browser tab.
  const [panelWidth, setPanelWidth] = useState(readPanelWidth);
  const resizeFrom = useRef<{ x: number; width: number } | null>(null);
  const persistPanelWidth = (width: number) => {
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(width));
    } catch {
      /* storage blocked — width lives for this session */
    }
  };
  const onResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    resizeFrom.current = { x: event.clientX, width: panelWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeFrom.current) return;
    const next = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, resizeFrom.current.width + (resizeFrom.current.x - event.clientX)));
    setPanelWidth(next);
  };
  const onResizeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeFrom.current) return;
    resizeFrom.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    persistPanelWidth(panelWidth);
  };
  /** Keyboard resize: the same clamp and stored preference the pointer flow
   * uses, so arrow-key changes stay in React state like a drag would. */
  const onResizeBy = (delta: number) => {
    setPanelWidth((current) => {
      const next = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, current + delta));
      persistPanelWidth(next);
      return next;
    });
  };
  const separatorRef = useRef<HTMLDivElement>(null);
  const [separatorWidth, setSeparatorWidth] = useState<number | null>(null);
  useEffect(() => {
    // The width state lives with the panel; mirror the styled panel only
    // so the slider semantics stay truthful for assistive tech.
    const panel = separatorRef.current?.closest("aside");
    if (!panel) return;
    const read = () => setSeparatorWidth(panel.offsetWidth);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);
  const onSeparatorKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const widen = event.key === "ArrowLeft" ? PANEL_RESIZE_STEP : event.key === "ArrowRight" ? -PANEL_RESIZE_STEP : null;
    if (widen === null || separatorWidth === null) return;
    event.preventDefault();
    onResizeBy(widen);
  };
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
  const [pending, setPending] = useState<
    "join" | "sleep" | "provision" | "vps-replace" | "vm-start" | "vm-create" | "vm-recreate" | "vm-delete" | null
  >(null);
  const [controlPending, setControlPending] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [error, setError] = useState<Error | string | null>(null);
  const errorText = panelErrorText(error);
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
          if (initialAttempt) setError(readableError(e));
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
  useEffect(() => {
    if (phase !== "local" || !computerStatusCurrent || !window.ogb || isLinux || !pageVisible) return;
    let alive = true;
    setLocalMisses(0);
    const shoot = async () => {
      try {
        const url = await window.ogb!.screenFrame();
        if (alive && url) setLocalFrame(url);
        else if (alive) setLocalMisses((n) => n + 1);
      } catch {
        if (alive) setLocalMisses((n) => n + 1);
      }
    };
    void shoot();
    // A real ScreenCaptureKit capture + PNG encode per tick: idle bots get a
    // slow heartbeat, working ones the live cadence.
    const timer = setInterval(shoot, bot.busy ? 3000 : 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [phase, computerStatusCurrent, isLinux, pageVisible, bot.busy, bot.id, bot.threadId]);

  const frameSrc = !computerStatusCurrent ? null :
    phase === "vm"
      ? vmFrame
      : phase === "local" && !isLinux
      ? localFrame
      : cloudPreviewReady || (bot.computer === "cloud" && phase === "starting")
        ? polledFrame && `data:${polledFrame.mime};base64,${polledFrame.png}`
        : null;
  const previewOpensDesktop = Boolean(
    frameSrc &&
      ((phase === "vm" && vmViewerUrl) || cloudPreviewReady),
  );

  // who-is-driving: SSE keeps this fresh; the mount fetch covers a panel
  // opened after the last frame (e.g. an app reload mid-hold)
  const control = state.computerControl[bot.id] ?? { held: false, helpReason: null };
  useEffect(() => {
    let alive = true;
    api(`/api/bots/${bot.id}/computer/control`)
      .then((raw) => {
        if (!alive) return;
        const snap = computerControlSnapshotSchema.parse(raw);
        dispatch({
          type: "computerControl",
          botId: bot.id,
          held: snap.held === true,
          helpReason: snap.helpReason,
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id]);
  const requestControl = useCallback(async (action: ComputerControlAction) => {
    const snap = computerControlSnapshotSchema.parse(await api(`/api/bots/${bot.id}/computer/control`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }));
    dispatch({
      type: "computerControl",
      botId: bot.id,
      held: snap.held === true,
      helpReason: snap.helpReason,
    });
    return snap;
  }, [bot.id, dispatch]);

  // The engine owns its browser; there is no native surface to hold.
  const setNativeBrowserControl = useCallback(async (): Promise<boolean> => true, []);

  const transitionControl = useCallback(async (action: ComputerControlAction) => {
    // BrowserPanel performs the same two-phase transition itself. Every
    // other computer surface must also gate Electron's direct browser host:
    // the server hold is bot-wide, and a shell-capable agent can otherwise
    // bypass the server proxy while the person drives Local VM/Box/VPS.
    return transitionComputerControlLease({
      action,
      syncNativeBrowser: true,
      requestControl,
      setNativeBrowserControl,
    });
  }, [requestControl, setNativeBrowserControl]);

  const controlAction = useCallback(async (action: ComputerControlAction): Promise<boolean> => {
    setControlPending(true);
    setError(null);
    try {
      await transitionControl(action);
      return true;
    } catch (cause) {
      setError(readableError(cause));
      return false;
    } finally {
      setControlPending(false);
    }
  }, [transitionControl]);


  const openDesktop = async () => {
    const controller = new AbortController();
    desktopJoin.current = controller;
    const ownsConnection = () => !controller.signal.aborted && viewerConnection.current === viewerConnectionKey;
    setPending("join");
    setControlPending(true);
    setError(null);
    let tookControl = false;
    // A plain-web development session still needs a synchronous blank tab;
    // the packaged app uses the reliable Electron viewer window below.
    let fallbackTab: Window | null = null;
    if (!window.ogb?.desktopViewer && !window.ogb?.openExternal) {
      fallbackTab = window.open("", "_blank");
      if (fallbackTab) fallbackTab.opener = null;
    }
    try {
      if (!control.held) {
        await transitionControl("take");
        tookControl = true;
      }
      if (!ownsConnection()) throw new DOMException("The selected conversation changed", "AbortError");

      let viewerUrl = vmViewerUrl;
      if (cloudPreviewReady) {
        const result = await api(threadPath("computer/join"), { method: "POST", signal: controller.signal });
        viewerUrl = result.joinUrl?.constructor === String ? String(result.joinUrl) : null;
      }
      if (!ownsConnection()) throw new DOMException("The selected conversation changed", "AbortError");
      if (!viewerUrl) throw new LocalizedPanelError("computer.err.noDesktopLink");

      if (window.ogb?.desktopViewer) {
        // the app's own viewer offers Teach on this bot's computer (parity R7)
        const opened = await window.ogb.desktopViewer.open(withTeachBot(viewerUrl, bot), t("computer.viewerTitle", { name: bot.name }), bot.id);
        if (!opened) throw new LocalizedPanelError("computer.err.openDesktop");
      } else if (fallbackTab) {
        fallbackTab.location.replace(viewerUrl);
      } else if (window.ogb?.openExternal) {
        const opened = await window.ogb.openExternal(viewerUrl);
        if (!opened) throw new LocalizedPanelError("computer.err.openDesktopLink");
      } else if (!window.open(viewerUrl, "_blank", "noopener")) {
        throw new LocalizedPanelError("computer.err.popupBlocked");
      }
    } catch (e) {
      fallbackTab?.close();
      // Release the bot before waiting on best-effort tunnel cleanup. A sick
      // SSH process must never leave the agent paused indefinitely.
      if (tookControl) await transitionControl("release").catch(() => {});
      if (cloudPreviewReady && cloudBackend === "vps") {
        await api(threadPath("computer/viewer-close"), { method: "POST", body: "{}" }).catch(() => {});
      }
      if (ownsConnection()) setError(e instanceof Error ? e : String(e));
    } finally {
      if (desktopJoin.current === controller) {
        desktopJoin.current = null;
        setPending(null);
        setControlPending(false);
      }
    }
  };

  const run = (kind: "sleep" | "provision") => {
    setPending(kind);
    setError(null);
    api(`/api/bots/${bot.id}/computer/${kind}`, { method: "POST" })
      .then((result) => {
        if (kind === "provision") {
          setBoatState(result.container ?? null);
          if (result.ready) {
            if (bot.computer === "cloud") {
              setResolvedComputerSelection({ botId: bot.id, threadId: bot.threadId, computer: bot.computer, cloudBackend });
            }
            setPhase("ready");
          }
          else {
            setError(result.problem ?? new LocalizedPanelError("computer.err.vpsNotReady"));
            setPhase("error");
          }
        }
        if (kind === "sleep") {
          setResolvedComputerSelection(null);
          setBoatState(cloudBackend === "vps" ? "stopped" : "archived");
          if (cloudBackend === "vps") setPhase("vps-stopped");
          else setPhase(canManageCloud ? "cloud-asleep" : "show-sleeping-boat");
        }
      })
      .catch((e) => {
        setError(e.message);
      })
      .finally(() => setPending(null));
  };

  /** The person's own Start it now / Wake it now: the only way the panel
   * starts a cloud computer. Choosing it or opening the panel never does. */
  const startCloudComputer = () => {
    setPending("provision");
    setError(null);
    setPhase("starting");
    api(`/api/bots/${bot.id}/computer/provision`, { method: "POST" })
      .then((result) => {
        setBoatState(result.state ?? null);
        setResolvedComputerSelection({ botId: bot.id, threadId: bot.threadId, computer: bot.computer, cloudBackend });
        setPhase("ready");
      })
      .catch((e) => {
        // A turn started meanwhile: it starts the computer it needs, and the
        // panel watches.
        if (isActiveTurnRefusal(e)) {
          setPhase("busy-boat");
          return;
        }
        setError(e.message);
        setPhase("error");
      })
      .finally(() => setPending(null));
  };

  const runVmAction = async (action: "vm-start" | "vm-create" | "vm-recreate" | "vm-delete") => {
    if (
      (action === "vm-recreate" || action === "vm-delete") &&
      !window.confirm(
        action === "vm-delete"
          ? t("computer.confirm.deleteVm", { name: bot.name })
          : t("computer.confirm.replaceVm", { name: bot.name }),
      )
    ) return;
    if (vmActionController.current) return;
    const controller = new AbortController();
    vmActionController.current = controller;
    setPending(action);
    setError(null);
    vmReadinessAttempts.current = 0;
    try {
      if (action === "vm-recreate" || action === "vm-delete") {
        await api(`/api/bots/${bot.id}/local-computer/remove`, {
          method: "POST",
          body: "{}",
          signal: controller.signal,
        });
      }
      if (action !== "vm-delete") {
        // Shared mode has one desktop, started from the same route as Settings.
        const lifecyclePath = action === "vm-start" && vmStatus?.mode !== "per-bot"
          ? "/api/local-computer/start"
          : `/api/bots/${bot.id}/local-computer/${action === "vm-start" ? "start" : "run"}`;
        const started: LocalVmStatus = await api(lifecyclePath, {
          method: "POST",
          body: "{}",
          signal: controller.signal,
        });
        const status = await waitForLocalVmReady(started, () => api(threadPath("local-computer"), { signal: controller.signal }), controller.signal);
        if (!status.ready) throw new Error(status.problem ?? t("computer.err.vmNotReady"));
        setVmStatus(status);
        setPhase("vm");
      } else {
        setVmStatus((current) => current ? { ...current, container: "missing", ready: false } : current);
        setPhase("vm-unavailable");
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(readableError(e));
      setPhase("vm-unavailable");
    } finally {
      if (vmActionController.current === controller && !controller.signal.aborted) {
        vmActionController.current = null;
        setPending(null);
        setRetry((n) => n + 1);
      }
    }
  };

  const replaceVpsComputer = async () => {
    if (!window.confirm(t("computer.confirm.replaceVps", { name: bot.name }))) return;
    setPending("vps-replace");
    setError(null);
    try {
      await api(`/api/bots/${bot.id}/computer/remove`, { method: "POST", body: "{}" });
      const result: VpsComputerStatus = await api(`/api/bots/${bot.id}/computer/provision`, {
        method: "POST",
        body: "{}",
      });
      setVpsStatus(result);
      setBoatState(result.container ?? null);
      if (result.ready && bot.computer === "cloud") {
        setResolvedComputerSelection({ botId: bot.id, threadId: bot.threadId, computer: bot.computer, cloudBackend });
      }
      setPhase(result.ready ? "ready" : "error");
      if (!result.ready) setError(result.problem ?? new LocalizedPanelError("computer.err.vpsReplaceNotReady"));
    } catch (e) {
      setError(readableError(e));
      setPhase("error");
    } finally {
      setPending(null);
      setRetry((n) => n + 1);
    }
  };

  const openVmSettings = () => {
    window.sessionStorage.setItem("openmausbot.settings.section", "computer");
    dispatch({ type: "toggleAppSettings", open: true });
  };

  const openConnectionSettings = () => {
    requestSettingsCard("connections.integrations");
    dispatch({ type: "toggleAppSettings", open: true, section: "connections" });
  };

  // While a turn holds this conversation's cloud computer: only one that is
  // really starting spins (busyBoatView).
  const busyBoat = busyBoatView(boatState, profileBot.busy === true);
  // The live cloud computer, as this panel last saw it for this conversation
  // (the bot's Works on, or a pin to it). Nothing starts it but the bot's
  // first computer call or the person's own Start it now / Wake it now.
  const cloudComputer: PlaceFacts["computer"] = !computerStatusCurrent || livePlace !== "cloud" || cloudBackend !== "box" ? undefined
    : phase === "starting" ? "starting"
      : phase === "busy-boat" ? (busyBoat.spinner ? "starting" : busyBoat.line === "computer.cloud.asleep" ? "asleep" : "none")
        : phase === "ready" ? "on"
          : boatState === "archived" || boatState === "stopped" ? "asleep" : undefined;
  /** One place's state, line and action (shared/place-view.ts). */
  const viewOf = (place: PlaceFacts["place"], refusal?: PlaceFacts["refusal"]): PlaceView => placeViewFor({
    ...placeFacts({
      bot, place, seat: placeSeat, config: state.config, instances: state.instances,
      local: { ready: localSelectable, reason: localDisabledReason ?? t("computer.unavailableLocal") },
      ...(place === "cloud" ? { computer: cloudComputer } : {}),
      ...(place === "auto" && currentTeamComputer ? { teamComputer: currentTeamComputer.name } : {}),
    }),
    ...(refusal ? { refusal } : {}),
  });
  // A start this panel asked for and was refused (a plan limit, say) reads
  // as the same state a failed turn's row does, never the relay's words.
  const cloudRefused = bot.computer === "cloud" && cloudBackend === "box" && phase === "error" && error && !(error instanceof LocalizedPanelError)
    ? cloudRefusal({ message: errorText ?? "", status: Number((error as { status?: unknown }).status ?? 0) || undefined }, state.config?.box?.included === true)
    : undefined;
  const cloudView = viewOf("cloud", cloudRefused);
  const autoView = viewOf("auto");
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
  const placeActionButton = (view: PlaceView, className = "mt-1 rounded-lg bg-control px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover") =>
    view.action && panelOffers(view.action.id) ? (
      <button type="button" data-testid="place-action" onClick={() => runPlaceAction(view.action!.id)} className={className}>
        {view.action.label}
      </button>
    ) : null;

  const emptyState = {
    checking: t("computer.phase.checking"),
    starting: cloudBackend === "vps" ? t("computer.phase.starting") : cloudView.line,
    // A turn that has not used its cloud computer yet has not started one
    // (busyBoatView, read into the cloud computer's place view above).
    "busy-boat": cloudView.line,
    unconfigured: cloudView.line,
    "auto-unavailable": autoView.line,
    "team-boat": autoView.line,
    "show-ready-boat": t("computer.phase.showReadyBoat"),
    "show-sleeping-boat": t("computer.phase.showSleepingBoat"),
    "show-pending-boat": t("computer.phase.showPendingBoat"),
    "cloud-new": cloudView.line,
    "cloud-asleep": cloudView.line,
    "vps-unconfigured": t("computer.phase.vpsUnconfigured"),
    "vps-incompatible": t("computer.phase.vpsIncompatible"),
    "vps-stopped": t("computer.phase.vpsStopped"),
    "local-unavailable": localDisabledReason ?? t("computer.phase.localUnavailable"),
    "vm-unavailable": t("computer.phase.vmUnavailable"),
    browser: viewOf("browser").line,
    off: viewOf("off").line,
    error: bot.computer === "cloud" && (cloudRefused || placeBlocked(cloudView)) ? cloudView.line : t("computer.phase.error"),
  } satisfies Record<Exclude<Phase, "ready" | "local" | "vm">, string>;

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
  const moreItems: ComputerMoreItem[] = [];
  if (phase === "vm" && vmStatus?.mode === "per-bot" && window.ogb?.desktopWorkspace && onOpenVmWorkspace) {
    moreItems.push({ id: "two-desktops", icon: <Columns2 size={14} />, label: t("computer.twoDesktops"), title: t("computer.twoDesktopsTitle"), disabled: pending !== null, onSelect: () => onOpenVmWorkspace(bot.id) });
  }
  if (cloudPreviewReady && canManageCloud && (cloudBackend === "vps" || boatState !== "archived")) {
    moreItems.push({
      id: "sleep",
      icon: pending === "sleep" ? <Loader2 size={14} className="animate-spin" /> : <Moon size={14} />,
      label: t("vm.cloud.sleep"),
      title: t("computer.sleepTitle"),
      // the server refuses sleep while a turn owns the boat (409)
      disabled: pending === "sleep" || profileBot.busy,
      onSelect: () => run("sleep"),
    });
  }
  // (the boat phases keep their own Works on button in the status card)
  if (editComputer && primaryDesktop) {
    moreItems.push({ id: "works-on", icon: <Settings2 size={14} />, label: t("computer.worksOn"), onSelect: () => dispatch({ type: "toggleSettings", open: true, section: "worksOn" }) });
  }
  if (editComputer && canManageVm && phase === "vm" && vmStatus?.mode === "per-bot") {
    moreItems.push({
      id: "delete-vm",
      icon: pending === "vm-delete" ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />,
      label: t("computer.deleteVm"),
      title: profileBot.busy ? t("computer.deleteVmBlocked") : t("computer.deleteVmTitle", { name: bot.name }),
      disabled: pending !== null || profileBot.busy,
      danger: true,
      onSelect: () => void runVmAction("vm-delete"),
    });
  }

  const deviceBody = (
      <div className={embedded ? "pb-5" : "flex-1 overflow-y-auto px-5 pb-5"}>
          {soloPicker}
          {/* Screen preview. Works on lives in Edit persona > Access. */}
          <div className="mb-1.5 mt-2 flex items-center justify-between text-[13px] text-ink-secondary">
            <span>{t("computer.screenOf", { name: bot.name })}</span>
            {currentTeamComputer && <span className="text-[11px]">{autoView.short}</span>}
            {phase === "local" && <span className="text-[11px]">{t("computer.badge.local")}</span>}
            {phase === "vm" && <span className="text-[11px]">{t("vm.dest.vm")}</span>}
            {(phase === "show-ready-boat" || phase === "show-sleeping-boat" || phase === "show-pending-boat") && (
              <span className="text-[11px]">{t("computer.badge.autoBoat")}</span>
            )}
            {computerStatusCurrent && bot.computer === "cloud" && cloudBackend === "vps" && (phase === "ready" || phase === "starting") && <span className="text-[11px]">{t("computer.badge.vps")}</span>}
        </div>
        <div className="relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-md bg-card">
          {cloudPreviewReady || (bot.computer === "cloud" && phase === "starting") ? (
            <CloudScreenPreview
              key={`${bot.id}:${bot.threadId}:${bot.computer}:${cloudBackend}`}
              src={frameSrc}
              name={bot.name}
              error={panelErrorText(previewError)}
              refreshing={previewRefreshing}
              retry={previewRetry}
              starting={phase === "starting"}
              opening={pending === "join"}
              disabled={controlPending}
              onOpen={() => void openDesktop()}
              onRetry={(discardFrame) => {
                lastLiveAt.current = 0;
                if (discardFrame) setPolledFrame(null);
                setPreviewError(null);
                setPreviewRefreshing(true);
                setPreviewRetry((n) => n + 1);
              }}
            />
          ) : frameSrc && previewOpensDesktop ? (
            <button
              type="button"
              onClick={() => void openDesktop()}
              disabled={controlPending || pending === "join"}
              className="group relative flex h-full w-full cursor-pointer items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait"
              aria-label={t("computer.openLiveDesktopAria", { name: bot.name })}
              title={t("computer.openLiveDesktop")}
            >
              <img
                src={frameSrc}
                alt={t("computer.screenOf", { name: bot.name })}
                className="h-full w-full object-contain transition group-hover:brightness-75 group-focus-visible:brightness-75"
              />
              <span className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded-md bg-black/70 px-2 py-1 text-[11px] font-medium text-white opacity-80 shadow-sm transition group-hover:opacity-100 group-focus-visible:opacity-100">
                {pending === "join" ? <Loader2 size={12} className="animate-spin" /> : <Maximize2 size={12} />}
                {t("computer.open")}
              </span>
            </button>
          ) : frameSrc ? (
            <img
              src={frameSrc}
              alt={t("computer.screenOf", { name: bot.name })}
              className="h-full w-full object-contain"
              title={phase === "vm" ? t("computer.watchOnly") : undefined}
            />
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 text-center text-ink-secondary">
              {phase === "checking" || phase === "starting" || (phase === "busy-boat" && busyBoat.spinner) || phase === "vm" || (phase === "local" && !isLinux) ? (
                <Loader2 size={18} className="animate-spin" />
              ) : phase === "off" ? (
                <Power size={22} />
              ) : (
                <Monitor size={22} />
              )}
              <span className="text-[12px]">
                {currentTeamComputer
                  ? autoView.line
                  : cloudPreviewReady
                  ? t("computer.waitingFrame")
                  : phase === "ready"
                    ? t("computer.autoChooseCloudOpen")
                  : phase === "vm"
                    ? t("computer.capturingVm")
                  : phase === "local"
                    ? isLinux
                      ? t("computer.linuxReady")
                      : localMisses >= 3
                      ? t("computer.needsScreenPerm")
                      : t("computer.capturingLocal")
                    : vmResumable
                      ? t(pending === "vm-start" ? "vm.setup.starting" : "computer.phase.vmStopped")
                      : emptyState[phase]}
              </span>
              {currentTeamComputer && placeActionButton(autoView)}
              {bot.computer === "cloud" && (phase === "unconfigured" || phase === "error") && cloudView.action?.id !== "add-boat-key" && placeActionButton(cloudView)}
              {phase === "local" && !isLinux && localMisses >= 3 && (
                <button
                  onClick={() => window.ogb?.permOpenSettings?.("screen")}
                  className="mt-1 rounded-lg bg-control px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover"
                >
                  {t("computer.openSettings")}
                </button>
              )}

              {editComputer && (phase === "show-ready-boat" || phase === "show-sleeping-boat" || phase === "show-pending-boat") && (
                <button
                  type="button"
                  onClick={() => dispatch({ type: "toggleSettings", open: true, section: "worksOn" })}
                  className="mt-1 rounded-lg bg-control px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover"
                >
                  {t("computer.worksOn")}
                </button>
              )}
              {pending === null && (phase === "cloud-new" || phase === "cloud-asleep") && placeActionButton(cloudView)}
              {vmResumable && pending !== "vm-start" && (
                <p className="text-[12px]">{t(vmStatus?.stop_reason === "idle" ? "vm.stopped.idle" : "vm.stopped.detail")}</p>
              )}
              {phase === "vm-unavailable" && (
                canManageVm && vmResumable && vmStatus.mode !== "pool" ? (
                  <button
                    onClick={() => void runVmAction("vm-start")}
                    disabled={pending !== null}
                    aria-busy={pending === "vm-start"}
                    className="mt-1 flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:brightness-110 disabled:opacity-50"
                  >
                    {pending === "vm-start" && <Loader2 size={13} className="animate-spin" />}
                    {t(pending === "vm-start" ? "vm.setup.starting" : "vm.setup.start")}
                  </button>
                ) : canManageVm && vmStatus?.mode === "per-bot" && vmStatus.image && vmStatus.create_supported ? (
                  <button
                    onClick={() => void runVmAction(vmStatus.container === "missing" ? "vm-create" : "vm-recreate")}
                    disabled={pending !== null}
                    className="mt-1 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
                  >
                    {(pending === "vm-create" || pending === "vm-recreate") && (
                      <Loader2 size={13} className="mr-1.5 inline animate-spin" />
                    )}
                    {vmStatus.container === "missing"
                      ? t("computer.createVm", { name: bot.name })
                      : t("computer.replaceVm", { name: bot.name })}
                  </button>
                ) : (
                  <button
                    onClick={openVmSettings}
                    className="mt-1 rounded-lg bg-control px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover"
                  >
                    {t("computer.openVmSetup")}
                  </button>
                )
              )}
              {computerStatusCurrent && (phase === "vps-unconfigured" || phase === "vps-stopped") && (
                <button
                  onClick={openConnectionSettings}
                  className="mt-1 rounded-lg bg-control px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover"
                >
                  {t("computer.openVpsSettings")}
                </button>
              )}
              {computerStatusCurrent && (phase === "vps-stopped" || (phase === "vps-unconfigured" && vpsStatus?.configured)) &&
                canManageCloud && (
                <button
                  onClick={() => run("provision")}
                  disabled={pending === "provision"}
                  className="mt-1 rounded-lg bg-control px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover disabled:opacity-50"
                >
                  {pending === "provision" && <Loader2 size={13} className="mr-1.5 inline animate-spin" />}
                  {phase === "vps-stopped" ? t("computer.startVps") : t("computer.prepareVps")}
                </button>
              )}
              {computerStatusCurrent && phase === "vps-incompatible" && vpsStatus?.managed &&
                canManageCloud && (
                <button
                  onClick={() => void replaceVpsComputer()}
                  disabled={pending === "vps-replace"}
                  className="mt-1 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
                >
                  {pending === "vps-replace" && <Loader2 size={13} className="mr-1.5 inline animate-spin" />}
                  {t("computer.replaceVps")}
                </button>
              )}
            </div>
          )}
        </div>

        {errorText && !cloudRefused && (
          <div className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {errorText}
          </div>
        )}
        {phase === "unconfigured" && manageKeys && (
          <div className="mt-3 rounded-xl bg-card p-4">
            <div className="mb-3 text-[13px] text-ink-secondary">
              <SettingsText text={t("computer.addBoatKey")} links={{ settings: { section: "connections", cardId: "connections.integrations" } }} />
            </div>
            <button
              type="button"
              onClick={openConnectionSettings}
              className="rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover"
            >
              {t("settings.section.models")}
            </button>
          </div>
        )}
        {phase === "vps-unconfigured" && (
          <div className="mt-3 rounded-xl bg-card p-4">
            <div className="mb-3 text-[13px] text-ink-secondary">
              <SettingsText text={t("computer.vpsAliasHint")} links={{ settings: { section: "connections", cardId: "connections.integrations" } }} />
            </div>
            <button
              onClick={openConnectionSettings}
              className="rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover"
            >
              {t("computer.openVpsSettings")}
            </button>
          </div>
        )}

        {/* Who is driving — take the wheel / hand it back */}
        {(cloudPreviewReady || phase === "vm" || currentTeamComputer) && control.helpReason && !control.held && (
          <div className="mt-3 rounded-xl border border-warning/25 bg-warning/10 p-4">
            <div className="text-[13px] leading-relaxed text-warning">
              <b>{bot.name}</b> {t("computer.askedHands")} {control.helpReason}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() =>
                  phase === "vm" || cloudPreviewReady ? void openDesktop() : controlAction("take")
                }
                disabled={controlPending || pending === "join"}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent py-2 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
              >
                {pending === "join" ? <Loader2 size={14} className="animate-spin" /> : <Hand size={14} />}
                {t("computer.takeControl")}
              </button>
              <button
                onClick={() => controlAction("dismiss-help")}
                disabled={controlPending}
                className="rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
              >
                {t("computer.dismiss")}
              </button>
            </div>
          </div>
        )}
        {(cloudPreviewReady || phase === "vm" || currentTeamComputer) && control.held && (
          <div className="mt-3 rounded-xl border border-accent/25 bg-accent/10 p-4">
            <div className="text-[13px] leading-relaxed text-ink">
              {t("computer.youHaveWheel")}
              {cloudPreviewReady && ` ${t("computer.useOpenDesktop")}`}
              {phase === "vm" && ` ${t("computer.useOpenDesktopVm")}`}
            </div>
            <button
              onClick={() => {
                controlAction("release");
                void window.ogb?.desktopViewer?.close(bot.id);
              }}
              disabled={controlPending}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
            >
              <Hand size={14} />
              {t("computer.handBack")}
            </button>
          </div>
        )}
        {/* One main action: Open live desktop (it takes the wheel first when
            the bot holds it). The rest (two desktops, Sleep, Delete the VM,
            Works on) sits in the "..." beside it. */}
        {(primaryDesktop || moreItems.length > 0) && (
          <div className="mt-3 flex gap-2" data-computer-actions="">
            {primaryDesktop && (
              <button
                type="button"
                data-computer-open-desktop=""
                onClick={() => void openDesktop()}
                disabled={(!control.held && controlPending) || pending === "join" || (phase === "vm" && !vmViewerUrl)}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-control py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
                title={control.held
                  ? (phase === "vm" ? t("computer.openVmDesktopTitle") : undefined)
                  : t(phase === "vm" ? "computer.takeControlVmTitle" : "computer.takeControlTitle")}
              >
                {pending === "join" ? <Loader2 size={14} className="animate-spin" /> : <Monitor size={14} />}
                {t("computer.openLiveDesktop")}
              </button>
            )}
            {moreItems.length > 0 && <ComputerMoreMenu items={moreItems} />}
          </div>
        )}

        {phase !== "team-boat" && (bot.computer !== undefined || computerStatusCurrent) && <>
          <LocalScreenPreview />
          <LinuxLocalControl />
          <MacLocalControl />
        </>}

        {!embedded && <div className="mt-6">
          <RoutinesSection key={bot.id} bot={bot} routines={botRoutines} runs={state.routineRuns} defaultRunOn={cloudRoutineReady ? "cloud" : "maus"} />
        </div>}
        {androidConnected && (
          <div className="mt-6">
            <AndroidDevicePanel status={androidStatus} />
          </div>
        )}
      </div>
  );

  // Organization server (a desktop bridge status exists): the computer is
  // the person's server environment or their own PC, never this bot's own
  // (src/components/computer/OrgComputerTab.tsx). Enrolled hosts attached
  // to this bot appear as places (2026-11-01).
  const { rows: remoteSessionRows, reload: reloadRemoteSessions } = useRemoteSessions(bridgeStatus ? bot.id : undefined);
  // Only connected sessions: ended or temporary ones never linger as active.
  const activeRemoteSessions = remoteSessionRows.filter((row) => row.state === "connected");
  const [remoteHostRows, setRemoteHostRows] = useState<UnattendedHostRow[]>([]);
  const reloadRemoteHosts = useCallback(() => {
    if (!bridgeStatus) return;
    fetchBotRemoteHosts(bot.id)
      .then((body) => setRemoteHostRows(body.hosts))
      .catch(() => {});
  }, [bridgeStatus, bot.id]);
  useEffect(() => { reloadRemoteHosts(); }, [reloadRemoteHosts]);
  const onPickRemoteHost = useCallback((hostId: string) => {
    void openBotRemoteHost(bot.id, hostId).then((out) => {
      if (out.ok) reloadRemoteSessions();
    });
  }, [bot.id, reloadRemoteSessions]);
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
        inUse={livePlace === "auto" ? (autoSurfaceCurrent ? (autoSurface.surface ?? "unknown") : "unknown") : livePlace}
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
    {embedded ? null : <aside
      className={cn(
        "animate-panel-in relative flex h-full shrink-0 flex-col border-l-[0.5px] border-hairline-weak bg-panel",
        // Below md (a phone on remote access) the stored width would push the
        // chat to zero and run off the edge, so cover the window like the
        // settings and inspector panels. `!` beats the inline width.
        "max-md:absolute max-md:inset-0 max-md:z-40 max-md:w-full!",
      )}
      style={{ width: panelWidth }}
    >
      <div
        ref={separatorRef}
        role="separator"
        aria-orientation="vertical"
        aria-label={t("computer.resizeAria")}
        aria-valuemin={PANEL_MIN_WIDTH}
        aria-valuemax={PANEL_MAX_WIDTH}
        aria-valuenow={separatorWidth ?? undefined}
        tabIndex={0}
        onKeyDown={onSeparatorKeyDown}
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        className="app-resize-handle -left-[3px] max-md:hidden"
      />
      {/* Header */}
      <div className={cn("relative flex h-11 shrink-0 items-center justify-center px-12", padClass)}>
        <button
          type="button"
          onClick={() => {
            dispatch({ type: "toggleComputer", open: false });
            dispatch({ type: "toggleSettings", open: true });
          }}
          aria-label={t("computer.back")}
          title={t("computer.back")}
          className="absolute left-2.5 flex size-8 items-center justify-center rounded-full bg-raised text-ink-secondary hover:text-ink"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="truncate text-[14px] font-semibold text-ink">{t("botPanel.tab.computer")}</span>
        <button
          type="button"
          onClick={() => dispatch({ type: "toggleComputer", open: false })}
          aria-label={t("computer.close")}
          title={t("computer.close")}
          className={cn(CIRCLE_BUTTON, "absolute right-2.5")}
        >
          <PanelRight size={18} strokeWidth={1.75} />
        </button>
      </div>
      {shown}
    </aside>}
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
