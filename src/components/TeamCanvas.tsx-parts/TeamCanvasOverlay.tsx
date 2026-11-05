import { Minus, Plus } from "lucide-react";
import type { Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import type { Point } from "@/lib/team-canvas";
import { BotAvatar } from "../Avatar";

const iconButton = "flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-2 focus-visible:outline-accent";

export function TeamCanvasOverlay({ dragged, dropHint, announcement, view, zoom, fit }: {
  dragged: { bot: Bot; point: Point } | null;
  dropHint: string | null;
  announcement: string;
  view: { scale: number };
  zoom: (factor: number) => void;
  fit: () => void;
}) {
  return (
    <>
      {dragged && <div className="pointer-events-none absolute z-40 rounded-xl border border-accent/40 bg-card px-4 py-3 text-[13px] shadow-lg" style={{ left: dragged.point.x + 16, top: dragged.point.y + 16 }}>
        <span className="flex items-center gap-2"><BotAvatar bot={dragged.bot} size={24} animated={false} />{dragged.bot.name}</span>
        {dropHint && <p className="mt-1 text-[10px] text-ink-secondary">{dropHint}</p>}
      </div>}
      <div className="pointer-events-none absolute inset-x-5 bottom-5 flex items-end justify-between gap-3">
        <div className="min-w-0 rounded-lg bg-app/90 px-2 py-1.5 text-[11px] text-ink-secondary">
          <p className="max-sm:hidden">{t("canvas.hint")}</p>
          <p role="status" aria-live="polite" className="max-w-[440px]">{dropHint ?? announcement}</p>
        </div>
        <div className="pointer-events-auto flex shrink-0 items-center gap-0.5 rounded-xl border border-hairline/60 bg-panel p-1 shadow-sm">
          <button className={iconButton} aria-label={t("canvas.zoomOut")} onClick={() => zoom(1 / 1.2)}><Minus size={15} /></button>
          <button className="min-w-12 rounded-md px-1 py-2 text-[11px] tabular-nums text-ink-secondary hover:bg-control" aria-label={t("canvas.fit")} title={t("canvas.fitHint")} onClick={fit}>{Math.round(view.scale * 100)}%</button>
          <button className={iconButton} aria-label={t("canvas.zoomIn")} onClick={() => zoom(1.2)}><Plus size={15} /></button>
        </div>
      </div>
    </>
  );
}
