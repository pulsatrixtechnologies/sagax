import type { PointerEvent } from "react";
import { t } from "@/lib/i18n";
import type { OrgLayout, OrgBot } from "@/lib/team-map-layout";

export const MINIMAP_W = 168;
export const MINIMAP_MAX_H = 128;

/** An overview of a large map: the blocks as small rectangles and the part
 * on screen as a frame. Press or drag on it to move there. */
export function TeamMapMiniMap<T extends OrgBot>({ layout, view, size, onPan }: {
  layout: OrgLayout<T>;
  view: { x: number; y: number; scale: number };
  size: { w: number; h: number };
  onPan: (worldX: number, worldY: number) => void;
}) {
  const k = Math.min(MINIMAP_W / layout.width, MINIMAP_MAX_H / layout.height);
  const width = layout.width * k;
  const height = layout.height * k;
  const frame = { x: (-view.x / view.scale) * k, y: (-view.y / view.scale) * k, w: (size.w / view.scale) * k, h: (size.h / view.scale) * k };
  const go = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onPan((event.clientX - box.left) / k, (event.clientY - box.top) / k);
  };
  return (
    <div role="img" aria-label={t("teamMap.org.minimap")} data-team-map-minimap=""
      className="absolute bottom-4 right-4 z-30 touch-none overflow-hidden rounded-xl border border-hairline/60 bg-panel/95 shadow-sm"
      style={{ width, height }}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); go(event); }}
      onPointerMove={(event) => { if (event.buttons === 1) go(event); }}>
      {layout.lead && <span className="absolute rounded-sm bg-ink-secondary" style={{ left: layout.lead.x * k, top: layout.lead.y * k, width: layout.lead.w * k, height: Math.max(2, layout.lead.h * k) }} />}
      {layout.blocks.map((block) => <span key={block.key} className="absolute rounded-sm bg-raised" style={{ left: block.x * k, top: block.y * k, width: block.w * k, height: Math.max(3, block.h * k) }} />)}
      {layout.tray && <span className="absolute rounded-sm border border-dashed border-hairline" style={{ left: layout.tray.x * k, top: layout.tray.y * k, width: layout.tray.w * k, height: Math.max(3, layout.tray.h * k) }} />}
      <span className="pointer-events-none absolute rounded-sm border border-accent bg-accent/10" style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }} />
    </div>
  );
}
