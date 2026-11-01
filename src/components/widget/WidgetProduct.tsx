// Shopping cards (shared/widget.ts "Products"): a Carousel of Products side by
// side, in stock first, and one Product's card: its picture, name, rating,
// price, store, badges and stock, then Buy now and View. The picture and the
// buttons are the Product's own Image and Button children, drawn by the usual
// renderers, so the image waits for its click and a press goes the usual way.
import type { ReactNode } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { widgetNumber, widgetString, type WidgetNode } from "../../../shared/widget";
import { WidgetBadge } from "./WidgetContent";
import type { WidgetWhere } from "./widget-where";
import { kids } from "./widget-style";

/** A price in the person's locale when the currency is known, else as written. */
export function productPrice(amount: string | undefined, currency: string | undefined, locale = activeLocale()): string {
  if (!amount) return "";
  const value = Number(amount);
  if (currency && Number.isFinite(value)) {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
    } catch {
      // an unknown code reads as written
    }
  }
  return [amount, currency].filter(Boolean).join(" ");
}

const STARS = [0, 1, 2, 3, 4];

function Rating({ value, reviews }: { value: number; reviews?: number }) {
  const label = t("widget.product.rating", { value: value.toFixed(1) });
  return (
    <div className="flex min-w-0 items-center gap-1 text-[12px] leading-4 text-ink-secondary" aria-label={reviews === undefined ? label : `${label}, ${t("widget.product.reviews", { count: reviews })}`} role="img">
      <span aria-hidden="true" className="flex shrink-0 items-center">
        {STARS.map((index) => {
          const fill = Math.max(0, Math.min(1, value - index));
          return (
            <span key={index} className="relative inline-block size-3">
              <Star size={12} className="absolute inset-0 text-ink/20" fill="currentColor" strokeWidth={0} />
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star size={12} className="text-warning" fill="currentColor" strokeWidth={0} />
              </span>
            </span>
          );
        })}
      </span>
      <span aria-hidden="true" className="tabular-nums">{value.toFixed(1)}</span>
      {reviews !== undefined && <span aria-hidden="true" className="truncate text-ink-tertiary">({reviews.toLocaleString()})</span>}
    </div>
  );
}

const PRODUCT_WHERE: WidgetWhere = { axis: "col", gap: 8 };

/** Draws one child (the Product's picture or a button) as the widget does. */
type Draw = (node: WidgetNode, where: WidgetWhere) => ReactNode;

export function WidgetProduct({ node, draw, inCarousel = false }: { node: WidgetNode; draw: Draw; inCarousel?: boolean }) {
  const title = widgetString(node, "title") ?? "";
  const currency = widgetString(node, "currency");
  const price = productPrice(widgetString(node, "price"), currency);
  const was = productPrice(widgetString(node, "compareAtPrice"), currency);
  const rating = widgetNumber(node, "rating");
  const reviews = widgetNumber(node, "reviews");
  const store = widgetString(node, "store");
  const delivery = widgetString(node, "delivery");
  const badges = Array.isArray(node.badges) ? (node.badges as unknown[]).filter((item): item is string => typeof item === "string") : [];
  const outOfStock = node.inStock === false;
  const children = kids(node);
  const image = children.find((child) => child.type === "Image");
  const buttons = children.filter((child) => child.type === "Button");
  return (
    <article
      data-widget-product=""
      aria-label={title}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-2xl bg-inset p-3",
        inCarousel && "w-[212px] shrink-0 snap-start",
        outOfStock && "opacity-80",
      )}
    >
      {image && (
        <div className="overflow-hidden rounded-xl bg-white">
          {draw(image, PRODUCT_WHERE)}
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-1">
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {badges.map((label, index) => <WidgetBadge key={index} node={{ type: "Badge", id: `${node.id}-b${index}`, label, size: "sm", color: index === 0 ? "info" : "secondary" }} />)}
          </div>
        )}
        <div dir="auto" title={title} className="line-clamp-2 min-h-10 text-[14px] font-medium leading-5 text-ink">{title}</div>
        {rating !== undefined && <Rating value={rating} reviews={reviews} />}
        <div className="flex min-w-0 items-baseline gap-1.5">
          {price && <span className="text-[17px] font-semibold leading-6 tabular-nums text-ink">{price}</span>}
          {was && <span className="text-[12px] leading-4 tabular-nums text-ink-tertiary line-through" aria-label={t("widget.product.was", { price: was })}>{was}</span>}
        </div>
        {store && <div dir="auto" className="truncate text-[12px] leading-4 text-ink-secondary">{t("widget.product.soldBy", { store })}</div>}
        <div className={cn("truncate text-[12px] leading-4", outOfStock ? "text-danger" : "text-success")}>
          {outOfStock ? t("widget.product.outOfStock") : delivery ?? t("widget.product.inStock")}
        </div>
      </div>
      {buttons.length > 0 && (
        <div className="mt-auto flex flex-col gap-1.5">
          {buttons.map((button) => <div key={button.id} className="flex">{draw(button, PRODUCT_WHERE)}</div>)}
        </div>
      )}
    </article>
  );
}

export function WidgetCarousel({ node, draw }: { node: WidgetNode; draw: Draw }) {
  const title = widgetString(node, "title");
  const products = kids(node).filter((child) => child.type === "Product");
  return (
    <section data-widget-carousel="" aria-label={title ?? t("widget.product.carousel")} className="flex min-w-0 flex-col gap-2">
      {title && <div dir="auto" className="text-[13px] font-medium leading-[18px] text-ink-secondary">{title}</div>}
      <div className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]" tabIndex={0} role="list">
        {products.map((product) => (
          <div key={product.id} role="listitem" className="flex">
            <WidgetProduct node={product} draw={draw} inCarousel />
          </div>
        ))}
      </div>
    </section>
  );
}
