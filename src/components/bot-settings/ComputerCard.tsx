// Activity > Computer (reference design, #2125 / #2187): one row, "Bot's
// computer" over Awake (or Working while the bot is busy), the last screen
// the bot sent as a thumbnail on the right. A click opens the live desktop
// window at once (SandboxDesktopModal: Watching / You have control), never
// the ComputerPanel in the right-hand column. The section label carries a
// PillSelect (Voice "Ara ⌄" style) listing the same computers as the chat
// Computer menu / LocalComputerSection (`computerChoices`); picking one
// changes the bot's Works on and refreshes the card.
import { useEffect, useMemo, useState } from "react";

import type { Bot } from "@/state/store";
import { PANEL_CARD, PANEL_LABEL, PANEL_ROW } from "@/lib/grouped-card";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { effectivePlace, placeLabelKey } from "@/lib/place";
import { placeLabel } from "@/lib/place-labels";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import {
  computerChoices,
  currentDesktop,
  useDesktopBridgeStatus,
  type ComputerChoice,
  type DesktopBridgeStatus,
} from "@/lib/desktop-bridge";
import { desktopLocalVm } from "@/lib/desktop-local-vm";
import { DEFAULT_BOT_WORKPLACE } from "../../../shared/bot-workplace";
import { PillSelect, type PillOption } from "../SettingsPrimitives";
import { SandboxDesktopModal } from "../computer/SandboxDesktopModal";
import { worksOnMode } from "../computer/WorksOnSetting";
import { activeComputer } from "../computer/OrgComputerTab";
import { screenFramePreview } from "../ScreenFrame";

type ComputerSelectValue = "auto" | "off" | "cloud" | "local" | "vm" | "browser";

type ComputerPatch = { computer: Bot["computer"] | null };

const EMPTY_BRIDGE: DesktopBridgeStatus = {
  connected: false,
  tunnel: false,
  desktops: [],
  workplace: { ...DEFAULT_BOT_WORKPLACE },
  activity: [],
};

/** The last screen the bot sent in its conversation, if the server holds one. */
export function lastScreenSrc(bot: Pick<Bot, "messages" | "threadId">): string | null {
  for (let index = bot.messages.length - 1; index >= 0; index -= 1) {
    const message = bot.messages[index]!;
    if (message.kind === "screen" && (message.hasImage || message.png)) {
      return screenFramePreview({ threadId: bot.threadId, messageId: message.id }, message.mime).src;
    }
  }
  return null;
}

/** Works on value shown in the section's PillSelect. */
export function computerSelectValue(computer: Bot["computer"] | null | undefined): ComputerSelectValue {
  const mode = worksOnMode(computer);
  if (mode === null) return "auto";
  return mode;
}

/** Options for the section chevron: Cloud + each online local computer from
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

/** Local computer live picture inside SandboxDesktopModal (Watching / control). */
function LocalLiveScreen({ desktopId, control }: { desktopId?: string; control: boolean }) {
  const [frame, setFrame] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const grab = async () => {
      try {
        const answer = await desktopLocalVm("screenshot", { desktopId });
        if (!cancelled && answer.image) setFrame(answer.image);
      } catch { /* keep the last frame */ }
    };
    void grab();
    const timer = window.setInterval(() => void grab(), 4_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [desktopId]);
  return (
    <div data-computer-card-local-live={control ? "control" : "watch"} className="absolute inset-0 flex items-center justify-center bg-black">
      {frame
        ? <img src={frame} alt="" className="h-full w-full object-contain" draggable={false} />
        : <p role="status" className="text-[12px] text-white/70">{t("computer.capturingLocal")}</p>}
    </div>
  );
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
  const src = lastScreenSrc(bot);
  const status = bot.busy ? t("botPanel.computerCard.working") : t("botPanel.computerCard.awake");
  const selectValue = computerSelectValue(bot.computer);
  const options = useMemo(() => computerSelectOptions(bridge, organization), [bridge, organization]);
  const title = computerCardTitle(bot.computer, bridge, organization);
  const place = effectivePlace(bot);
  const active = activeComputer(bridge ?? EMPTY_BRIDGE, place);
  const liveIsLocal = active.source === "local";
  const desktopId = liveIsLocal ? currentDesktop(bridge)?.id : undefined;
  const caption = t("computer.screenOf", { name: bot.name });
  const canOpenLive = place !== "off" && place !== "browser";

  return (
    <section data-bot-settings-section="computer" aria-labelledby={`bot-computer-${bot.id}`} className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h3 id={`bot-computer-${bot.id}`} className={cn(PANEL_LABEL, "min-w-0 flex-1 truncate")}>{t("botPanel.tab.computer")}</h3>
        <span data-computer-card-select="" className="inline-flex min-w-0 shrink-0">
          <PillSelect
            value={selectValue}
            ariaLabel={t("botPanel.computerCard.choose")}
            disabled={readOnly || !onPatch}
            bordered
            options={options}
            onChange={(next) => onPatch?.(modeToPatch(next))}
          />
        </span>
      </div>
      <div className={PANEL_CARD}>
        <button
          type="button"
          data-computer-card=""
          disabled={!canOpenLive}
          onClick={() => { if (canOpenLive) setLiveOpen(true); }}
          className={`${PANEL_ROW} flex w-full min-w-0 items-center gap-3 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 disabled:cursor-default disabled:opacity-60`}
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[14px] font-normal leading-5 text-ink">{title}</span>
            <span data-computer-status={bot.busy ? "working" : "awake"} className="truncate text-[13px] leading-[18px] text-ink-tertiary">
              {status}
            </span>
          </span>
          <span aria-hidden="true" data-computer-thumb={src && broken !== src ? "screen" : "wallpaper"} className="h-[29px] w-[46px] shrink-0 overflow-hidden rounded-[5px]" style={src && broken !== src ? undefined : { background: WALLPAPER }}>
            {src && broken !== src && <img src={src} alt="" loading="lazy" onError={() => setBroken(src)} className="size-full object-cover" />}
          </span>
        </button>
      </div>
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

/** The desktop wallpaper shown before the bot sent any screen. */
const WALLPAPER = "radial-gradient(120% 90% at 20% 15%, #6d8cff 0%, transparent 55%), radial-gradient(110% 100% at 85% 90%, #c86bd6 0%, transparent 60%), linear-gradient(135deg, #24305e 0%, #3b2a63 55%, #1c1f3a 100%)";

export type { ComputerSelectValue, ComputerPatch };
