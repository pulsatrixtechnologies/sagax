// The person's marks on the bot's screen (#4452): a highlight, an arrow, a
// circle or a freehand line over the live browser frame, plus a short note.
// Everything here is pure geometry and wording: marks are kept in the
// frame's own coordinates (0 to 1 of the picture, never of the screen), so
// they stay on the same spot when the panel is resized and map straight to the
// page's pixels. `renderMarkedFrame` bakes the marks into one PNG; the
// feedback text names the element under each mark and carries the note.
import { t } from "@/lib/i18n";

export type MarkTool = "highlight" | "arrow" | "circle" | "pen";
export type Point = { x: number; y: number };
export type Mark = { id: number; tool: MarkTool; points: Point[] };
export type Box = { left: number; top: number; width: number; height: number };
/** What the page says about the element under a mark (server `describe`). */
export type DescribedMark = { url: string; role?: string; name?: string; tag?: string } | null;

export const MARK_TOOLS: readonly MarkTool[] = ["highlight", "arrow", "circle", "pen"];
export const MAX_MARKS = 8;
const MAX_PEN_POINTS = 400;
/** The size of a highlight made by a click without a drag, as a share of the frame's width. */
const CLICK_SIZE = 0.04;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** The picture's own rectangle inside its box: `object-contain` letterboxes it. */
export function containedBox(box: Box, imageWidth: number, imageHeight: number): Box {
  if (!(imageWidth > 0) || !(imageHeight > 0) || !(box.width > 0) || !(box.height > 0)) return { left: box.left, top: box.top, width: 0, height: 0 };
  const scale = Math.min(box.width / imageWidth, box.height / imageHeight);
  const width = imageWidth * scale, height = imageHeight * scale;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}

/** A pointer position as a point of the frame, or null when the frame has no size. */
export function framePoint(frame: Box, clientX: number, clientY: number): Point | null {
  if (!(frame.width > 0) || !(frame.height > 0)) return null;
  return { x: clamp01((clientX - frame.left) / frame.width), y: clamp01((clientY - frame.top) / frame.height) };
}

/** The mark a drag made. A highlight or a circle is its two corners, an arrow
 * its two ends. A click without a drag is a small zone around the point. */
export function markFromDrag(id: number, tool: MarkTool, path: Point[], frameAspect = 1): Mark | null {
  const first = path[0], last = path[path.length - 1];
  if (!first || !last) return null;
  if (tool === "pen") return path.length < 2 ? null : { id, tool, points: path.slice(0, MAX_PEN_POINTS) };
  const tiny = Math.abs(last.x - first.x) < 0.006 && Math.abs(last.y - first.y) < 0.006;
  if (tool === "arrow") return tiny ? null : { id, tool, points: [first, last] };
  if (tiny) {
    const half = CLICK_SIZE / 2;
    return { id, tool, points: [{ x: clamp01(first.x - half), y: clamp01(first.y - half * frameAspect) }, { x: clamp01(first.x + half), y: clamp01(first.y + half * frameAspect) }] };
  }
  return { id, tool, points: [first, last] };
}

/** Where to ask the page what is there: the middle of a zone, the tip of an arrow. */
export function anchorOf(mark: Mark): Point {
  const xs = mark.points.map((point) => point.x), ys = mark.points.map((point) => point.y);
  if (mark.tool === "arrow") return mark.points[mark.points.length - 1]!;
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/** A mark's anchor in the page's own pixels (the frame's CSS size). */
export function pagePoint(mark: Mark, pageWidth: number, pageHeight: number): Point {
  const at = anchorOf(mark);
  return { x: Math.round(at.x * pageWidth), y: Math.round(at.y * pageHeight) };
}

export function toolLabel(tool: MarkTool): string {
  return t(`screenMarks.tool.${tool}` as never);
}

/** The words that go with the picture: where the marks are, what sits under
 * each one, and the person's note. */
export function feedbackText(marks: readonly Mark[], described: readonly DescribedMark[], note: string): string {
  const lines: string[] = [];
  const url = described.find((entry) => entry?.url)?.url;
  lines.push(url ? t("screenMarks.msg.introAt", { url }) : t("screenMarks.msg.intro"));
  marks.forEach((mark, index) => {
    const element = described[index];
    const kind = element?.role || element?.tag || "";
    if (element?.name) lines.push(t("screenMarks.msg.element", { tool: toolLabel(mark.tool), role: kind, name: element.name }));
    else if (kind) lines.push(t("screenMarks.msg.elementRole", { tool: toolLabel(mark.tool), role: kind }));
  });
  const words = note.trim();
  if (words) lines.push(t("screenMarks.msg.note", { note: words }));
  return lines.join("\n");
}

/** The colour of the marks: the app's danger red, read from the skin. */
function markColour(): string {
  if (typeof document === "undefined") return "#ff5667";
  return getComputedStyle(document.documentElement).getPropertyValue("--color-danger").trim() || "#ff5667";
}

/** Draw the marks over a frame, in the frame's own pixels. */
export function drawMarks(ctx: CanvasRenderingContext2D, marks: readonly Mark[], width: number, height: number, colour = markColour()): void {
  const stroke = Math.max(3, Math.round(width / 280));
  ctx.save();
  ctx.lineWidth = stroke; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = colour; ctx.fillStyle = colour;
  for (const mark of marks) {
    const px = mark.points.map((point) => ({ x: point.x * width, y: point.y * height }));
    const a = px[0]!, b = px[px.length - 1]!;
    if (mark.tool === "highlight") {
      ctx.globalAlpha = 0.28; ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.globalAlpha = 1; ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    } else if (mark.tool === "circle") {
      ctx.beginPath(); ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.max(1, Math.abs(b.x - a.x) / 2), Math.max(1, Math.abs(b.y - a.y) / 2), 0, 0, Math.PI * 2); ctx.stroke();
    } else if (mark.tool === "arrow") {
      const angle = Math.atan2(b.y - a.y, b.x - a.x), head = stroke * 5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - head * Math.cos(angle - Math.PI / 6), b.y - head * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(b.x - head * Math.cos(angle + Math.PI / 6), b.y - head * Math.sin(angle + Math.PI / 6));
      ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); px.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.stroke();
    }
  }
  ctx.restore();
}

/** The frame and the marks in one PNG, at the frame's own pixel size. */
export async function renderMarkedFrame(image: HTMLImageElement, marks: readonly Mark[]): Promise<File> {
  const width = image.naturalWidth, height = image.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx || !width || !height) throw new Error(t("screenMarks.error.image"));
  ctx.drawImage(image, 0, 0, width, height);
  drawMarks(ctx, marks, width, height);
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
  if (!blob) throw new Error(t("screenMarks.error.image"));
  return new File([blob], "marked-browser.png", { type: "image/png" });
}
