// A vendor the organization console offers, as ONE plugin-like bundle (#4453):
// its logo, one name (the bar is a back link), the grey line "from <console>
// · N connectors · M on", one switch for all of it; underlined tabs: Overview
// (the vendor's line in the person's language, its facts, "Connectors & tools")
// and Connectors (each product with its own icon, state, switch and key
// action), and Skills only when the console offers skills that go with the
// vendor. Every product also stays a row of Connectors, marked "in <vendor>".
import { useState } from "react";

import { t, activeLocale } from "@/lib/i18n";
import { inLanguage, type ProductVendor } from "@/lib/capability-kinds";
import type { PersonProduct } from "@/lib/person-products";
import type { Crumb } from "../Breadcrumb";
import { PillTabs } from "../PillTabs";
import { ProductMark, ProductRow, productRowState, productTrailer, vendorLine, vendorOnCount, type ProductRowsContext } from "./ProductRows";
import { PluginPageHeader } from "./PluginParts";
import { DetailHeader, OverviewColumns, ReachPanel, SkillCards, sourceLine, DETAIL_BODY } from "./DetailParts";
import { CARD_GRID, PLUGINS } from "./plugins-style";
import { cn } from "@/lib/cn";

type VendorTab = "overview" | "skills" | "connectors";

export function VendorPage({ vendor, ctx, onBack, trail, consoleName, skills = [] }: {
  vendor: ProductVendor<PersonProduct>;
  ctx: ProductRowsContext;
  onBack: () => void;
  trail?: readonly Crumb[];
  /** the console the vendor comes from ("Perspicax · <organization>"), for the grey line */
  consoleName?: string;
  /** the skills the console offers that go with this vendor; none: no tab */
  skills?: ReadonlyArray<{ name: string; description: string; onOpen?: () => void }>;
}) {
  const [tab, setTab] = useState<VendorTab>("overview");
  const ids = vendor.products.map((product) => product.id);
  const on = vendorOnCount(vendor, ctx);
  const worst = [...vendor.products].sort((a, b) => Number(productRowState(a).tone === "ok") - Number(productRowState(b).tone === "ok"))[0]!;
  const line = inLanguage(vendor.description, activeLocale()) ?? vendor.products.map((product) => product.description).find(Boolean);
  const tabs: VendorTab[] = ["overview", ...(skills.length > 0 ? ["skills" as const] : []), "connectors"];
  // every product is served by the console over the network: a vendor with an address says so
  const network = vendor.products.some((product) => Boolean(product.address));
  const tabLabel = (id: VendorTab) => t(id === "overview" ? "connectApps.detail.tab.overview" : id === "skills" ? "connectApps.detail.tab.skills" : "connectApps.detail.tab.connectors");
  return (
    <>
      <PluginPageHeader title={vendor.name} trail={trail} onBack={onBack} named />
      <div className={DETAIL_BODY} data-vendor-page={vendor.key}>
        <DetailHeader
          attrs={{ "data-vendor-head": "" }}
          icon={<ProductMark kind="vendor" name={vendor.name} icon={vendor.icon ?? vendor.products.find((product) => product.icon)?.icon} className="size-14 rounded-[14px]" />}
          name={vendor.name}
          line={sourceLine([consoleName && t("connectApps.detail.lineFrom", { source: consoleName }), vendorLine(vendor.products.length, on)])}
          actions={productTrailer(ctx, vendor.name, ids, {}, productRowState(worst))}
        />
        <PillTabs variant="line" tabs={tabs} tab={tab} onTab={setTab} ariaLabel={vendor.name} idPrefix="vendor"
          label={tabLabel}
          after={(id) => id === "connectors" ? <span className="tabular-nums text-ink-tertiary">{vendor.products.length}</span> : id === "skills" ? <span className="tabular-nums text-ink-tertiary">{skills.length}</span> : null}
          tabAttributes={(id) => ({ "data-vendor-tab": id })} />
        {tab === "overview" ? (
          <div className="space-y-6" data-vendor-panel="overview" role="tabpanel" id="vendor-panel-overview" aria-labelledby="vendor-tab-overview">
            <OverviewColumns
              description={line}
              reach={(
                <ReachPanel network={network} rows={vendor.products.map((product) => ({
                  key: product.id, name: product.name, state: productRowState(product),
                  icon: <ProductMark name={product.name} icon={product.icon ?? product.group?.icon} className="size-5 rounded-md text-[12px]" />,
                }))} />
              )}
            />
          </div>
        ) : tab === "skills" ? (
          <SkillCards skills={skills} />
        ) : (
          <div data-vendor-panel="connectors" role="tabpanel" id="vendor-panel-connectors" aria-labelledby="vendor-tab-connectors">
            <p className={cn(PLUGINS.rowSub, "mb-2")}>{t("connectApps.detail.connectorsLine")}</p>
            <ul className={CARD_GRID}>
              {vendor.products.map((product) => (
                <li key={product.id}><ProductRow product={product} ctx={ctx} hideOrigin /></li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
