// Activity > Computer (reference design, #2125 / #2187): one row, "Bot's
// computer" over Awake (or Working while the bot is busy), a recent capture
// of the computer the bot works on now as a thumbnail on the right
// (useComputerThumbnail: switching computers switches the picture at once;
// an old or offline capture is greyed out; a click on it opens it larger). A click opens the live
// screen window at once (SandboxDesktopModal: Watching / You have control):
// the desktop, or the bot's browser for a bot that works in its browser. It
// is the one screen window of the bot's computer (#4208): every link that
// opens the computer (the store's computerOpen) opens it here, with the
// browser recording for Teach a task; the old side panel is gone. What the
// row cannot hold (Start it now, Wake it now, Sleep, Replace, the Local VM's
// Start, the cloud and team place actions, the Mac Screen Recording
// recovery, Linux local control, a USB Android phone, an organization's
// Screen | Browser chips and usage) has no entry here any more (the
// Computer details window was removed). The "..." menu lists the same
// computers as the chat Computer menu / LocalComputerSection
// (`computerChoices`); picking one changes the bot's Works on and refreshes
// the card. A viewer who may not change it sees no "...".
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Box, Check, Cloud, Laptop, MonitorOff, MoreHorizontal, Sparkles } from "lucide-react";

import type { Bot } from "@/state/store";
import { PANEL_CARD, PANEL_LABEL, PANEL_ROW } from "@/lib/grouped-card";
import { t } from "@/lib/i18n";
import { useStoreSelector } from "@/state/store-selector";
import { cn } from "@/lib/cn";
import { effectivePlace, placeLabelKey, placeOffered } from "@/lib/place";
import { localVmChoice, localVmDesktopState, type LocalVmChoice } from "@/lib/local-vm-choice";
import { placeLabel } from "@/lib/place-labels";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { isMacPlatform } from "@/lib/is-mac-platform";
import {
  SCREEN_PROBLEM_LINE,
  SCREEN_PROBLEM_SHORT,
  computerCardView,
  localScreenProblem,
  ownComputerScreenTakeover,
  ownScreenCapture,
  useCloudAsleep,
  useScreenPermission,
} from "@/lib/computer-screen-state";
import {
  computerChoices,
  currentDesktop,
  useDesktopBridgeStatus,
  type ComputerChoice,
  type DesktopBridgeStatus,
} from "@/lib/desktop-bridge";
import { DEFAULT_BOT_WORKPLACE } from "../../../shared/bot-workplace";
import { osLabel, parseHostOs, type BotComputerHostView } from "../../../shared/bot-computer-host";
import { useBotHostComputer } from "@/lib/host-computers";
import { api } from "@/state/store";
import type { PillOption } from "../SettingsPrimitives";
import { navigateThreadMenu } from "../BotProjects";
import { SandboxDesktopModal } from "../computer/SandboxDesktopModal";
import { BrowserWindow, type BrowserSignIn } from "../BrowserPanel";
import type { ComputerWindowView } from "@/state/store/model";
import { LocalLiveScreen } from "../computer/LocalLiveScreen";
import { ComputerIdleBot } from "../computer/ComputerScreen";
import { worksOnMode } from "../computer/WorksOnSetting";
import { activeComputer } from "../computer/OrgComputerTab";
import { ViewerDialog } from "../ViewerDialog";
import {
  COMPUTER_THUMBNAIL_STALE_MS,
  thumbnailComputerFor,
  sameHost,
  thumbnailDesktop,
  useComputerThumbnail,
} from "@/lib/computer-thumbnail";
import { MENU_ROW, MENU_SURFACE, MenuDivider, MENU_FIT_ROW, useMenuInWindow } from "@/components/menu-look";

type ComputerSelectValue = "auto" | "cloud" | "local" | "vm" | "browser";

type ComputerPatch = { computer: Bot["computer"] | null };

const EMPTY_BRIDGE: DesktopBridgeStatus = {
  connected: false,
  tunnel: false,
  desktops: [],
  workplace: { ...DEFAULT_BOT_WORKPLACE },
  activity: [],
};

/** Works on value shown in the section's PillSelect. */
export function computerSelectValue(computer: Bot["computer"] | null | undefined): ComputerSelectValue {
  const mode = worksOnMode(computer);
  if (mode === null) return "auto";
  return mode;
}

/** One row of the computer row's context menu. Every row has the same
 * shape (JC 2026-11-09: "they should all be looking the same"): a leading
 * mark (an icon, or a status dot for a real machine), the name, a grey line
 * under it, and the check on the right. */
export type ComputerMenuOption = PillOption<ComputerSelectValue> & {
  /** The grey line under the name. */
  detail: string;
  /** The leading mark: an icon, or a dot for a connected computer. */
  lead: "auto" | "cloud" | "computer" | "vm" | "online";
};

/** The grey line of a named computer: its OS, then that it is this one. */
function desktopDetail(platform: string): string {
  const os = parseHostOs(platform);
  return os ? `${osLabel(os)} \u00b7 ${t("place.local")}` : t("place.local");
}

/** Options for the computer row's context menu: Auto, This computer, Local VM
 * and Cloud. Local VM is listed when a connected computer registered one
 * (or on a solo server, whose Local VM is its own). It stays in the list,
 * not selectable, with the reason, only when it cannot be used. A cloud
 * home has none. Never Off: it hid the card. Auto's "picks per task" is its
 * grey line, not its name. */
export function computerSelectOptions(
  bridge: DesktopBridgeStatus | null,
  organization: boolean,
  cloudOffered = true,
  vmChoice: LocalVmChoice = localVmChoice({ desktop: localVmDesktopState(bridge, organization) }),
): ComputerMenuOption[] {
  const choices = computerChoices(bridge);
  const localChoices = choices.filter((choice): choice is Extract<ComputerChoice, { source: "local" }> => choice.source === "local");
  const auto: ComputerMenuOption = { value: "auto", label: t("place.auto"), detail: t("computerMenu.autoDetail"), lead: "auto" };
  const cloud: ComputerMenuOption = { value: "cloud", label: cloudComputerLabel(organization), lead: "cloud",
    detail: t(organization ? "computerMenu.cloudOrgDetail" : "computerMenu.cloudDetail") };
  const only = localChoices.length === 1 ? localChoices[0]! : null;
  const local: ComputerMenuOption = only
    ? { value: "local", label: placeLabel(only.key, only.name), detail: desktopDetail(only.platform), lead: "online" }
    : { value: "local", label: t(placeLabelKey("local", organization)), detail: t("computerMenu.localDetail"), lead: "computer" };
  const vm: ComputerMenuOption | null = vmChoice.shown
    ? { value: "vm", label: t("place.vm"), detail: vmChoice.reason ?? t("computerMenu.vmDetail"), lead: "vm", disabled: !vmChoice.selectable }
    : null;
  const places = [local, ...(vm ? [vm] : [])];
  // No cloud computer and no Local VM: only This computer. Auto, which would
  // only choose between places, goes too. With a Local VM, Auto stays.
  if (!cloudOffered && places.length === 1) return places;
  return [...(cloudOffered || places.length > 1 ? [auto] : []), ...places, ...(cloudOffered ? [cloud] : [])];
}

/** The cloud computer's one name, on the card and in its menu row. */
function cloudComputerLabel(organization: boolean): string {
  return organization ? placeLabel("server", t("orgComputer.choice.cloud")) : t("place.cloud");
}

/** Card title for the current Works on (named local PC when the bridge knows one). */
export function computerCardTitle(
  computer: Bot["computer"] | null | undefined,
  bridge: DesktopBridgeStatus | null,
  organization: boolean,
): string {
  const mode = worksOnMode(computer);
  if (mode === "cloud") return cloudComputerLabel(organization);
  if (mode === "local") {
    const desktop = currentDesktop(bridge);
    if (desktop) return placeLabel(`desktop:${desktop.id}`, desktop.name.trim() || t("computerScreen.computer"));
    return t(placeLabelKey("local", organization));
  }
  if (mode === "vm") return t("place.vm");
  return t("botPanel.computerCard.title");
}

/** In Auto, the computer the bot really works on now (the server's preview
 * of its next turn), instead of guessing "this Mac when it is connected". */
export type AutoSurface = "cloud" | "local" | "vm" | "browser" | "off";

export function autoCardSource(surface: AutoSurface | null, liveIsLocal: boolean): "local" | "cloud" | "other" | "none" {
  if (surface === null) return liveIsLocal ? "local" : "cloud";
  if (surface === "local") return "local";
  if (surface === "cloud") return "cloud";
  if (surface === "vm") return "other";
  return "none";
}

export function autoThumbnailComputer(surface: AutoSurface | null): string {
  return surface === "local" || surface === "cloud" || surface === "vm" ? surface : "auto";
}

function useAutoSurface(botId: string, threadId: string | undefined, enabled: boolean, refreshKey: string): AutoSurface | null {
  const [surface, setSurface] = useState<AutoSurface | null>(null);
  useEffect(() => {
    if (!enabled) { setSurface(null); return; }
    let alive = true;
    const query = new URLSearchParams({ threadId: threadId ?? "" });
    api<{ surface?: unknown }>(`/api/bots/${encodeURIComponent(botId)}/computer?${query.toString()}`)
      .then((body) => {
        const value = body.surface;
        if (alive) setSurface(value === "cloud" || value === "local" || value === "vm" || value === "browser" || value === "off" ? value : null);
      })
      .catch(() => { if (alive) setSurface(null); });
    return () => { alive = false; };
  }, [botId, threadId, enabled, refreshKey]);
  return surface;
}

/** The menu's one row: leading mark, name over a grey line, check. */
function ComputerMenuRow({ lead, label, detail, checked, dim = false, disabled = false, onPick, autoFocus, ...data }: {
  lead: ComputerMenuOption["lead"] | "offline";
  label: string;
  detail: string;
  checked: boolean;
  dim?: boolean;
  disabled?: boolean;
  onPick: () => void;
  autoFocus?: boolean;
  "data-computer-card-option"?: string;
  "data-computer-card-host"?: string;
}) {
  const LeadIcon = lead === "auto" ? Sparkles : lead === "cloud" ? Cloud : lead === "vm" ? Box : lead === "computer" ? Laptop : null;
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} aria-disabled={disabled || undefined} disabled={disabled} autoFocus={autoFocus} {...data}
      data-computer-menu-row={lead}
      onClick={disabled ? undefined : onPick} className={cn(MENU_ROW, "h-auto py-1.5", (dim || disabled) && "text-ink-tertiary")}>
      <span aria-hidden="true" data-computer-menu-lead={lead} className="flex size-4 shrink-0 items-center justify-center text-ink-secondary">
        {LeadIcon
          ? <LeadIcon size={14} />
          : <span className={cn("size-1.5 rounded-full", lead === "online" ? "bg-success" : "bg-ink-tertiary/60")} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span data-computer-menu-name="" className="truncate">{label}</span>
        <span data-computer-menu-detail="" className="truncate text-[11.5px] leading-4 text-ink-tertiary">{detail}</span>
      </span>
      {checked ? <Check size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" /> : <span aria-hidden="true" className="w-[14px] shrink-0" />}
    </button>
  );
}

/** One marked host in the row's menu: name, OS and a status dot; offline last and greyed. */
function HostChoiceItem({ host, checked, onPick }: { host: BotComputerHostView; checked: boolean; onPick: () => void }) {
  const detail = `${host.shellOnly ? `${osLabel(host.os)} \u00b7 ${t("hostComputer.shellOnly")}` : osLabel(host.os)}${host.online ? "" : ` \u00b7 ${t("hostComputer.offline")}`}`;
  return (
    <ComputerMenuRow lead={host.online ? "online" : "offline"} label={host.name} detail={detail} checked={checked} dim={!host.online}
      onPick={onPick} data-computer-card-host={host.online ? "online" : "offline"} />
  );
}

function modeToPatch(mode: ComputerSelectValue): ComputerPatch {
  if (mode === "auto") return { computer: null };
  return { computer: mode };
}

/** The screen window a link asked for (the store's computerOpen). */
export type ComputerWindowRequest = { view: ComputerWindowView; signIn?: BrowserSignIn | undefined };

/** The window the store asks the bot panel's Computer section for: the
 * store's computerOpen (every "open the bot's computer" link, Teach a task
 * included) with what it should show. */
export function computerWindowRequest(state: { computerOpen: boolean; computerWindowView: ComputerWindowView }, signIn?: BrowserSignIn): ComputerWindowRequest | null {
  return state.computerOpen ? { view: state.computerWindowView, signIn } : null;
}

/** What the screen window shows: null when there is none to show (no
 * computer, a shell-only host, a VM that opens in its own workspace). */
export function computerWindowKind(input: { request: ComputerWindowRequest | null; place: string; chosenHost: boolean }): "browser" | "teach" | "screen" | null {
  if (input.request?.view === "teach") return "teach";
  if (input.request?.view === "browser" || (!input.chosenHost && input.place === "browser")) return "browser";
  if (input.chosenHost || input.place === "off" || input.place === "vm") return null;
  return "screen";
}

export function ComputerCard({ bot, onPatch, readOnly = false, windowRequest = null, onWindowClose, onOpenVmWorkspace }: {
  bot: Bot;
  onPatch?: (patch: ComputerPatch) => void;
  readOnly?: boolean;
  /** A link opened the bot's computer: the window opens at once. */
  windowRequest?: ComputerWindowRequest | null;
  /** The window a link opened closed (the link's state goes back). */
  onWindowClose?: () => void;
  /** A bot that works in a VM opens its workspace. */
  onOpenVmWorkspace?: (botId: string) => void;
}) {
  const organization = usePerspicaxOrg() !== null;
  const bridge = useDesktopBridgeStatus();
  const [broken, setBroken] = useState<string | null>(null);
  const [liveOpen, setLiveOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const thumbButton = useRef<HTMLButtonElement>(null);
  // Bot computers (#2726): a marked host the bot works on, chosen here.
  const hostComputer = useBotHostComputer(readOnly ? null : bot.id);
  const chosenHost = hostComputer.hostId ? hostComputer.hosts.find((host) => host.hostId === hostComputer.hostId) ?? null : null;
  const autoMode = bot.computer == null && !chosenHost;
  const autoSurface = useAutoSurface(bot.id, bot.threadId, autoMode, `${bot.messages.length}:${bot.busy ? 1 : 0}`);
  const thumbBase = thumbnailComputerFor(bot.computer, bridge, organization);
  const thumbComputer = chosenHost ? null : thumbBase === "auto" ? autoThumbnailComputer(autoSurface) : thumbBase;
  const ownDesktop = organization ? thumbnailDesktop(bridge) : null;
  // Refreshed after each bot action (a new message, busy flipping) and when
  // the live window closes.
  const thumbnail = useComputerThumbnail(bot.id, thumbComputer, {
    desktopName: ownDesktop?.desktop.name ?? null,
    refreshKey: `${bot.messages.length}:${bot.busy ? 1 : 0}:${liveOpen ? 1 : 0}`,
  });
  const src = thumbnail.src && broken !== thumbnail.src ? thumbnail.src : null;
  const capturedAt = thumbnail.at;
  const stale = capturedAt !== null && (Date.now() - capturedAt > COMPUTER_THUMBNAIL_STALE_MS
    || (thumbComputer?.startsWith("local") === true && ownDesktop !== null && !ownDesktop.online));
  const capturedLabel = capturedAt !== null
    ? t("botPanel.computerCard.capturedAt", { time: new Date(capturedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) })
    : undefined;
  const selectValue: ComputerSelectValue | null = chosenHost ? null : computerSelectValue(bot.computer);
  const config = useStoreSelector((current) => current.config);
  const instances = useStoreSelector((current) => (current as { instances?: Array<{ instanceId: string; displayName?: string; capabilities?: { computerMcp?: boolean } }> }).instances);
  const engine = instances?.find((instance) => instance.instanceId === bot.modelSelection?.instanceId);
  const cloudOffered = placeOffered("cloud", config, organization);
  const vmChoice = localVmChoice({
    cloudHome: config?.cloudHome === true,
    policyAllows: config?.managedPolicy?.computers.localVm !== false,
    organizationName: config?.managedPolicy?.organizationName,
    modelCanUseComputer: engine ? engine.capabilities?.computerMcp === true : null,
    modelName: engine?.displayName,
    desktop: localVmDesktopState(bridge, organization),
  });
  const options = useMemo(() => computerSelectOptions(bridge, organization, cloudOffered, vmChoice), [bridge, organization, cloudOffered, vmChoice]);
  const title = chosenHost ? chosenHost.name : computerCardTitle(bot.computer, bridge, organization);
  const place = effectivePlace(bot);
  const active = activeComputer(bridge ?? EMPTY_BRIDGE, place);
  const liveIsLocal = active.source === "local";
  const desktopId = liveIsLocal ? currentDesktop(bridge)?.id : undefined;
  const caption = t("computer.screenOf", { name: bot.name });
  const canOpenLive = !chosenHost && place !== "off" && (place !== "vm" || Boolean(onOpenVmWorkspace));
  const openLive = () => {
    if (!canOpenLive) return;
    if (place === "vm") onOpenVmWorkspace?.(bot.id);
    else setLiveOpen(true);
  };
  // The window a link opened, or the one this row opened (its own view).
  const windowKind = computerWindowKind({ request: windowRequest ?? (liveOpen ? { view: "screen" } : null), place, chosenHost: chosenHost !== null });
  const windowShown = (liveOpen || windowRequest !== null) && windowKind !== null;
  // A link that opened nothing to show gives its state back at once.
  useEffect(() => {
    if (windowRequest && windowKind === null) onWindowClose?.();
  }, [windowRequest, windowKind, onWindowClose]);
  const closeWindow = () => { setLiveOpen(false); if (windowRequest) onWindowClose?.(); };
  // the thumbnail and the Awake / Asleep line follow the real
  // state: the screen, asleep (computer offline, cloud computer stopped), or
  // unavailable with its reason, never a wallpaper that looks fine.
  const cardSource = chosenHost ? (chosenHost.shellOnly ? "none" : "local")
    : place === "off" || place === "browser" ? "none"
    : place === "vm" ? "other"
    : place === "auto" ? autoCardSource(autoSurface, liveIsLocal)
    : place === "local" ? "local"
    : "cloud";
  const permission = useScreenPermission();
  const appCapture = ownScreenCapture() !== null;
  // The app's own reason (Screen Recording) applies to the row only when the
  // row stands for this computer.
  const thisComputer = !organization || sameHost(permission.host, ownDesktop?.desktop.name);
  const cloudAsleep = useCloudAsleep(bot.id, cardSource === "cloud", `${bot.busy ? 1 : 0}:${liveOpen ? 1 : 0}`);
  const view = computerCardView({
    busy: bot.busy === true,
    off: place === "off",
    source: cardSource,
    online: chosenHost ? chosenHost.online : !organization || ownDesktop?.online === true,
    cloudAsleep,
    hasCapture: src !== null,
    localProblem: !chosenHost && thisComputer ? localScreenProblem({ inApp: appCapture, mac: isMacPlatform(), screenPermission: permission.screen }) : null,
  });
  const statusWord = view.status === "asleep" ? t("place.view.ccAsleep.short")
    : view.status === "working" ? t("botPanel.computerCard.working")
    : t("botPanel.computerCard.awake");
  const status = chosenHost
    ? [statusWord, osLabel(chosenHost.os), chosenHost.shellOnly ? t("hostComputer.shellOnly") : null].filter(Boolean).join(" \u00b7 ")
    : view.problem ? `${statusWord} \u00b7 ${t(SCREEN_PROBLEM_SHORT[view.problem])}` : statusWord;
  const reason = view.problem ? t(SCREEN_PROBLEM_LINE[view.problem]) : undefined;
  const menuEnabled = !readOnly && !!onPatch;
  const moreLabel = t("botPanel.computerCard.choose");
  const [menu, setMenu] = useState<{ trigger: HTMLElement; x: number; y: number; right: boolean; keyboard: boolean } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useMenuInWindow(menuRef, menu && { left: menu.x, top: menu.y, right: menu.right });
  const openMenu = (trigger: HTMLElement, at?: { x: number; y: number }, keyboard = false) => {
    const rect = trigger.getBoundingClientRect();
    // under the "...", its right edge on the trigger's; at the pointer, from it
    setMenu({ trigger, x: at?.x ?? rect.right, y: at?.y ?? rect.bottom + 4, right: !at, keyboard });
  };
  // Opened by pointer, no row is focused (no ring): Escape still closes it.
  const menuOpen = menu !== null;
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  const closeMenu = (focusTrigger = true) => {
    const trigger = menu?.trigger;
    setMenu(null);
    if (focusTrigger) trigger?.focus();
  };

  return (
    <section data-bot-settings-section="computer" aria-labelledby={`bot-computer-${bot.id}`} className="flex flex-col gap-2">
      {/* JC 2026-11-06: no dropdown beside the section title; the Works on
          choices are the row's right-click menu, like the other rows. */}
      <div className="flex items-center gap-2">
        <h3 id={`bot-computer-${bot.id}`} className={cn(PANEL_LABEL, "min-w-0 flex-1 truncate")}>{t("botPanel.tab.computer")}</h3>
        {/* JC 2026-11-06: the same bare "..." as Upcoming, on the section header row, always visible. */}
        {/* Only for whoever may change the Works on choice: nothing else is in the menu. */}
        {menuEnabled && <button type="button" data-computer-card-more="" aria-haspopup="menu" aria-label={moreLabel} title={moreLabel}
          onClick={(event) => openMenu(event.currentTarget, undefined, event.detail === 0)}
          className="ui-icon-button"><MoreHorizontal size={15} /></button>}
      </div>
      <div className={PANEL_CARD}>
        {/* JC 2026-11-06: same row as Upcoming (RoutineList): the thumbnail card
            plus a "..." at its right that opens the right-click menu. */}
        <div className={`group/routine flex items-center gap-2.5 hover:bg-hover ${PANEL_ROW}`}>
        <button
          type="button"
          data-computer-card=""
          aria-disabled={!canOpenLive || undefined}
          onClick={openLive}
          onContextMenu={menuEnabled ? (event) => { event.preventDefault(); openMenu(event.currentTarget, { x: event.clientX, y: event.clientY }); } : undefined}
          onKeyDown={menuEnabled ? (event) => {
            if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); openMenu(event.currentTarget, undefined, true); }
          } : undefined}
          aria-haspopup={menuEnabled ? "menu" : undefined}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 aria-disabled:cursor-default"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[14px] font-normal leading-5 text-ink">{title}</span>
            <span data-computer-status={view.status} data-computer-problem={view.problem ?? undefined} title={reason} className="truncate text-[13px] leading-[18px] text-ink-tertiary">
              {status}
            </span>
          </span>
        </button>
        {/* The thumbnail is its own button: a capture opens larger in the
            viewer, the other looks open the live window. */}
        <button
          ref={thumbButton}
          type="button"
          data-computer-thumb={view.thumb}
          data-computer-thumb-stale={view.thumb === "screen" && stale ? "" : undefined}
          aria-label={view.thumb === "screen" ? t("botPanel.computerCard.preview") : reason ? `${caption} \u00b7 ${reason}` : caption}
          title={view.thumb === "screen" ? capturedLabel : reason ?? (view.thumb === "asleep" ? t("place.view.ccAsleep.short") : undefined)}
          aria-disabled={view.thumb !== "screen" && !canOpenLive ? true : undefined}
          onClick={() => { if (view.thumb === "screen") setPreviewOpen(true); else openLive(); }}
          className={cn(
            "relative flex h-[29px] w-[46px] shrink-0 items-center justify-center overflow-hidden rounded-[5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 aria-disabled:cursor-default",
            view.thumb !== "screen" && "border-[0.5px] border-border bg-control",
          )}
        >
          {view.thumb === "screen" && src && <img src={src} alt="" loading="lazy" onError={() => setBroken(src)}
            className={cn("size-full object-cover", stale && "opacity-60 grayscale")} />}
          {view.thumb === "asleep" && (
            <>
              <ComputerIdleBot size={17} />
              <span aria-hidden="true" data-sleep-glyphs="" className="absolute right-[5px] top-[2px] text-[8px] font-bold leading-none text-ink-tertiary">z</span>
            </>
          )}
          {view.thumb === "unavailable" && <MonitorOff size={14} aria-hidden="true" className="text-ink-tertiary" />}
        </button>
        </div>
      </div>
      {menu && createPortal(
        <div className="fixed inset-0 z-40" onMouseDown={() => closeMenu(false)} onContextMenu={(event) => { event.preventDefault(); closeMenu(false); }}>
          <div role="menu" data-computer-card-menu="" aria-label={moreLabel}
            ref={menuRef}
            style={{ left: menu.x, top: menu.y }}
            className={cn(MENU_SURFACE, MENU_FIT_ROW, "absolute")}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
              if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); closeMenu(); return; }
              navigateThreadMenu(event);
            }}>
            {menuEnabled && options.map((option, index) => (
              <ComputerMenuRow key={option.value} lead={option.lead} label={option.label} detail={option.detail}
                checked={option.value === selectValue} disabled={option.disabled === true}
                data-computer-card-option={option.value} autoFocus={index === 0 && menu.keyboard && option.disabled !== true}
                onPick={() => {
                  if (option.disabled) return;
                  closeMenu();
                  if (chosenHost) void hostComputer.select(null);
                  if (option.value !== selectValue) onPatch?.(modeToPatch(option.value));
                }} />
            ))}
            {menuEnabled && hostComputer.hosts.length > 0 && <MenuDivider />}
            {menuEnabled && hostComputer.hosts.map((host) => (
              <HostChoiceItem key={host.hostId} host={host} checked={host.hostId === hostComputer.hostId}
                onPick={() => { closeMenu(); if (host.hostId !== hostComputer.hostId) void hostComputer.select(host.hostId); }} />
            ))}
          </div>
        </div>, document.body)}
      {previewOpen && thumbnail.fullSrc && (
        <ViewerDialog title={capturedLabel ? `${caption} \u00b7 ${capturedLabel}` : caption} onClose={() => setPreviewOpen(false)} returnFocus={thumbButton.current}
          bodyClassName="flex items-center justify-center bg-black/80 p-4">
          <img data-computer-thumb-full="" src={thumbnail.fullSrc} alt={caption} className="max-h-full max-w-full object-contain" />
        </ViewerDialog>
      )}
      {windowShown && windowKind !== "screen" && (
        <BrowserWindow bot={bot} teach={windowKind === "teach"} signIn={windowRequest?.signIn} onClose={closeWindow} />
      )}
      {windowShown && windowKind === "screen" && (() => {
        // #5355: This computer in the desktop app must not nest its own
        // screen (endless mirror) or offer Take control.
        const ownComputer = ownComputerScreenTakeover({ liveIsLocal, inApp: appCapture });
        return (
          <SandboxDesktopModal
            title={caption}
            state="running"
            onClose={closeWindow}
            ownComputer={ownComputer}
            screen={!ownComputer && liveIsLocal
              ? (control) => <LocalLiveScreen desktopId={desktopId} control={control} />
              : undefined}
          />
        );
      })()}
    </section>
  );
}

export type { ComputerSelectValue, ComputerPatch };
