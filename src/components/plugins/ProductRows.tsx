// Connect Apps > Manage, Me scope, on a server linked to Perspicax (#4185):
// one row per product Perspicax serves the person, in the row style of an
// installed plugin (the mark, the name, one grey line, the state at the
// right). The rows join Installed through its `personal` slot; a row opens
// the product's page. No row at all when the server has none to show.
import type { ReactNode } from "react";

import { t } from "@/lib/i18n";
import { productRowSub, productStateLabel, productStateTone, type PersonProduct } from "@/lib/person-products";
import { cn } from "@/lib/cn";
import { PluginIcon, PluginStatusLabel } from "./PluginParts";
import { PLUGINS } from "./plugins-style";

/** The mark of a product: the vendor's site when Perspicax names one, else
 * the connector tile. */
export function productIcon(product: Pick<PersonProduct, "id" | "name" | "icon">) {
  return { key: `perspicax-product:${product.id}`, kind: "mcp" as const, name: product.name, ...(product.icon ? { domain: product.icon.domain } : {}) };
}

/** The state at a row's (or a page's) right, in words. */
export function ProductStateLabel({ product }: { product: Pick<PersonProduct, "state" | "stateCode"> }) {
  const tone = productStateTone(product.state);
  if (tone === "connected") return <PluginStatusLabel status="connected" />;
  return (
    <span
      data-plugin-status={tone === "attention" ? "needs_auth" : "off"}
      data-product-state={product.state}
      title={product.stateCode}
      className={cn("shrink-0 text-[12px] font-medium", tone === "attention" ? "text-warning" : "text-ink-secondary")}
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
        <div className="flex items-center gap-2 py-3" data-installed-entry={`product:${product.id}`} data-person-product={product.id}>
          <button type="button" onClick={() => onOpen(product)} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left"
            aria-label={t("connectApps.openAria", { name: product.name })}>
            <PluginIcon item={productIcon(product)} className="size-10 rounded-[10px]" />
            <span className="min-w-0 flex-1">
              <span className={PLUGINS.rowName}>{product.name}</span>
              {sub && <span className={PLUGINS.rowSub}>{sub}</span>}
            </span>
            <ProductStateLabel product={product} />
          </button>
        </div>
      ),
    };
  });
}
