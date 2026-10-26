// The content nodes that hold no nodes of their own: an image, a badge, a
// progress bar. (An Icon is a WidgetGlyph and a Chart is WidgetChart.)
import { useState, type CSSProperties } from "react";
import { ImageOff, RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { widgetNumber, widgetString, type WidgetNode } from "../../../shared/widget";
import { useWidgetForm } from "./WidgetControls";
import type { WidgetWhere } from "./WidgetNodes";
import { BADGE_DOT, BADGE_INK, BADGE_SIZE, BADGE_SOLID, boxStyle } from "./widget-style";
import { progressClip } from "@/lib/motion";

/** A remote image waits for a click, the way one in a bot's Markdown does
 * (AttachmentPreview): a widget is bot-authored, and mounting the image is a
 * request to whatever address the bot wrote. One click loads the card's images. */
export function WidgetImage({ node, where }: { node: WidgetNode; where: WidgetWhere }) {
  const form = useWidgetForm();
  // A picture that does not arrive (address gone, refused, blocked, offline)
  // says so and offers another try, never an empty framed box.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const src = widgetString(node, "src");
  // A new address (a widget that streams or is regenerated) gets its own try.
  const failed = failedSrc !== null && failedSrc === src;
  if (!src || !/^https:\/\//i.test(src)) return null;
  const box = boxStyle(node);
  const thumb = where.item === true && where.lead === true && box.width === undefined && box.height === undefined;
  const edge = node.flush === true ? where.card : undefined;
  const alt = widgetString(node, "alt");
  const style: CSSProperties = {
    ...box,
    ...(thumb ? { width: 40, height: 40, flexShrink: 0 } : box.width === undefined && box.height === undefined ? { width: "100%" } : {}),
    borderRadius: edge ? 0 : box.borderRadius ?? (thumb ? 10 : 12),
    ...(edge ? { marginLeft: -edge.left, marginRight: -edge.right, marginTop: -edge.top, width: `calc(100% + ${edge.left + edge.right}px)`, maxWidth: "none" } : {}),
  };
  const frame = node.frame === true && "bg-inset ring-1 ring-ink/10";
  if (!form.imagesAllowed) {
    return (
      <button
        type="button"
        title={t("attach.externalHidden")}
        aria-label={alt ? `${t("attach.loadImage")}: ${alt}` : t("attach.loadImage")}
        onClick={(event) => {
          event.stopPropagation();
          form.allowImages();
        }}
        className={cn("flex max-w-full flex-col items-center justify-center gap-1 bg-inset px-3 text-center text-[12px] leading-4 text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", !thumb && "min-h-[88px] py-3", frame)}
        style={style}
      >
        <ImageOff aria-hidden="true" size={thumb ? 16 : 18} className="shrink-0" />
        {!thumb && <span>{t("attach.externalHidden")}</span>}
        {!thumb && <span className="font-medium text-ink underline decoration-ink/30 underline-offset-2">{t("attach.loadImage")}</span>}
      </button>
    );
  }
  if (failed) {
    const retry = () => {
      setFailedSrc(null);
      setAttempt((value) => value + 1);
    };
    return (
      <span
        role="status"
        data-widget-image-failed=""
        className={cn("flex max-w-full flex-col items-center justify-center bg-inset text-center text-[12px] leading-4 text-ink-secondary", thumb ? "p-0" : "min-h-[88px] gap-1.5 px-3 py-3", frame)}
        style={style}
      >
        {!thumb && <ImageOff aria-hidden="true" size={18} className="shrink-0" />}
        {!thumb && <span>{t("attach.imageUnavailable")}</span>}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            retry();
          }}
          aria-label={t("attach.retryAria", { name: alt || t("attach.imageUnavailable") })}
          title={t("chat.retry")}
          className={cn("flex items-center gap-1 text-[11px] text-ink hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", thumb ? "size-full justify-center rounded-[inherit]" : "rounded-md border border-hairline/50 bg-panel px-2 py-1")}
        >
          <RotateCcw aria-hidden="true" size={thumb ? 14 : 11} />
          {!thumb && t("chat.retry")}
        </button>
      </span>
    );
  }
  return (
    <img
      key={attempt}
      src={src}
      alt={alt ?? ""}
      onError={() => setFailedSrc(src)}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      className={cn("block max-w-full", frame)}
      style={{ ...style, objectFit: (widgetString(node, "fit") ?? "cover") as CSSProperties["objectFit"], objectPosition: widgetString(node, "position") }}
    />
  );
}

export function WidgetBadge({ node }: { node: WidgetNode }) {
  const label = widgetString(node, "label") ?? "";
  const color = widgetString(node, "color") ?? "secondary";
  const variant = widgetString(node, "variant") ?? "soft";
  if (variant === "dot") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px] leading-[18px] text-ink-secondary">
        <span aria-hidden="true" className={cn("size-[7px] shrink-0 rounded-full", BADGE_DOT[color] ?? BADGE_DOT.secondary)} />
        <span dir="auto">{label}</span>
      </span>
    );
  }
  return (
    <span
      dir="auto"
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap font-medium", BADGE_SIZE[widgetString(node, "size") ?? "md"] ?? BADGE_SIZE.md,
        node.pill === false ? "rounded-[7px]" : "rounded-full",
        variant === "solid" ? BADGE_SOLID[color] ?? BADGE_SOLID.secondary : BADGE_INK[color] ?? BADGE_INK.secondary,
        // soft and outline take their one colour from the ink they carry
        variant === "outline" && "shadow-[inset_0_0_0_1px_color-mix(in_srgb,currentColor_45%,transparent)]",
        variant !== "solid" && variant !== "outline" && "bg-[color:color-mix(in_srgb,currentColor_13%,transparent)]",
      )}
    >
      {label}
    </span>
  );
}

export function WidgetProgress({ node }: { node: WidgetNode }) {
  const percent = Math.round(Math.min(1, Math.max(0, widgetNumber(node, "value") ?? 0)) * 100);
  const label = widgetString(node, "label");
  return (
    <div className="min-w-0">
      <div
        role="progressbar"
        aria-label={t("widget.progress")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={label ? `${percent}%, ${label}` : undefined}
        className="h-1.5 overflow-hidden rounded-full bg-ink/[0.1]"
      >
        {/* the fill grows by its clip (paint only), never its width (layout) */}
        <div className="h-full w-full rounded-full bg-accent transition-[clip-path] duration-slow ease-out-quint motion-reduce:transition-none" style={{ clipPath: progressClip(percent) }} />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3 text-[13px] leading-[18px]">
        <span className="tabular-nums text-ink-secondary">{percent}%</span>
        {label && <span dir="auto" className="min-w-0 truncate text-ink-tertiary">{label}</span>}
      </div>
    </div>
  );
}
