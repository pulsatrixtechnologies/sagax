// A vendor the organization console offers, as ONE plugin-like bundle (#4453):
// its logo, the line the console sends in the person's language, "N connectors
// · M on", one switch for all of it; Overview (its line and "Connectors &
// tools") and Connectors (each product with its own icon, state, switch and
// key action). Every product also stays a row of Connectors, marked "in <vendor>".
import { useState } from "react";

import { t, activeLocale } from "@/lib/i18n";
import { inLanguage, type ProductVendor } from "@/lib/capability-kinds";
import type { PersonProduct } from "@/lib/person-products";
import { botProductEnabled } from "../../../shared/bot-products";
import type { Crumb } from "../Breadcrumb";
import { PillTabs } from "../PillTabs";
import { ProductMark, ProductRow, productRowState, productTrailer, vendorLine, type ProductRowsContext } from "./ProductRows";
import { PluginPageHeader } from "./PluginParts";
import { StateIcon } from "./StateIcon";
import { PLUGINS } from "./plugins-style";
import { cn } from "@/lib/cn";

type VendorTab = "overview" | "connectors";

export function VendorPage({ vendor, ctx, onBack, trail }: { vendor: ProductVendor<PersonProduct>; ctx: ProductRowsContext; onBack: () => void; trail?: readonly Crumb[] }) {
  const [tab, setTab] = useState<VendorTab>("overview");
  const ids = vendor.products.map((product) => product.id);
  const on = vendor.products.filter((product) => ctx.forBot ? botProductEnabled(ctx.forBot, product.id) : ctx.bots.some((bot) => botProductEnabled(bot, product.id))).length;
  const worst = [...vendor.products].sort((a, b) => Number(productRowState(a).tone === "ok") - Number(productRowState(b).tone === "ok"))[0]!;
  const line = inLanguage(vendor.description, activeLocale()) ?? vendor.products.map((product) => product.description).find(Boolean);
  const tabs: VendorTab[] = ["overview", "connectors"];
  return (
    <>
      <PluginPageHeader title={vendor.name} trail={trail} onBack={onBack} named />
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-8 pt-[34px] sm:px-[34px]" data-vendor-page={vendor.key}>
        <div className="flex flex-wrap items-center gap-3" data-vendor-head="">
          <ProductMark name={vendor.name} icon={vendor.icon ?? vendor.products.find((product) => product.icon)?.icon} className="size-14 rounded-[14px]" />
          <div className="min-w-0 flex-[1_1_220px] pl-0.5">
            <h2 className="truncate text-[18px] font-normal leading-7 tracking-[-0.005em] text-ink" data-vendor-name="">{vendor.name}</h2>
            <p className="text-[12px] leading-4 text-ink-secondary" data-vendor-line="">{vendorLine(vendor.products.length, on)}</p>
          </div>
          <div className="shrink-0">{productTrailer(ctx, vendor.name, ids, {}, productRowState(worst))}</div>
        </div>
        <PillTabs variant="line" tabs={tabs} tab={tab} onTab={setTab} ariaLabel={vendor.name} idPrefix="vendor"
          label={(id) => id === "overview" ? t("connectApps.detail.tab.overview") : t("connectApps.detail.tab.connectors")}
          after={(id) => id === "connectors" ? <span className="tabular-nums text-ink-tertiary">{vendor.products.length}</span> : null}
          tabAttributes={(id) => ({ "data-vendor-tab": id })} />
        {tab === "overview" ? (
          <div className="grid gap-6 md:grid-cols-[1fr_minmax(220px,300px)]" data-vendor-panel="overview" role="tabpanel" id="vendor-panel-overview" aria-labelledby="vendor-tab-overview">
            <div className="space-y-2">
              {line && <>
                <h3 className={PLUGINS.label}>{t("connectApps.detail.about")}</h3>
                <p className="text-[13px] leading-5 text-ink" data-vendor-description="">{line}</p>
              </>}
            </div>
            <div className="rounded-[14px] border-[0.5px] border-ink/[0.1] p-3" data-vendor-reach="">
              <h3 className="mb-2 text-[12px] leading-4 text-ink-secondary">{t("connectApps.detail.reach")}</h3>
              <ul className="space-y-2">
                {vendor.products.map((product) => (
                  <li key={product.id} className="flex items-center gap-2 text-[13px] leading-[18px] text-ink">
                    <ProductMark name={product.name} icon={product.icon ?? product.group?.icon} className="size-5 rounded-md text-[11px]" />
                    <span className="min-w-0 flex-1 truncate">{product.name}</span>
                    <StateIcon state={productRowState(product)} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div data-vendor-panel="connectors" role="tabpanel" id="vendor-panel-connectors" aria-labelledby="vendor-tab-connectors">
            <p className={cn(PLUGINS.rowSub, "mb-2")}>{t("connectApps.detail.connectorsLine")}</p>
            <ul className="flex flex-col divide-y divide-hairline-weak">
              {vendor.products.map((product) => (
                <li key={product.id}><ProductRow product={product} ctx={ctx} /></li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
