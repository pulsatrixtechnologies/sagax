// The screen side panel (#4452): the one column that shows, beside the chat,
// what the selected bot is working in. One component for every place (the
// browser now; the VM and the remote computer join as tabs): the column, its
// header, its resizable left edge and its Esc live here once, each place only
// supplies its live view. The browser tab hosts LiveBrowser unchanged, so
// take control, give back, tabs, the address bar and typing behave exactly as
// in the full-window takeover. It is the person's own bot's screen: no
// approval card, and never a thread panel (the chat stays the one conversation).
import { useRef, useState } from "react";
import { Globe, PenLine, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { setScreenPanelOpen, SCREEN_PANEL_DEFAULT_WIDTH, SCREEN_PANEL_MAX_WIDTH, SCREEN_PANEL_MIN_WIDTH, SCREEN_PANEL_WIDTH_KEY } from "@/lib/screen-panel";
import { useStore, type Bot } from "@/state/store";
import { BrowserPanel, type BrowserDescriber } from "./BrowserPanel";
import { ScreenMarksBar, ScreenMarksOverlay, useScreenMarks } from "./ScreenMarks";
import { DockedPanelResizeHandle, useDockedPanelWidth } from "./DockedPanelResize";

const SCREEN_BOUNDS = {
  key: SCREEN_PANEL_WIDTH_KEY,
  min: SCREEN_PANEL_MIN_WIDTH,
  max: SCREEN_PANEL_MAX_WIDTH,
  fallback: SCREEN_PANEL_DEFAULT_WIDTH,
};

export function ScreenPanel({ bot }: { bot: Bot }) {
  const panel = useDockedPanelWidth(SCREEN_BOUNDS);
  const title = t("computer.browserOf", { name: bot.name });
  const { dispatch } = useStore();
  // Marking up (#4452): the tools and the overlay show only while it is on.
  const [marking, setMarking] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const describer = useRef<BrowserDescriber | null>(null);
  const marks = useScreenMarks({ bot, host: body, describer, dispatch, onSent: () => setMarking(false) });
  return (
    <aside
      data-screen-panel=""
      data-screen-place="browser"
      aria-label={t("screenPanel.aria", { name: bot.name })}
      style={{ width: panel.width }}
      className="app-docked-panel animate-panel-in relative flex h-full min-w-0 shrink-0 flex-col border-l-[0.5px] border-hairline-weak bg-app outline-none max-lg:absolute max-lg:inset-0 max-lg:z-40 max-lg:w-auto!"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        const target = event.target as HTMLElement;
        if (target.closest("textarea, input, [role=menu], [role=dialog]")) return;
        setScreenPanelOpen(false);
      }}
    >
      <DockedPanelResizeHandle label={t("screenPanel.resize")} panel={panel} />
      <div data-screen-panel-header="" className="flex min-h-[52px] shrink-0 items-center gap-2 px-3 py-2.5">
        <Globe size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ink-secondary" />
        <span dir="auto" className="min-w-0 flex-1 truncate text-[13.5px] font-medium leading-5 text-ink">{title}</span>
        <button type="button" data-screen-panel-marks="" aria-pressed={marking} onClick={() => setMarking((on) => !on)} aria-label={t("screenMarks.toggle")} title={t("screenMarks.toggle")}
          className={cn(CIRCLE_BUTTON, marking && "ring-2 ring-accent/60")}>
          <PenLine size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button type="button" data-screen-panel-close="" onClick={() => setScreenPanelOpen(false)} aria-label={t("screenPanel.close")} title={t("screenPanel.close")} className={CIRCLE_BUTTON}>
          <X size={17} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <div ref={body} data-screen-panel-body="" className="relative flex min-h-0 flex-1 flex-col px-3 pb-3">
        <BrowserPanel key={bot.id} bot={bot} live onDescriber={(describe) => { describer.current = describe; }} />
        {marking && <ScreenMarksOverlay marks={marks} />}
      </div>
      {marking && <ScreenMarksBar marks={marks} />}
    </aside>
  );
}
