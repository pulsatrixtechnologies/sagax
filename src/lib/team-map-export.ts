// The Team map as a PNG: drawn from the layout itself (the same numbers the
// page draws), not from a screenshot, so it needs no extra library and never
// depends on what is scrolled into view.
import type { OrgBot, OrgLayout, PlacedBot } from "./team-map-layout";

export interface ExportTheme {
  app: string; panel: string; card: string; hairline: string; ink: string; inkSecondary: string; inkTertiary: string;
  success: string; warning: string; danger: string;
}

export interface ExportLook<T extends OrgBot> {
  theme: ExportTheme;
  teamName(key: string): string;
  role(bot: T): string;
  state(bot: T): "working" | "waiting" | "idle" | "noSignal";
  color(bot: T): string;
  fontFamily?: string;
}

const FONT = (size: number, weight: number, family: string) => `${weight} ${size}px ${family}`;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > width) out = out.slice(0, -1);
  return `${out}…`;
}

export function drawTeamMap<T extends OrgBot>(ctx: CanvasRenderingContext2D, layout: OrgLayout<T>, look: ExportLook<T>) {
  const { theme } = look;
  const family = look.fontFamily ?? "system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillStyle = theme.app;
  ctx.fillRect(0, 0, layout.width, layout.height);
  const stateColor = (state: ReturnType<ExportLook<T>["state"]>) => state === "working" ? theme.success : state === "waiting" ? theme.warning : state === "noSignal" ? theme.danger : theme.inkTertiary;
  const card = (placed: PlacedBot<T>) => {
    const { bot, x, y, w, h } = placed;
    ctx.fillStyle = theme.card;
    roundRect(ctx, x, y, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = theme.hairline;
    ctx.lineWidth = 1;
    ctx.stroke();
    const cy = y + h / 2;
    ctx.fillStyle = look.color(bot);
    ctx.beginPath();
    ctx.arc(x + 24, cy, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = FONT(12, 600, family);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(bot.name.slice(0, 1).toUpperCase(), x + 24, cy + 0.5);
    const state = look.state(bot);
    ctx.fillStyle = stateColor(state);
    ctx.beginPath();
    ctx.arc(x + 33, cy + 10, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = theme.ink;
    ctx.font = FONT(13, 500, family);
    ctx.fillText(fit(ctx, bot.name, w - 56), x + 46, y + 17);
    ctx.fillStyle = theme.inkSecondary;
    ctx.font = FONT(12, 400, family);
    ctx.fillText(fit(ctx, look.role(bot), w - 56), x + 46, y + 32);
  };
  for (const block of layout.blocks) {
    ctx.fillStyle = theme.panel;
    roundRect(ctx, block.x, block.y, block.w, block.h, 16);
    ctx.fill();
    ctx.strokeStyle = theme.hairline;
    ctx.stroke();
    ctx.fillStyle = theme.ink;
    ctx.font = FONT(13, 600, family);
    ctx.fillText(fit(ctx, look.teamName(block.key), block.w - 56), block.x + 14, block.y + 27);
    ctx.fillStyle = theme.inkTertiary;
    ctx.font = FONT(11, 400, family);
    ctx.textAlign = "right";
    ctx.fillText(String(block.total), block.x + block.w - 14, block.y + 27);
    ctx.textAlign = "left";
    if (block.hidden > 0) {
      ctx.fillStyle = theme.inkSecondary;
      ctx.font = FONT(12, 400, family);
      ctx.textAlign = "center";
      ctx.fillText(`+${block.hidden}`, block.x + block.w / 2, block.moreY + 17);
      ctx.textAlign = "left";
    }
  }
  const linkColor = (state: "running" | "queued" | "idle") => state === "running" ? theme.success : state === "queued" ? theme.warning : theme.inkTertiary;
  for (const link of layout.links) {
    const color = linkColor(link.state);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = link.state === "running" ? 2 : 1.5;
    ctx.setLineDash(link.reviews ? [5, 4] : []);
    ctx.stroke(new Path2D(link.path));
    ctx.setLineDash([]);
    ctx.save();
    ctx.translate(link.end.x, link.end.y);
    ctx.rotate((link.end.angle * Math.PI) / 180);
    if (link.reviews) {
      ctx.fillStyle = theme.app;
      ctx.beginPath();
      ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-8, -4);
      ctx.lineTo(-8, 4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  if (layout.lead) {
    ctx.fillStyle = theme.card;
    roundRect(ctx, layout.lead.x, layout.lead.y, layout.lead.w, layout.lead.h, 12);
    ctx.fill();
    ctx.strokeStyle = theme.hairline;
    ctx.stroke();
    card(layout.lead);
  }
  for (const block of layout.blocks) for (const placed of block.bots) card(placed);
  if (layout.tray) {
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = theme.hairline;
    roundRect(ctx, layout.tray.x, layout.tray.y, layout.tray.w, layout.tray.h, 16);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = theme.ink;
    ctx.font = FONT(13, 600, family);
    ctx.fillText(look.teamName(""), layout.tray.x + 16, layout.tray.y + 30);
    ctx.fillStyle = theme.inkTertiary;
    ctx.font = FONT(11, 400, family);
    ctx.fillText(String(layout.tray.bots.length), layout.tray.x + 16 + ctx.measureText(look.teamName("")).width + 14, layout.tray.y + 30);
    layout.tray.placed.forEach(card);
    if (!layout.tray.open) layout.tray.bots.forEach((bot, index) => {
      ctx.fillStyle = look.color(bot);
      ctx.beginPath();
      ctx.arc(layout.tray!.x + 160 + index * 34, layout.tray!.y + layout.tray!.h / 2, 13, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  for (const link of layout.links) {
    if (!link.badge) continue;
    ctx.font = FONT(11, 500, family);
    const width = ctx.measureText(link.badge.text).width + 14;
    ctx.fillStyle = theme.app;
    roundRect(ctx, link.badge.x - width / 2, link.badge.y - 8, width, 16, 8);
    ctx.fill();
    ctx.strokeStyle = link.state === "running" ? theme.success : theme.hairline;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = link.state === "running" ? theme.success : theme.inkSecondary;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(link.badge.text, link.badge.x, link.badge.y + 0.5);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
}

/** The layout as a PNG at 2x. */
export async function renderTeamMapPng<T extends OrgBot>(layout: OrgLayout<T>, look: ExportLook<T>, scale = 2): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(layout.width * scale);
  canvas.height = Math.ceil(layout.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.scale(scale, scale);
  drawTeamMap(ctx, layout, look);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("png"))), "image/png"));
}

/** Read the theme's own colours from CSS custom properties on `element`. */
export function exportThemeOf(element: HTMLElement): ExportTheme {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    app: read("--color-app", "#111111"), panel: read("--color-panel", "#1a1a1a"), card: read("--color-card", "#262626"), hairline: read("--color-hairline", "#333333"),
    ink: read("--color-ink", "#f5f5f5"), inkSecondary: read("--color-ink-secondary", "#b0b0b0"), inkTertiary: read("--color-ink-tertiary", "#8a8a8a"),
    success: read("--color-success", "#38d591"), warning: read("--color-warning", "#ff9800"), danger: read("--color-danger", "#ff5667"),
  };
}
