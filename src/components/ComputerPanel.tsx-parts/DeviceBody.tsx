import type { MutableRefObject, ReactNode } from "react";
import { Hand, Loader2, Maximize2, Monitor, Power } from "lucide-react";
import type { Action, Bot } from "@/state/store";
import type { Routine, RoutineRun } from "@/lib/routines";
import { t } from "@/lib/i18n";
import type { AndroidDeviceStatus } from "@/types/ogb";
import type { CloudBackend } from "../../../shared/wire";
import type { PlaceActionId, PlaceView } from "../../../shared/place-view";
import type { ComputerControlAction } from "@/lib/computer-control";
import { CloudScreenPreview } from "../CloudScreenPreview";
import { LocalScreenPreview } from "../LocalScreenPreview";
import { LinuxLocalControl } from "../LinuxLocalControl";
import { MacLocalControl } from "../MacLocalControl";
import { ComputerMoreMenu, type ComputerMoreItem } from "../computer/ComputerMoreMenu";
import { RoutinesSection } from "../bot-settings/RoutinesSection";
import { AndroidDevicePanel } from "../AndroidDevicePanel";
import { SettingsText } from "../SettingsLink";
import { panelErrorText } from "./errors";
import type { ComputerPending, LocalVmStatus, Phase, VpsComputerStatus } from "./types";

export function placeActionButton(
  view: PlaceView,
  onAction: (id: PlaceActionId) => void,
  offers: (id: PlaceActionId | undefined) => id is PlaceActionId,
  className = "mt-1 rounded-lg bg-control px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover",
) {
  return view.action && offers(view.action.id) ? (
    <button type="button" data-testid="place-action" onClick={() => onAction(view.action!.id)} className={className}>
      {view.action.label}
    </button>
  ) : null;
}

export function ComputerDeviceBody(props: {
  embedded: boolean;
  soloPicker: ReactNode;
  bot: Bot;
  phase: Phase;
  cloudBackend: CloudBackend;
  computerStatusCurrent: boolean;
  currentTeamComputer: { id: string; name: string } | null;
  autoView: PlaceView;
  cloudView: PlaceView;
  cloudPreviewReady: boolean;
  frameSrc: string | null;
  previewOpensDesktop: boolean;
  previewError: Error | string | null;
  previewRefreshing: boolean;
  previewRetry: number;
  pending: ComputerPending;
  controlPending: boolean;
  control: { held: boolean; helpReason: string | null };
  lastLiveAt: MutableRefObject<number>;
  setPolledFrame: (value: { png: string; mime: string } | null) => void;
  setPreviewError: (value: Error | string | null) => void;
  setPreviewRefreshing: (value: boolean) => void;
  setPreviewRetry: (updater: (n: number) => number) => void;
  openDesktop: () => void;
  busyBoat: { spinner: boolean; line: string };
  isLinux: boolean;
  localMisses: number;
  vmResumable: boolean;
  emptyState: Record<Exclude<Phase, "ready" | "local" | "vm">, string>;
  panelOffers: (id: PlaceActionId | undefined) => id is PlaceActionId;
  runPlaceAction: (id: PlaceActionId) => void;
  editComputer: boolean;
  dispatch: (action: Action) => void;
  vmStatus: LocalVmStatus | null;
  canManageVm: boolean;
  canManageCloud: boolean;
  runVmAction: (action: "vm-start" | "vm-create" | "vm-recreate" | "vm-delete") => void;
  openVmSettings: () => void;
  openConnectionSettings: () => void;
  vpsStatus: VpsComputerStatus | null;
  run: (kind: "sleep" | "provision") => void;
  replaceVpsComputer: () => void;
  errorText: string | null;
  cloudRefused: unknown;
  manageKeys: boolean;
  controlAction: (action: ComputerControlAction) => void;
  primaryDesktop: boolean;
  moreItems: ComputerMoreItem[];
  vmViewerUrl: string | null;
  botRoutines: Routine[];
  routineRuns: RoutineRun[];
  cloudRoutineReady: boolean;
  androidConnected: boolean;
  androidStatus: AndroidDeviceStatus;
}) {
  const {
    embedded, soloPicker, bot, phase, cloudBackend, computerStatusCurrent, currentTeamComputer,
    autoView, cloudView, cloudPreviewReady, frameSrc, previewOpensDesktop, previewError,
    previewRefreshing, previewRetry, pending, controlPending, control, lastLiveAt,
    setPolledFrame, setPreviewError, setPreviewRefreshing, setPreviewRetry, openDesktop,
    busyBoat, isLinux, localMisses, vmResumable, emptyState, panelOffers, runPlaceAction,
    editComputer, dispatch, vmStatus, canManageVm, canManageCloud, runVmAction, openVmSettings,
    openConnectionSettings, vpsStatus, run, replaceVpsComputer, errorText, cloudRefused,
    manageKeys, controlAction, primaryDesktop, moreItems, vmViewerUrl, botRoutines, routineRuns,
    cloudRoutineReady, androidConnected, androidStatus,
  } = props;

  return (
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
            {currentTeamComputer && placeActionButton(autoView, runPlaceAction, panelOffers)}
            {bot.computer === "cloud" && (phase === "unconfigured" || phase === "error") && cloudView.action?.id !== "add-boat-key" && placeActionButton(cloudView, runPlaceAction, panelOffers)}
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
            {pending === null && (phase === "cloud-new" || phase === "cloud-asleep") && placeActionButton(cloudView, runPlaceAction, panelOffers)}
            {vmResumable && pending !== "vm-start" && (
              <p className="text-[12px]">{t(vmStatus?.stop_reason === "idle" ? "vm.stopped.idle" : "vm.stopped.detail")}</p>
            )}
            {phase === "vm-unavailable" && (
              canManageVm && vmResumable && vmStatus?.mode !== "pool" ? (
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
        <RoutinesSection key={bot.id} bot={bot} routines={botRoutines} runs={routineRuns} defaultRunOn={cloudRoutineReady ? "cloud" : "maus"} />
      </div>}
      {androidConnected && (
        <div className="mt-6">
          <AndroidDevicePanel status={androidStatus} />
        </div>
      )}
    </div>
  );
}
