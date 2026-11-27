// The screen side panel (#4452): one column beside the chat for what the
// selected bot is working in. Compact chrome (M-20261127-064): no title
// header band; page tabs (or place chrome) share a row with Detach / Expand /
// Close; the live view fills the rest edge to edge. Browser, VM and remote
// supply the body; artifacts reuse the same chrome via ScreenPanelChrome.
import { useRef, useState, type ReactNode } from "react";
import { Globe, Laptop, Monitor, PenLine, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { activePlace, type ScreenPlace } from "@/lib/screen-places";
import { setScreenPanelOpen, SCREEN_PANEL_DEFAULT_WIDTH, SCREEN_PANEL_MAX_WIDTH, SCREEN_PANEL_MIN_WIDTH, SCREEN_PANEL_WIDTH_KEY } from "@/lib/screen-panel";
import { useStore, type Bot } from "@/state/store";
import { BrowserPanel, type BrowserDescriber } from "./BrowserPanel";
import { ScreenMarksBar, ScreenMarksOverlay, useScreenMarks } from "./ScreenMarks";
import { ControlSwitch, placeControllable, RemotePane, useScreenPlaces, VmPane } from "./ScreenPlaces";
import { DockedPanelResizeHandle, useDockedPanelWidth } from "./DockedPanelResize";
import { ScreenPanelChrome } from "./ScreenPanelChrome";
import { PillTabs } from "./PillTabs";
import { openScreenPanelWindow } from "@/lib/screen-panel-window";

const SCREEN_BOUNDS = {
  key: SCREEN_PANEL_WIDTH_KEY,
  min: SCREEN_PANEL_MIN_WIDTH,
  max: SCREEN_PANEL_MAX_WIDTH,
  fallback: SCREEN_PANEL_DEFAULT_WIDTH,
};

const PLACE_ICON: Record<ScreenPlace, LucideIcon> = { browser: Globe, vm: Monitor, remote: Laptop };
const PLACE_TITLE = { browser: "computer.browserOf", vm: "screenPanel.title.vm", remote: "screenPanel.title.remote" } as const;
const PLACE_TAB = { browser: "screenPanel.tab.browser", vm: "screenPanel.tab.vm", remote: "screenPanel.tab.remote" } as const;

const MARK_TOOL = cn(CIRCLE_BUTTON, "size-7");

/** Extension point for a surface that is not a place (artifacts): same
 * Detach / Expand / Close chrome, body supplied by the caller. */
export type ScreenPanelArtifactSlot = {
  title: string;
  body: ReactNode;
  onDetach?: () => void;
  onExpand?: () => void;
};

export function ScreenPanel({ bot, artifact }: { bot: Bot; artifact?: ScreenPanelArtifactSlot | null }) {
  const panel = useDockedPanelWidth(SCREEN_BOUNDS);
  const found = useScreenPlaces(bot);
  const [picked, setPicked] = useState<ScreenPlace | null>(null);
  const place = activePlace(found.places, picked);
  const [control, setControl] = useState(false);
  const title = artifact ? artifact.title : t(PLACE_TITLE[place], { name: bot.name });
  const PlaceIcon = PLACE_ICON[place];
  const { dispatch } = useStore();
  const [marking, setMarking] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const describer = useRef<BrowserDescriber | null>(null);
  const marks = useScreenMarks({ bot, host: body, describer, dispatch, place, onSent: () => setMarking(false) });
  const pick = (next: ScreenPlace) => { setPicked(next); setControl(false); setMarking(false); marks.clear(); };

  const close = () => setScreenPanelOpen(false);
  const expand = () => {
    if (artifact?.onExpand) { artifact.onExpand(); return; }
    openScreenPanelWindow({ botId: bot.id, mode: "expand", kind: "browser" });
  };
  const detach = () => {
    if (artifact?.onDetach) { artifact.onDetach(); return; }
    openScreenPanelWindow({ botId: bot.id, mode: "detach", kind: "browser" });
    setScreenPanelOpen(false);
  };

  const marksToggle = place !== "browser" || !artifact ? (
    <button type="button" data-screen-panel-marks="" aria-pressed={marking} onClick={() => setMarking((on) => !on)}
      aria-label={t("screenMarks.toggle")} title={t("screenMarks.toggle")}
      className={cn(MARK_TOOL, marking && "ring-2 ring-accent/60")}>
      <PenLine size={15} strokeWidth={1.75} aria-hidden="true" />
    </button>
  ) : null;

  const chrome = (
    <ScreenPanelChrome
      title={title}
      onClose={close}
      onDetach={artifact ? artifact.onDetach ?? detach : detach}
      onExpand={artifact ? artifact.onExpand ?? expand : expand}
      leading={marksToggle}
      trailing={place !== "browser" && !artifact && placeControllable(place, found.vm, found.remote)
        ? <ControlSwitch control={control} onChange={setControl} />
        : undefined}
    />
  );

  const placeSelector = !artifact && found.places.length > 1 ? (
    <div role="tablist" aria-label={t("screenPanel.tabs")} data-screen-place-select="" className="flex shrink-0 items-center gap-0.5">
      {found.places.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          data-screen-tab={id}
          aria-selected={place === id}
          onClick={() => pick(id)}
          className={cn(
            "rounded-md px-1.5 py-0.5 text-[11px] leading-4 transition-colors",
            place === id ? "bg-inset font-medium text-ink" : "text-ink-secondary hover:bg-inset/60 hover:text-ink",
          )}
        >
          {t(PLACE_TAB[id])}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <aside
      data-screen-panel=""
      data-screen-place={artifact ? "artifact" : place}
      data-screen-compact=""
      aria-label={t("screenPanel.aria", { name: bot.name })}
      style={{ width: panel.width }}
      className="app-docked-panel animate-panel-in relative flex h-full min-w-0 shrink-0 flex-col border-l-[0.5px] border-pane-edge bg-app outline-none max-lg:absolute max-lg:inset-0 max-lg:z-40 max-lg:w-auto!"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        const target = event.target as HTMLElement;
        if (target.closest("textarea, input, [role=menu], [role=dialog], select")) return;
        setScreenPanelOpen(false);
      }}
    >
      <DockedPanelResizeHandle label={t("screenPanel.resize")} panel={panel} />
      <div ref={body} data-screen-panel-body="" className="relative flex min-h-0 flex-1 flex-col">
        {artifact ? (
          <>
            <div data-screen-panel-tabs="" className="flex min-h-9 shrink-0 items-center gap-1 border-b border-hairline/40 px-1.5">
              <span dir="auto" className="min-w-0 flex-1 truncate px-1 text-[12px] font-medium text-ink" title={artifact.title}>{artifact.title}</span>
              {chrome}
            </div>
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">{artifact.body}</div>
          </>
        ) : place === "browser" ? (
          <BrowserPanel
            key={bot.id}
            bot={bot}
            live
            onDescriber={(describe) => { describer.current = describe; }}
            docked={{
              title,
              chrome,
              placeSelector,
            }}
          />
        ) : (
          <>
            <div data-screen-panel-tabs="" className="flex min-h-9 shrink-0 items-center gap-1 border-b border-hairline/40 px-1.5">
              <PlaceIcon size={14} strokeWidth={1.75} aria-hidden="true" className="ml-1 shrink-0 text-ink-secondary" />
              <span dir="auto" className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink" title={title}>{title}</span>
              {found.places.length > 1 && (
                <PillTabs tabs={found.places} tab={place} onTab={pick} ariaLabel={t("screenPanel.tabs")} idPrefix="screen-panel"
                  label={(id) => t(PLACE_TAB[id])} tabAttributes={(id) => ({ "data-screen-tab": id })}
                  className="shrink-0" />
              )}
              {chrome}
            </div>
            {place === "vm" && found.vm && <VmPane source={found.vm} control={control} host={body} />}
            {place === "remote" && found.remote && <RemotePane botId={bot.id} view={found.remote} control={control} host={body} />}
          </>
        )}
        {marking && !artifact && <ScreenMarksOverlay marks={marks} />}
      </div>
      {marking && !artifact && <ScreenMarksBar marks={marks} />}
    </aside>
  );
}
