// Connect Apps > Manage, Me scope, on a server linked to Perspicax (#4185):
// one row per product Perspicax serves the person, in the row style of an
// installed plugin (the mark, the name, one grey line, the state at the
// right, the "..." on hover). The rows join Installed through its `personal`
// slot; a row opens the product's page. No row at all when the server has
// none to show.
import { type ReactNode } from "react";
import { Copy, ExternalLink } from "lucide-react";

import { openExternalLink } from "@/lib/app-links";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { productRowSub, productStateLabel, productStateTone, type PersonProduct } from "@/lib/person-products";
import { cn } from "@/lib/cn";
import { groupByVendor, whereLabel, type ProductVendor } from "@/lib/capability-kinds";
import { botProductEnabled } from "../../../shared/bot-products";
import { ITEM_ROW_ATTR, ItemTrailer, type ItemMenuActions } from "./ItemTrailer";
import type { RowState } from "./StateIcon";
import { NeutralTile, PluginIcon, PluginStatusLabel, RemoteImage, type NeutralKind } from "./PluginParts";
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

/** A product's (or a vendor's) mark: the icon the console serves (an image
 * address, crisp at any size), else its site's mark, else ONE neutral tile.
 * Never a coloured letter. */
export function ProductMark({ name, icon, className, kind = "connector" }: { name: string; icon?: { domain?: string; url?: string }; className: string; kind?: NeutralKind }) {
  if (icon?.url) return <RemoteImage src={icon.url} kind={kind} className={cn("rounded-[10px]", className)} />;
  if (icon?.domain) return <PluginIcon item={{ key: `perspicax-product:${name}`, kind: "app", name, domain: icon.domain }} className={cn("shrink-0 rounded-[10px]", className)} />;
  return <NeutralTile kind={kind} className={className} />;
}

/** A vendor's artwork at the banner's size: the largest image the console
 * serves (a logo, else the icon), crisp as an image; else its site's mark at
 * the largest size; else the one neutral tile. */
export function VendorArt({ vendor }: { vendor: ProductVendor<PersonProduct> }) {
  const first = vendor.products.find((product) => product.logo || product.icon);
  const url = vendor.logo ?? vendor.icon?.url ?? first?.logo ?? first?.icon?.url;
  if (url) return <RemoteImage src={url} kind="vendor" className="size-20" />;
  const domain = vendor.icon?.domain ?? first?.icon?.domain;
  if (domain) return <PluginIcon item={{ key: `perspicax-vendor:${vendor.key}`, kind: "app", name: vendor.name, domain }} faviconSize={256} className="size-20 rounded-2xl" />;
  return <NeutralTile kind="vendor" className="size-20 rounded-2xl" />;
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

/** How many of a vendor's products are on, for the person's bots (or the one bot the window was opened from). */
export function vendorOnCount(vendor: ProductVendor<PersonProduct>, ctx: ProductRowsContext): number {
  return vendor.products.filter((product) => reachedBots(ctx, [product.id]).length > 0 || (ctx.forBot && botProductEnabled(ctx.forBot, product.id))).length;
}

/** A product's state as one icon: connected is a check, a key the person can
 * fix is a warning that opens what fixes it, an administrator's step is a
 * grey info. The sentence is the tooltip. */
export function productRowState(product: Pick<PersonProduct, "state" | "stateCode">, onFix?: () => void): RowState {
  const tone = productStateTone(product.state);
  const text = productStateLabel(product.state);
  return tone === "connected" ? { tone: "ok", text } : tone === "attention" ? { tone: "fix", text, onFix } : { tone: "info", text };
}

/** The control at a product's (or a vendor's) right: where it is on, its
 * switch for every bot (or the one bot), the "..." menu, the Choose the bots
 * checklist. */
export function productTrailer(ctx: ProductRowsContext, name: string, ids: readonly string[], extra: ItemMenuActions, state?: RowState) {
  if (ctx.forBot) {
    const on = ids.every((id) => botProductEnabled(ctx.forBot, id));
    return <ItemTrailer state={state} name={name} where="bot" on={on} onToggle={ctx.lockedReason ? undefined : (next) => ctx.setProducts([ctx.forBot!.id], ids, next)} lockedReason={ctx.lockedReason} actions={extra} />;
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
  return <ItemTrailer state={state} name={name} where={where} whereKind={where.kind} on={where.kind === "all"} onToggle={(next) => ctx.setProducts(ctx.bots.map((bot) => bot.id), ids, next)} actions={actions} />;
}

/** The worst state of a vendor's products, for its one line. */
function worstState(products: readonly PersonProduct[]): PersonProduct {
  const rank = (product: PersonProduct) => productStateTone(product.state) === "attention" ? 0 : productStateTone(product.state) === "quiet" ? 1 : 2;
  return [...products].sort((a, b) => rank(a) - rank(b))[0]!;
}

/** One product's row: the mark, the name, one grey line (its endpoints on
 * one line), the state, then its own trailer. The name opens its page. */
export function ProductRow({ product, ctx, nested = false, partOf }: { product: PersonProduct; ctx: ProductRowsContext; nested?: boolean; /** the bundle it belongs to: a small chip after the name, opening it */ partOf?: { name: string; onOpen: () => void } }) {
  const what = product.endpoints && product.endpoints.length > 0 ? product.endpoints.join(", ") : product.description ?? productRowSub(product);
  // how it got there, then what it does (a vendor's products sit under its own line)
  const sub = nested ? what : [t("connectApps.origin.org"), what].filter(Boolean).join(" \u00b7 ");
  return (
    <div className={cn("group flex items-center gap-3 py-3", nested && "pl-[52px]")} data-installed-entry={`product:${product.id}`} data-person-product={product.id} {...{ [ITEM_ROW_ATTR]: "" }}>
      {/* the row is a container: ONE button over its whole area opens the page, and the "in <vendor>" chip is its own button above it (never a control inside a control) */}
      <div className="relative flex min-w-0 flex-1 items-center gap-3 rounded-xl">
        <button type="button" onClick={() => ctx.onOpen(product)} className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
          aria-label={t("connectApps.openAria", { name: product.name })} />
        <ProductMark name={product.name} icon={product.icon ?? product.group?.icon} className={cn("pointer-events-none", nested ? "size-8" : "size-10")} />
        {/* the name keeps its whole width; the state goes under it when both do not fit */}
        <span className="pointer-events-none min-w-0 flex-1" data-person-product-line>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn(PLUGINS.rowName, "min-w-0")}>{product.name}</span>
            {partOf && (
              <button type="button" data-vendor-chip="" aria-label={t("connectApps.vendor.inAria", { name: partOf.name })}
                onClick={() => partOf.onOpen()}
                className="pointer-events-auto relative z-10 shrink-0 cursor-pointer rounded-full border-[0.5px] border-ink/20 px-1.5 text-[11px] leading-4 text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong">
                {t("connectApps.vendor.in", { name: partOf.name })}
              </button>
            )}
          </span>
          {sub && <span className={cn(PLUGINS.rowSub, "!line-clamp-1")} title={sub}>{sub}</span>}
        </span>
      </div>
      {productTrailer(ctx, product.name, [product.id], { links: productMenuActions(product, 14).map((action) => ({ id: action.id, label: action.label, icon: action.icon, run: action.run })), detail: () => ctx.onOpen(product) }, productRowState(product, () => ctx.onOpen(product)))}
    </div>
  );
}

/** One vendor as ONE plugin-like bundle (#4453): its logo, "N connectors · M on",
 * its state rolled up (the worst wins, one icon), one switch for all of it and
 * the menu. It opens the vendor's page; it never unfolds. */
export function VendorBundleRow({ vendor, ctx, onOpen }: { vendor: ProductVendor<PersonProduct>; ctx: ProductRowsContext; onOpen: () => void }) {
  const ids = vendor.products.map((product) => product.id);
  const worst = worstState(vendor.products);
  const on = vendor.products.filter((product) => reachedBots(ctx, [product.id]).length > 0 || (ctx.forBot && botProductEnabled(ctx.forBot, product.id))).length;
  return (
    <div className="group flex items-center gap-3 py-3" data-vendor-bundle={vendor.key} {...{ [ITEM_ROW_ATTR]: "" }}>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
        aria-label={t("connectApps.openAria", { name: vendor.name })}>
        <ProductMark kind="vendor" name={vendor.name} icon={vendor.icon ?? vendor.products.find((product) => product.icon)?.icon} className="size-10" />
        <span className="min-w-0 flex-1">
          <span className={PLUGINS.rowName}>{vendor.name}</span>
          <span className={PLUGINS.rowSub}>{vendorLine(vendor.products.length, on)}</span>
        </span>
      </button>
      {productTrailer(ctx, vendor.name, ids, { detail: onOpen }, productRowState(worst, onOpen))}
    </div>
  );
}

/** "N connectors · M on" */
export function vendorLine(connectors: number, on: number): string {
  return t("connectApps.vendor.line", {
    connectors: connectors === 1 ? t("connectApps.count.connectorOne") : t("connectApps.count.connectorMany", { count: connectors }),
    on: on === 1 ? t("connectApps.vendor.onOne") : t("connectApps.vendor.onMany", { count: on }),
  });
}

/** The rows of the console's section for one kind. Under Connectors every
 * product is its own row (marked "in <vendor>" when it is part of a bundle,
 * the chip opening it); under Plugins a vendor is one bundle row. */
export function productRows(products: readonly PersonProduct[], ctx: ProductRowsContext, bundles?: { mode: "connectors" | "plugins"; onOpenVendor: (key: string) => void }): Array<{ key: string; node: ReactNode }> {
  if (bundles?.mode === "connectors") {
    return products.map((product) => ({
      key: `product:${product.id}`,
      node: <ProductRow product={product} ctx={ctx} partOf={product.group ? { name: product.group.name, onOpen: () => bundles.onOpenVendor(`vendor:${product.group!.id}`) } : undefined} />,
    }));
  }
  if (bundles?.mode === "plugins") {
    return groupByVendor(products).filter((vendor) => vendor.products.some((product) => product.group)).map((vendor) => ({
      key: vendor.key,
      node: <VendorBundleRow vendor={vendor} ctx={ctx} onOpen={() => bundles.onOpenVendor(vendor.key)} />,
    }));
  }
  // no bundles asked for: every product is its own row
  return products.map((product) => ({ key: `product:${product.id}`, node: <ProductRow product={product} ctx={ctx} /> }));
}
