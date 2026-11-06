// Animated meme / GIF renderer (#2121): rounded like images, provider
// attribution, and prefers-reduced-motion (static until hover).
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

export function MemeImage({
  src,
  alt,
  attribution,
  caption,
  className,
  onClick,
}: {
  src: string;
  alt?: string;
  attribution?: string;
  caption?: string;
  className?: string;
  onClick?: () => void;
}) {
  const [reduce, setReduce] = useState(prefersReducedMotion);
  const [hover, setHover] = useState(false);
  const [staticUrl, setStaticUrl] = useState<string | null>(null);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const sync = () => setReduce(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);

  useEffect(() => {
    if (!reduce || !src) {
      setStaticUrl(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || 1;
        canvas.height = img.naturalHeight || 1;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        setStaticUrl(canvas.toDataURL("image/png"));
      } catch {
        setStaticUrl(null);
      }
    };
    img.src = src;
    return () => { cancelled = true; };
  }, [reduce, src]);

  const showAnimated = !reduce || hover || !staticUrl;
  const shown = showAnimated ? src : staticUrl!;

  return (
    <figure
      data-meme-image=""
      data-meme-motion={reduce ? (hover ? "hover" : "reduced") : "full"}
      className={cn("relative inline-flex max-w-full flex-col gap-1", className)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      <button
        type="button"
        onClick={onClick}
        className="block max-w-full overflow-hidden rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60"
        aria-label={alt || t("memes.imageAria")}
      >
        <img
          src={shown}
          alt={alt || ""}
          className="max-h-72 max-w-full object-contain"
          draggable={false}
        />
      </button>
      {(caption || attribution) && (
        <figcaption className="flex flex-wrap items-baseline gap-x-2 px-0.5 text-[11px] leading-snug text-ink-tertiary">
          {caption && <span data-meme-caption="">{caption}</span>}
          {attribution && <span data-meme-attribution="">{attribution}</span>}
        </figcaption>
      )}
    </figure>
  );
}
