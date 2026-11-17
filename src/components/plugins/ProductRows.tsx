// Connect Apps > Manage, Me scope, on a server linked to Perspicax (#4185):
// one row per product Perspicax serves the person, in the row style of an
// installed plugin (the mark, the name, one grey line, the state at the
// right, the "..." on hover). The rows join Installed through its `personal`
// slot; a row opens the product's page. No row at all when the server has
// none to show.
import { useState, type ReactNode } from "react";
import { ChevronRight, Copy, ExternalLink } from "lucide-react";

import { openExternalLink } from "@/lib/app-links";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { productRowSub, productStateLabel, productStateTone, type PersonProduct } from "@/lib/person-products";
import { cn } from "@/lib/cn";
import { groupByVendor, whereLabel, type ProductVendor } from "@/lib/capability-kinds";
import { botProductEnabled } from "../../../shared/bot-products";
import { ITEM_ROW_ATTR, ItemTrailer, type ItemMenuActions } from "./ItemTrailer";
import { LetterTile, PluginIcon, PluginStatusLabel } from "./PluginParts";
import { PLUGINS } from "./plugins-style";

/** The "..." actions of a product, the same in its row and on its page:
 * open it in Perspicax (only when Perspicax names that page), copy its id. */
export function productMenuActions(product: Pick<PersonProduct, "id" | "consoleUrl">, iconSize: number, onCopied?: (copied: boolean) => void) {
  const consoleUrl = product.consoleUrl;
  return [
    ...(consoleUrl ? [{ id: "open-console", icon: <ExternalLink size={iconSize} />, label: t("personProducts.openInPerspicax"), run: () => void openExternalLink(consoleUrl) }] : []),
    { id: "copy-id", icon: <Copy size={iconSize} />, label: t("personProducts.copyId"), run: () => { void copyText(product.id).then((result) => onCopied?.(result === "copied")); } },
  ];
}

/** The state at a row's (or a page's) right, in words, in the neighbours'
 * state style (13px, normal weight; the warning colour when it needs the
 * person). In a row (`wrap`) it may break onto its own line under the name
 * when both do not fit, so a long French state never cuts the product's name
 * at phone width. */
export function ProductStateLabel({ product, wrap = false }: { product: Pick<PersonProduct, "state" | "stateCode">; wrap?: boolean }) {
  const tone = productStateTone(product.state);
  if (tone === "connected") {
    const mark = <PluginStatusLabel status="connected" className="text-[12px] font-normal" />;
    return wrap ? <span className="ml-auto flex">{mark}</span> : mark;
  }
  return (
    <span
      data-plugin-status={tone === "attention" ? "needs_auth" : "off"}
      data-product-state={product.state}
      title={product.stateCode}
      className={cn(
        "text-[12px] font-normal",
        wrap ? "ml-auto min-w-0 max-w-full text-right leading-[18px]" : "shrink-0",
        tone === "attention" ? "text-warning" : "text-ink-secondary",
      )}
    >
      {productStateLabel(product.state)}
    </span>
  );
}

/** A product's (or a vendor's) mark: its own icon when the console sends
 * one, else the app's lettered tile. */
export function ProductMark({ name, domain, className }: { name: string; domain?: string; className: string }) {
  if (domain) return <PluginIcon item={{ key: `perspicax-product:${name}`, kind: "app", name, domain }} className={cn("shrink-0 rounded-[10px]", className)} />;
  return <LetterTile name={name} className={className} />;
}

/** The bots a product row reads and writes: the person's own, with each
 * one's switches (WireBot.products). */
export interface ProductBot {
  id: string;
  name: string;
  products?: Record<string, boolean>;
}

/** What the rows need of the window: the person's bots, the bot the window
 * was opened from (the switch then stands for that bot), and the write. */
export interface ProductRowsContext {
  bots: readonly ProductBot[];
  /** the bot the window was opened from; absent: every one of the person's */
  forBot?: ProductBot;
  /** the person's switches written: these bots, these products, on or off */
  setProducts: (botIds: readonly string[], productIds: readonly string[], next: boolean) => void;
  onOpen: (product: PersonProduct) => void;
  /** a bot the person may not change (another person's): locked, with this */
  lockedReason?: string;
}

const reachedBots = (ctx: ProductRowsContext, ids: readonly string[]) =>
  ctx.bots.filter((bot) => ids.length > 0 && ids.every((id) => botProductEnabled(bot, id)));

/** The control at a product's (or a vendor's) right: where it is on, its
 * switch for every bot (or the one bot), the "..." menu, the Choose the bots
 * checklist. */
function productTrailer(ctx: ProductRowsContext, name: string, ids: readonly string[], extra: ItemMenuActions) {
  if (ctx.forBot) {
    const on = ids.every((id) => botProductEnabled(ctx.forBot, id));
    return <ItemTrailer name={name} where="bot" on={on} onToggle={ctx.lockedReason ? undefined : (next) => ctx.setProducts([ctx.forBot!.id], ids, next)} lockedReason={ctx.lockedReason} actions={extra} />;
  }
  const reached = reachedBots(ctx, ids);
  const where = whereLabel(reached.length, ctx.bots.length);
  const actions: ItemMenuActions = {
    allBots: () => ctx.setProducts(ctx.bots.map((bot) => bot.id), ids, true),
    offEverywhere: () => ctx.setProducts(ctx.bots.map((bot) => bot.id), ids, false),
    ...(ctx.bots.length > 1 ? {
      choose: {
        load: () => ctx.bots.map((bot) => ({ id: bot.id, name: bot.name, on: ids.every((id) => botProductEnabled(bot, id)) })),
        save: (next: Record<string, boolean>) => {
          for (const on of [true, false]) {
            const to = Object.entries(next).filter(([, value]) => value === on).map(([id]) => id);
            if (to.length > 0) ctx.setProducts(to, ids, on);
          }
        },
      },
    } : {}),
    ...extra,
  };
  return <ItemTrailer name={name} where={where} whereKind={where.kind} on={where.kind === "all"} onToggle={(next) => ctx.setProducts(ctx.bots.map((bot) => bot.id), ids, next)} actions={actions} />;
}

/** The worst state of a vendor's products, for its one line. */
function worstState(products: readonly PersonProduct[]): PersonProduct {
  const rank = (product: PersonProduct) => productStateTone(product.state) === "attention" ? 0 : productStateTone(product.state) === "quiet" ? 1 : 2;
  return [...products].sort((a, b) => rank(a) - rank(b))[0]!;
}

/** One product's row: the mark, the name, one grey line (its endpoints on
 * one line), the state, then its own trailer. The name opens its page. */
function ProductRow({ product, ctx, nested = false }: { product: PersonProduct; ctx: ProductRowsContext; nested?: boolean }) {
  const what = product.endpoints && product.endpoints.length > 0 ? product.endpoints.join(", ") : product.description ?? productRowSub(product);
  // how it got there, then what it does (a vendor's products sit under its own line)
  const sub = nested ? what : [t("connectApps.origin.org"), what].filter(Boolean).join(" \u00b7 ");
  return (
    <div className={cn("group flex items-center gap-3 py-3", nested && "pl-[52px]")} data-installed-entry={`product:${product.id}`} data-person-product={product.id} {...{ [ITEM_ROW_ATTR]: "" }}>
      <button type="button" onClick={() => ctx.onOpen(product)} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left"
        aria-label={t("connectApps.openAria", { name: product.name })}>
        <ProductMark name={product.name} domain={product.icon?.domain} className={nested ? "size-8" : "size-10"} />
        {/* the name keeps its whole width; the state goes under it when both do not fit */}
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1" data-person-product-line>
          <span className="min-w-0 max-w-full flex-[1_1_16rem]">
            <span className={PLUGINS.rowName}>{product.name}</span>
            {sub && <span className={cn(PLUGINS.rowSub, "!line-clamp-1")} title={sub}>{sub}</span>}
          </span>
          <ProductStateLabel product={product} wrap />
        </span>
      </button>
      {productTrailer(ctx, product.name, [product.id], { links: productMenuActions(product, 14).map((action) => ({ id: action.id, label: action.label, icon: action.icon, run: action.run })), detail: () => ctx.onOpen(product) })}
    </div>
  );
}

/** A vendor: one row that unfolds into its products (each with its own
 * switch). Its switch turns all of them on or off. */
function VendorRow({ vendor, ctx }: { vendor: ProductVendor<PersonProduct>; ctx: ProductRowsContext }) {
  const [open, setOpen] = useState(false);
  const ids = vendor.products.map((product) => product.id);
  const worst = worstState(vendor.products);
  const on = vendor.products.filter((product) => reachedBots(ctx, [product.id]).length > 0 || (ctx.forBot && botProductEnabled(ctx.forBot, product.id))).length;
  const sub = [vendor.products.length === 1 ? t("connectApps.vendor.productOne") : t("connectApps.vendor.productMany", { count: vendor.products.length }), t("connectApps.vendor.on", { count: on })].join(" \u00b7 ");
  return (
    <div data-vendor={vendor.key} data-vendor-open={open ? "" : undefined}>
      <div className="group flex items-center gap-3 py-3" {...{ [ITEM_ROW_ATTR]: "" }}>
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} data-vendor-toggle=""
          aria-label={t(open ? "connectApps.vendor.fold" : "connectApps.vendor.unfold", { name: vendor.name })}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong">
          <ProductMark name={vendor.name} domain={vendor.products.find((product) => product.icon)?.icon?.domain} className="size-10" />
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 max-w-full flex-[1_0_auto]">
              <span className={cn(PLUGINS.rowName, "flex items-center gap-1")}>
                <span className="truncate">{vendor.name}</span>
                <ChevronRight size={14} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform duration-100 motion-reduce:transition-none", open && "rotate-90")} />
              </span>
              <span className={PLUGINS.rowSub}>{sub}</span>
            </span>
            <ProductStateLabel product={worst} wrap />
          </span>
        </button>
        {productTrailer(ctx, vendor.name, ids, {})}
      </div>
      {open && (
        <div className="mb-1" data-vendor-products="">
          {vendor.products.map((product) => <ProductRow key={product.id} product={product} ctx={ctx} nested />)}
        </div>
      )}
    </div>
  );
}

/** The rows of the console's section: one per vendor (a product with no
 * vendor stands alone). */
export function productRows(products: readonly PersonProduct[], ctx: ProductRowsContext): Array<{ key: string; node: ReactNode }> {
  return groupByVendor(products).map((vendor) => ({
    key: vendor.key,
    node: vendor.products.length === 1 && !vendor.products[0]!.group
      ? <ProductRow product={vendor.products[0]!} ctx={ctx} />
      : <VendorRow vendor={vendor} ctx={ctx} />,
  }));
}
