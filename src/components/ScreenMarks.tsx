// Marks on the bot's screen (#4452): the person highlights, circles, points an
// arrow at or draws on the live browser frame, adds a short note, and Send
// puts ONE message in the bot's one conversation: the frame with the marks as a
// picture, the element under each mark (asked of the page, read only) and the
// note. A working bot takes it as a steer of the current turn, so it acts on
// it at once. While marking, the overlay sits on the screen: nothing reaches
// the page and the bot keeps the browser (no take control needed).
import { useCallback, useEffect, useReducer, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { Highlighter, MoveUpRight, Circle, Pencil, Trash2, Undo2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { composeMessage, imageAttachmentFromFile } from "@/lib/composer-attachments";
import { readableError } from "@/lib/plain-error";
import {
  containedBox, feedbackText, framePoint, MARK_TOOLS, markFromDrag, MAX_MARKS, pagePoint, renderMarkedFrame, toolLabel,
  type Box, type DescribedMark, type Mark, type MarkTool, type Point,
} from "@/lib/screen-marks";
import { browserFrameSize } from "./BrowserViewport";
import type { BrowserDescriber } from "./BrowserPanel";
import { PILL, PRIMARY_PILL } from "./SettingsPrimitives";
import type { ScreenPlace } from "@/lib/screen-places";
import type { Action, Bot } from "@/state/store";

const TOOL_ICON = { highlight: Highlighter, arrow: MoveUpRight, circle: Circle, pen: Pencil } as const;
const button = "rounded-md p-1.5 text-ink-secondary hover:bg-inset hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

export type ScreenMarksState = ReturnType<typeof useScreenMarks>;

/** The picture a place draws, with its size in the page's pixels: the live
 * browser's frame, the remote computer's or Local VM's picture, or the VM's
 * VNC canvas. One finder for every place of the panel (#4452). */
const FRAME_PICTURE = "img[data-browser-frame], img[data-remote-session-shot], img[data-local-live-frame]";
const FRAME_CANVAS = "[data-sandbox-desktop] canvas";
/** Any element that draws a place's picture, loaded or not. */
export const SCREEN_PICTURE = `${FRAME_PICTURE}, ${FRAME_CANVAS}`;
export function frameImage(host: HTMLElement | null) {
  const picture = host?.querySelector<HTMLImageElement>(FRAME_PICTURE) ?? null;
  if (picture) {
    if (!picture.complete || !picture.naturalWidth) return null;
    const page = browserFrameSize(picture.naturalWidth, picture.naturalHeight, Number(picture.dataset.frameWidth) || picture.naturalWidth, Number(picture.dataset.frameHeight) || picture.naturalHeight);
    return { image: picture, width: picture.naturalWidth, height: picture.naturalHeight, page };
  }
  const canvas = host?.querySelector<HTMLCanvasElement>(FRAME_CANVAS) ?? null;
  if (!canvas?.width || !canvas.height) return null;
  return { image: canvas, width: canvas.width, height: canvas.height, page: { width: canvas.width, height: canvas.height } };
}

export function useScreenMarks({ bot, host, describer, dispatch, onSent, place = "browser", renderImage = renderMarkedFrame }: {
  bot: Bot;
  /** Holds the live browser (and so its frame picture). */
  host: RefObject<HTMLElement | null>;
  describer: RefObject<BrowserDescriber | null>;
  dispatch: (action: Action) => void;
  onSent: () => void;
  /** Which place is marked: the words of the message follow it. */
  place?: ScreenPlace;
  renderImage?: typeof renderMarkedFrame;
}) {
  const [tool, setTool] = useState<MarkTool>("highlight");
  const [marks, setMarks] = useState<Mark[]>([]);
  const [draft, setDraft] = useState<Mark | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const nextId = useRef(1);
  const path = useRef<Point[]>([]);
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  // The picture can resize or change under the marks: draw them again.
  useEffect(() => {
    const element = host.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => redraw());
    watch.observe(element);
    return () => watch.disconnect();
  }, [host]);

  /** The picture's rectangle in client pixels, letterboxing left out. */
  const frameBox = useCallback((): Box | null => {
    const found = frameImage(host.current);
    if (!found) return null;
    const rect = found.image.getBoundingClientRect();
    return containedBox({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }, found.width, found.height);
  }, [host]);

  const aspect = () => { const box = frameBox(); return box && box.height ? box.width / box.height : 1; };
  const pointer = (event: ReactPointerEvent) => { const box = frameBox(); return box ? framePoint(box, event.clientX, event.clientY) : null; };

  const down = (event: ReactPointerEvent<Element>) => {
    if (sending || marks.length >= MAX_MARKS) return;
    const at = pointer(event);
    if (!at) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    path.current = [at];
    setDraft({ id: 0, tool, points: [at, at] });
  };
  const move = (event: ReactPointerEvent<Element>) => {
    if (!path.current.length) return;
    const at = pointer(event);
    if (!at) return;
    if (tool === "pen") path.current.push(at); else path.current = [path.current[0]!, at];
    setDraft({ id: 0, tool, points: [...path.current] });
  };
  const up = () => {
    if (!path.current.length) return;
    const made = markFromDrag(nextId.current, tool, path.current, aspect());
    path.current = [];
    setDraft(null);
    if (made) { nextId.current += 1; setMarks((current) => [...current, made]); }
  };

  const send = async () => {
    if (!marks.length && !note.trim()) return;
    const found = frameImage(host.current);
    // Marks with no picture left on screen (the page went): say so, never a silent Send.
    // A note alone needs no picture.
    if (marks.length && !found) { setError(t("screenMarks.error.image")); return; }
    setSending(true); setError("");
    try {
      const points = found ? marks.map((mark) => pagePoint(mark, found.page.width, found.page.height)) : [];
      let described: DescribedMark[] = [];
      try { if (marks.length && describer.current) described = await describer.current(points); } catch { /* the picture and the note still go */ }
      const picture = marks.length && found ? await imageAttachmentFromFile(await renderImage(found.image, marks)) : null;
      const text = composeMessage(feedbackText(marks, described, note, place), picture ? [picture] : []);
      dispatch({
        type: "send", botId: bot.id, text,
        // the current turn takes it as a steer; an idle bot starts a turn
        ...(bot.busy ? { busyMode: "steer" as const } : {}),
        onSent: () => { setSending(false); setMarks([]); setNote(""); onSent(); },
        onError: () => { setSending(false); setError(t("screenMarks.error.send")); },
      });
    } catch (cause) {
      setSending(false);
      setError(readableError(cause));
    }
  };

  return {
    tool, setTool, marks, draft, note, setNote, sending, error, frameBox, host,
    undo: () => setMarks((current) => current.slice(0, -1)),
    clear: () => { setMarks([]); setNote(""); setError(""); },
    down, move, up, send,
    canSend: !sending && (marks.length > 0 || note.trim().length > 0),
  };
}

/** The tools strip under the header: tool, undo, clear, Done, the note, Send.
 * Done ends marking up, as the pen and Escape do (M-20261127-180). */
export function ScreenMarksBar({ marks, onDone }: { marks: ScreenMarksState; onDone: () => void }) {
  return (
    <div data-screen-marks-bar="" className="flex shrink-0 flex-col gap-1.5 border-t border-hairline/40 px-3 py-2">
      <div className="flex items-center gap-1">
        <div role="radiogroup" aria-label={t("screenMarks.tools")} className="flex items-center gap-0.5">
          {MARK_TOOLS.map((id) => {
            const Icon = TOOL_ICON[id];
            return (
              <button key={id} type="button" role="radio" aria-checked={marks.tool === id} data-mark-tool={id} title={toolLabel(id)} aria-label={toolLabel(id)}
                onClick={() => marks.setTool(id)} className={cn(button, marks.tool === id && "bg-inset text-ink")}>
                <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <span className="mx-1 h-4 w-px bg-hairline/60" aria-hidden="true" />
        <button type="button" data-mark-undo="" className={button} disabled={!marks.marks.length || marks.sending} title={t("screenMarks.undo")} aria-label={t("screenMarks.undo")} onClick={marks.undo}>
          <Undo2 size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button type="button" data-mark-clear="" className={button} disabled={(!marks.marks.length && !marks.note) || marks.sending} title={t("screenMarks.clear")} aria-label={t("screenMarks.clear")} onClick={marks.clear}>
          <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button type="button" data-mark-done="" className={cn(PILL, "ml-auto")} title={t("screenMarks.doneHint")} onClick={onDone}>{t("screenMarks.done")}</button>
      </div>
      <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void marks.send(); }}>
        <input data-mark-note="" value={marks.note} maxLength={600} onChange={(event) => marks.setNote(event.target.value)} aria-label={t("screenMarks.note")} placeholder={t("screenMarks.note")}
          disabled={marks.sending} className="min-w-0 flex-1 rounded-lg bg-inset px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink-secondary" />
        <button type="submit" data-mark-send="" disabled={!marks.canSend} className={PRIMARY_PILL}>{marks.sending ? t("screenMarks.sending") : t("screenMarks.send")}</button>
      </form>
      {marks.error && <p role="alert" className="text-[12px] text-danger">{marks.error}</p>}
    </div>
  );
}

/** The drawing surface over the screen: it takes the pointer so the page behind never gets it. */
export function ScreenMarksOverlay({ marks }: { marks: ScreenMarksState }) {
  const overlay = useRef<SVGSVGElement>(null);
  const frame = marks.frameBox();
  const origin = overlay.current?.getBoundingClientRect();
  const box = frame && origin ? { left: frame.left - origin.left, top: frame.top - origin.top, width: frame.width, height: frame.height } : null;
  const shown = marks.draft ? [...marks.marks, marks.draft] : marks.marks;
  return (
    <svg ref={overlay} data-screen-marks-overlay="" role="img" aria-label={t("screenMarks.overlay")}
      className="absolute inset-0 z-10 size-full cursor-crosshair touch-none text-danger"
      onPointerDown={marks.down} onPointerMove={marks.move} onPointerUp={marks.up} onPointerCancel={marks.up}>
      {box && shown.map((mark) => <MarkShape key={mark.id} mark={mark} box={box} />)}
    </svg>
  );
}

function MarkShape({ mark, box }: { mark: Mark; box: Box }) {
  const px = mark.points.map((point) => ({ x: box.left + point.x * box.width, y: box.top + point.y * box.height }));
  const a = px[0]!, b = px[px.length - 1]!;
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (mark.tool === "highlight") return <rect data-mark="highlight" x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} {...common} fill="currentColor" fillOpacity={0.25} />;
  if (mark.tool === "circle") return <ellipse data-mark="circle" cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} rx={Math.max(1, Math.abs(b.x - a.x) / 2)} ry={Math.max(1, Math.abs(b.y - a.y) / 2)} {...common} />;
  if (mark.tool === "arrow") {
    const angle = Math.atan2(b.y - a.y, b.x - a.x), head = 15;
    const tip = (turn: number) => `${b.x - head * Math.cos(angle + turn)},${b.y - head * Math.sin(angle + turn)}`;
    return <g data-mark="arrow"><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} /><polygon points={`${b.x},${b.y} ${tip(-Math.PI / 6)} ${tip(Math.PI / 6)}`} fill="currentColor" stroke="none" /></g>;
  }
  return <polyline data-mark="pen" points={px.map((point) => `${point.x},${point.y}`).join(" ")} {...common} />;
}
