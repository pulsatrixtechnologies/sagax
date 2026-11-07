// Activity > Computer (reference design, #2125 / #2187): one row, "Bot's
// computer" over Awake (or Working while the bot is busy), a recent capture
// of the computer the bot works on now as a thumbnail on the right
// (useComputerThumbnail: switching computers switches the picture at once;
// an old or offline capture is greyed out; a click on it opens it larger). A click opens the live desktop
// window at once (SandboxDesktopModal: Watching / You have control), never
// the ComputerPanel in the right-hand column. The section label carries a
// PillSelect (Voice "Ara ⌄" style) listing the same computers as the chat
// Computer menu / LocalComputerSection (`computerChoices`); picking one
// changes the bot's Works on and refreshes the card.
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, MonitorOff, MoreHorizontal } from "lucide-react";

import type { Bot } from "@/state/store";
import { PANEL_CARD, PANEL_LABEL, PANEL_ROW } from "@/lib/grouped-card";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { effectivePlace, placeLabelKey } from "@/lib/place";
import { placeLabel } from "@/lib/place-labels";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { isMacPlatform } from "@/lib/is-mac-platform";
import {
  SCREEN_PROBLEM_LINE,
  SCREEN_PROBLEM_SHORT,
  computerCardView,
  localScreenProblem,
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
import type { PillOption } from "../SettingsPrimitives";
import { navigateThreadMenu } from "../BotProjects";
import { SandboxDesktopModal } from "../computer/SandboxDesktopModal";
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

type ComputerSelectValue = "auto" | "off" | "cloud" | "local" | "vm" | "browser";

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

/** Options for the computer row's context menu: Cloud + each online local computer from
 * `computerChoices` (chat Computer menu / OrgComputerTab), plus Auto and Off
 * so the bot's Works on can follow. Solo (no bridge desktops) falls back to
 * the Works on set alone. */
export function computerSelectOptions(
  bridge: DesktopBridgeStatus | null,
  organization: boolean,
): Array<PillOption<ComputerSelectValue>> {
  const choices = computerChoices(bridge);
  const localChoices = choices.filter((choice): choice is Extract<ComputerChoice, { source: "local" }> => choice.source === "local");
  const hasNamedLocals = localChoices.length > 0;
  const auto: PillOption<ComputerSelectValue> = { value: "auto", label: t(placeLabelKey("auto", organization)) };
  const off: PillOption<ComputerSelectValue> = { value: "off", label: t(placeLabelKey("off", organization)) };
  if (!hasNamedLocals) {
    return [
      auto,
      { value: "local", label: t(placeLabelKey("local", organization)) },
      { value: "cloud", label: t(placeLabelKey("cloud", organization)) },
      off,
    ];
  }
  const cloudLabel = placeLabel("server", t("orgComputer.choice.cloud"));
  const localLabel = localChoices.length === 1
    ? placeLabel(localChoices[0]!.key, localChoices[0]!.name)
    : t(placeLabelKey("local", organization));
  return [
    auto,
    { value: "local", label: localLabel },
    { value: "cloud", label: cloudLabel },
    off,
  ];
}

/** Card title for the current Works on (named local PC when the bridge knows one). */
export function computerCardTitle(
  computer: Bot["computer"] | null | undefined,
  bridge: DesktopBridgeStatus | null,
  organization: boolean,
): string {
  const mode = worksOnMode(computer);
  if (mode === "off") return t(placeLabelKey("off", organization));
  if (mode === "cloud") return placeLabel("server", t("orgComputer.choice.cloud"));
  if (mode === "local") {
    const desktop = currentDesktop(bridge);
    if (desktop) return placeLabel(`desktop:${desktop.id}`, desktop.name.trim() || t("computerScreen.computer"));
    return t(placeLabelKey("local", organization));
  }
  return t("botPanel.computerCard.title");
}

function modeToPatch(mode: ComputerSelectValue): ComputerPatch {
  if (mode === "auto") return { computer: null };
  return { computer: mode };
}

export function ComputerCard({ bot, onPatch, readOnly = false }: {
  bot: Bot;
  onPatch?: (patch: ComputerPatch) => void;
  readOnly?: boolean;
}) {
  const organization = usePerspicaxOrg() !== null;
  const bridge = useDesktopBridgeStatus();
  const [broken, setBroken] = useState<string | null>(null);
  const [liveOpen, setLiveOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const thumbButton = useRef<HTMLButtonElement>(null);
  const thumbComputer = thumbnailComputerFor(bot.computer, bridge, organization);
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
  const selectValue = computerSelectValue(bot.computer);
  const options = useMemo(() => computerSelectOptions(bridge, organization), [bridge, organization]);
  const title = computerCardTitle(bot.computer, bridge, organization);
  const place = effectivePlace(bot);
  const active = activeComputer(bridge ?? EMPTY_BRIDGE, place);
  const liveIsLocal = active.source === "local";
  const desktopId = liveIsLocal ? currentDesktop(bridge)?.id : undefined;
  const caption = t("computer.screenOf", { name: bot.name });
  const canOpenLive = place !== "off" && place !== "browser";
  // JC 2026-11-07: the thumbnail and the Awake / Asleep line follow the real
  // state: the screen, asleep (computer offline, cloud computer stopped), or
  // unavailable with its reason, never a wallpaper that looks fine.
  const cardSource = place === "off" || place === "browser" ? "none"
    : place === "vm" ? "other"
    : place === "local" || (place === "auto" && liveIsLocal) ? "local"
    : "cloud";
  const permission = useScreenPermission();
  const appCapture = typeof window !== "undefined" && typeof window.ogb?.screenFrame === "function";
  // The app's own reason (Screen Recording) applies to the row only when the
  // row stands for this computer.
  const thisComputer = !organization || sameHost(permission.host, ownDesktop?.desktop.name);
  const cloudAsleep = useCloudAsleep(bot.id, cardSource === "cloud", `${bot.busy ? 1 : 0}:${liveOpen ? 1 : 0}`);
  const view = computerCardView({
    busy: bot.busy === true,
    off: place === "off",
    source: cardSource,
    online: !organization || ownDesktop?.online === true,
    cloudAsleep,
    hasCapture: src !== null,
    localProblem: thisComputer ? localScreenProblem({ inApp: appCapture, mac: isMacPlatform(), screenPermission: permission.screen }) : null,
  });
  const statusWord = view.status === "asleep" ? t("place.view.ccAsleep.short")
    : view.status === "working" ? t("botPanel.computerCard.working")
    : t("botPanel.computerCard.awake");
  const status = view.problem ? `${statusWord} \u00b7 ${t(SCREEN_PROBLEM_SHORT[view.problem])}` : statusWord;
  const reason = view.problem ? t(SCREEN_PROBLEM_LINE[view.problem]) : undefined;
  const menuEnabled = !readOnly && !!onPatch;
  const [menu, setMenu] = useState<{ trigger: HTMLElement; x: number; y: number } | null>(null);
  const openMenu = (trigger: HTMLElement, at?: { x: number; y: number }) => {
    const rect = trigger.getBoundingClientRect();
    setMenu({ trigger, x: at?.x ?? rect.right - 220, y: at?.y ?? rect.bottom + 4 });
  };
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
        {menuEnabled && <button type="button" data-computer-card-more="" aria-haspopup="menu" aria-label={t("botPanel.computerCard.choose")} title={t("botPanel.computerCard.choose")}
          onClick={(event) => openMenu(event.currentTarget)}
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
          onClick={() => { if (canOpenLive) setLiveOpen(true); }}
          onContextMenu={menuEnabled ? (event) => { event.preventDefault(); openMenu(event.currentTarget, { x: event.clientX, y: event.clientY }); } : undefined}
          onKeyDown={menuEnabled ? (event) => {
            if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); openMenu(event.currentTarget); }
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
          onClick={() => { if (view.thumb === "screen") setPreviewOpen(true); else if (canOpenLive) setLiveOpen(true); }}
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
          <div role="menu" data-computer-card-menu="" aria-label={t("botPanel.computerCard.choose")}
            style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 228)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 200)) }}
            className="absolute flex w-[220px] flex-col gap-0.5 rounded-xl border-[0.5px] border-border bg-elevated p-1.5 text-ink shadow-lg"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
              if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); closeMenu(); return; }
              navigateThreadMenu(event);
            }}>
            {options.map((option, index) => (
              <button key={option.value} type="button" role="menuitemradio" aria-checked={option.value === selectValue}
                data-computer-card-option={option.value} autoFocus={index === 0}
                onClick={() => { closeMenu(); if (option.value !== selectValue) onPatch?.(modeToPatch(option.value)); }}
                className={MENU_ITEM}>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.value === selectValue && <Check size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />}
              </button>
            ))}
          </div>
        </div>, document.body)}
      {previewOpen && thumbnail.fullSrc && (
        <ViewerDialog title={capturedLabel ? `${caption} \u00b7 ${capturedLabel}` : caption} onClose={() => setPreviewOpen(false)} returnFocus={thumbButton.current}
          bodyClassName="flex items-center justify-center bg-black/80 p-4">
          <img data-computer-thumb-full="" src={thumbnail.fullSrc} alt={caption} className="max-h-full max-w-full object-contain" />
        </ViewerDialog>
      )}
      {liveOpen && (
        <SandboxDesktopModal
          title={caption}
          state="running"
          onClose={() => setLiveOpen(false)}
          screen={liveIsLocal
            ? (control) => <LocalLiveScreen desktopId={desktopId} control={control} />
            : undefined}
        />
      )}
    </section>
  );
}

/** Same item as the bot panel's other row menus (BotTaskSection). */
const MENU_ITEM = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover focus-visible:bg-hover focus-visible:outline-none disabled:opacity-50";

export type { ComputerSelectValue, ComputerPatch };
