// Connect Apps > Manage, Me scope, on a server linked to Perspicax (#4185):
// one row per product Perspicax serves the person, in the row style of an
// installed plugin (the mark, the name, one grey line, the state at the
// right, the "..." on hover). The rows join Installed through its `personal`
// slot; a row opens the product's page. No row at all when the server has
// none to show.
import type { ReactNode } from "react";
import { Copy, ExternalLink } from "lucide-react";

import { openExternalLink } from "@/lib/app-links";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { productRowSub, productStateLabel, productStateTone, type PersonProduct } from "@/lib/person-products";
import { cn } from "@/lib/cn";
import { EntryMenu } from "./InstalledView";
import { PluginIcon, PluginStatusLabel } from "./PluginParts";
import { PLUGINS } from "./plugins-style";

/** The mark of a product: the vendor's site when Perspicax names one, else
 * the connector tile. */
export function productIcon(product: Pick<PersonProduct, "id" | "name" | "icon">) {
  return { key: `perspicax-product:${product.id}`, kind: "mcp" as const, name: product.name, ...(product.icon ? { domain: product.icon.domain } : {}) };
}

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
 * person). */
export function ProductStateLabel({ product }: { product: Pick<PersonProduct, "state" | "stateCode"> }) {
  const tone = productStateTone(product.state);
  if (tone === "connected") return <PluginStatusLabel status="connected" className="text-[13px] font-normal" />;
  return (
    <span
      data-plugin-status={tone === "attention" ? "needs_auth" : "off"}
      data-product-state={product.state}
      title={product.stateCode}
      className={cn("shrink-0 text-[13px] font-normal", tone === "attention" ? "text-warning" : "text-ink-secondary")}
    >
      {productStateLabel(product.state)}
    </span>
  );
}

export function productRows(products: readonly PersonProduct[], onOpen: (product: PersonProduct) => void): Array<{ key: string; node: ReactNode }> {
  return products.map((product) => {
    const sub = productRowSub(product);
    return {
      key: `product:${product.id}`,
      node: (
        <div className="group flex items-center gap-2 py-3" data-installed-entry={`product:${product.id}`} data-person-product={product.id}>
          <button type="button" onClick={() => onOpen(product)} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left"
            aria-label={t("connectApps.openAria", { name: product.name })}>
            <PluginIcon item={productIcon(product)} className="size-10 rounded-[10px]" />
            <span className="min-w-0 flex-1">
              <span className={PLUGINS.rowName}>{product.name}</span>
              {sub && <span className={PLUGINS.rowSub}>{sub}</span>}
            </span>
            <ProductStateLabel product={product} />
          </button>
          <EntryMenu name={product.name} actions={{ links: productMenuActions(product, 14) }} updateWaiting={false} hoverOnly />
        </div>
      ),
    };
  });
}
