import type { MutableRefObject } from "react";
import type { Bot } from "@/state/store";
import { api } from "@/state/store";
import type { CloudBackend } from "../../../shared/wire";
import { resolveBoatPanelAction } from "@/lib/local-computer";
import { LocalizedPanelError } from "./errors";
import type { LocalVmStatus, Phase, VpsComputerStatus } from "./types";

export type PhaseResolveBot = Pick<Bot, "id" | "threadId" | "computer" | "section" | "autoStartVps" | "busy"> & {
  computer: Bot["computer"];
};

export interface PhaseResolveSetters {
  setResolvedComputerSelection: (value: {
    botId: string;
    threadId: string;
    computer: Bot["computer"];
    cloudBackend: CloudBackend;
  } | null) => void;
  setTeamComputer: (value: { id: string; name: string; botId: string; section: string } | null) => void;
  setPhase: (phase: Phase) => void;
  setPolledFrame: (value: { png: string; mime: string } | null) => void;
  setPreviewError: (value: Error | string | null) => void;
  setVmFrame: (value: string | null) => void;
  setVmViewerUrl: (value: string | null) => void;
  setVmStatus: (value: LocalVmStatus | null) => void;
  setVpsStatus: (value: VpsComputerStatus | null) => void;
  setLocalFrame: (value: string | null) => void;
  setError: (value: Error | string | null) => void;
  setBoatState: (value: string | null) => void;
  setRetry: (updater: (n: number) => number) => void;
}

export interface PhaseResolveInput extends PhaseResolveSetters {
  bot: PhaseResolveBot;
  profileBotBusy: boolean | undefined;
  cloudBackend: CloudBackend;
  computerSelectionPersisted: boolean;
  surfaceReady: boolean;
  providerSupportsLocal: boolean;
  capabilitiesReady: boolean;
  localAvailable: boolean;
  vmSupported: boolean;
  cloudSupported: boolean;
  canManageCloud: boolean;
  livePlace: string;
  threadPath: (suffix: string) => string;
  vmReadinessAttempts: MutableRefObject<number>;
}

/** Start the panel's computer-status resolve. Returns a cleanup, or void when
 * the path is synchronous. Same branches as the former inline useEffect. */
export function attachPhaseResolve(input: PhaseResolveInput): (() => void) | void {
  const {
    bot,
    profileBotBusy,
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
  } = input;

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
    return attachVmPhaseResolve({
      alive: () => alive,
      setAlive: (value) => { alive = value; },
      bot,
      cloudBackend,
      vmSupported,
      threadPath,
      vmReadinessAttempts,
      setResolvedComputerSelection,
      setVmStatus,
      setVmViewerUrl,
      setPhase,
      setError,
      setRetry,
    });
  }
  if (bot.computer === "cloud" && !cloudSupported) {
    // Its line is the cloud computer's own place view, below.
    setPhase("error");
    return;
  }
  if (bot.computer !== "cloud" && !capabilitiesReady) return;
  if (cloudBackend === "vps") {
    return attachVpsPhaseResolve({
      alive: () => alive,
      setAlive: (value) => { alive = value; },
      bot,
      cloudBackend,
      canManageCloud,
      threadPath,
      setVpsStatus,
      setResolvedComputerSelection,
      setBoatState,
      setPhase,
      setError,
    });
  }
  // Opening the panel only looks. With Cloud computer chosen, the bot's
  // first computer call creates or wakes the Boat, or the person's own
  // Start it now / Wake it now button does; on Auto the panel only reports
  // an existing Boat.
  return attachBoatPhaseResolve({
    alive: () => alive,
    setAlive: (value) => { alive = value; },
    bot,
    profileBotBusy,
    cloudBackend,
    cloudSupported,
    livePlace,
    threadPath,
    setResolvedComputerSelection,
    setTeamComputer,
    setBoatState,
    setError,
    setPhase,
  });
}

function attachVmPhaseResolve(args: {
  alive: () => boolean;
  setAlive: (value: boolean) => void;
  bot: PhaseResolveBot;
  cloudBackend: CloudBackend;
  vmSupported: boolean;
  threadPath: (suffix: string) => string;
  vmReadinessAttempts: MutableRefObject<number>;
  setResolvedComputerSelection: PhaseResolveSetters["setResolvedComputerSelection"];
  setVmStatus: PhaseResolveSetters["setVmStatus"];
  setVmViewerUrl: PhaseResolveSetters["setVmViewerUrl"];
  setPhase: PhaseResolveSetters["setPhase"];
  setError: PhaseResolveSetters["setError"];
  setRetry: PhaseResolveSetters["setRetry"];
}): () => void {
  const {
    alive, setAlive, bot, cloudBackend, vmSupported, threadPath, vmReadinessAttempts,
    setResolvedComputerSelection, setVmStatus, setVmViewerUrl, setPhase, setError, setRetry,
  } = args;
  if (!vmSupported) {
    setError(new LocalizedPanelError("computer.err.vmEngine"));
    setPhase("vm-unavailable");
    return () => { setAlive(false); };
  }
  let retryTimer: number | undefined;
  api(threadPath("local-computer"))
    .then((rawStatus) => {
      if (!alive()) return;
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
      if (!alive()) return;
      setError(e.message);
      setPhase("vm-unavailable");
    });
  return () => {
    setAlive(false);
    if (retryTimer !== undefined) window.clearTimeout(retryTimer);
  };
}

function attachVpsPhaseResolve(args: {
  alive: () => boolean;
  setAlive: (value: boolean) => void;
  bot: PhaseResolveBot;
  cloudBackend: CloudBackend;
  canManageCloud: boolean;
  threadPath: (suffix: string) => string;
  setVpsStatus: PhaseResolveSetters["setVpsStatus"];
  setResolvedComputerSelection: PhaseResolveSetters["setResolvedComputerSelection"];
  setBoatState: PhaseResolveSetters["setBoatState"];
  setPhase: PhaseResolveSetters["setPhase"];
  setError: PhaseResolveSetters["setError"];
}): () => void {
  const {
    alive, setAlive, bot, cloudBackend, canManageCloud, threadPath,
    setVpsStatus, setResolvedComputerSelection, setBoatState, setPhase, setError,
  } = args;
  api(threadPath("computer"))
    .then((rawStatus) => {
      if (!alive()) return;
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
          if (!alive()) return;
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
      if (!alive()) return;
      setError(e.message);
      setPhase("error");
    });
  return () => {
    setAlive(false);
  };
}

function attachBoatPhaseResolve(args: {
  alive: () => boolean;
  setAlive: (value: boolean) => void;
  bot: PhaseResolveBot;
  profileBotBusy: boolean | undefined;
  cloudBackend: CloudBackend;
  cloudSupported: boolean;
  livePlace: string;
  threadPath: (suffix: string) => string;
  setResolvedComputerSelection: PhaseResolveSetters["setResolvedComputerSelection"];
  setTeamComputer: PhaseResolveSetters["setTeamComputer"];
  setBoatState: PhaseResolveSetters["setBoatState"];
  setError: PhaseResolveSetters["setError"];
  setPhase: PhaseResolveSetters["setPhase"];
}): () => void {
  const {
    alive, setAlive, bot, profileBotBusy, cloudBackend, cloudSupported, livePlace, threadPath,
    setResolvedComputerSelection, setTeamComputer, setBoatState, setError, setPhase,
  } = args;
  api(threadPath("computer"))
    .then((status) => {
      if (!alive()) return;
      const action = resolveBoatPanelAction({
        // This conversation is on the cloud computer: the bot's Works on,
        // or a pin (the person's, or select_computer's).
        computer: livePlace === "cloud" ? "cloud" : undefined,
        configured: Boolean(status.configured),
        boatState: typeof status.box?.state === "string" ? status.box.state : null,
        canUseCloud: cloudSupported,
        autoLocal: false,
        teamComputer: typeof status.teamComputer?.id === "string" && typeof status.teamComputer?.name === "string",
        busy: profileBotBusy,
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
      if (!alive()) return;
      setError(e.message);
      setPhase("error");
    });
  return () => {
    setAlive(false);
  };
}
