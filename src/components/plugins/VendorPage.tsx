// A vendor the organization console offers, as ONE plugin-like bundle (#4453):
// its logo, one name (the bar is a back link), the grey line "from <console>
// · N connectors · M on", one switch for all of it; underlined tabs: Overview
// (the vendor's line in the person's language, its facts, "Connectors & tools")
// and Connectors (each product with its own icon, state, switch and key
// action), and Skills only when the console offers skills that go with the
// vendor. Every product also stays a row of Connectors, marked "in <vendor>".
import { useState } from "react";
import { Info, Search } from "lucide-react";

import { t, activeLocale } from "@/lib/i18n";
import { inLanguage, type ProductVendor } from "@/lib/capability-kinds";
import type { PersonProduct } from "@/lib/person-products";
import type { Crumb } from "../Breadcrumb";
import { PillTabs } from "../PillTabs";
import { ProductMark, ProductRow, productRowState, productTrailer, vendorLine, vendorOnCount, type ProductRowsContext } from "./ProductRows";
import { PluginPageHeader } from "./PluginParts";
import { DetailHeader, DetailLabel, DetailsBlock, OverviewColumns, SkillCards, sourceLine, DETAIL_BODY } from "./DetailParts";
import { StateIcon } from "./StateIcon";
import { distinguishingNames } from "@/lib/product-short-names";
import { PLUGINS } from "./plugins-style";
import { cn } from "@/lib/cn";

type VendorTab = "overview" | "skills" | "connectors";

/** The chips of the Overview shown before "Show N more", and the count past which the Connectors tab has a search. */
const CHIPS_SHOWN = 8;
const SEARCH_FROM = 8;

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
  const [allChips, setAllChips] = useState(false);
  const [query, setQuery] = useState("");
  const ids = vendor.products.map((product) => product.id);
  // what tells the connectors apart: the part of each name the bundle's connectors do not share (the full name is the tooltip)
  const short = new Map(distinguishingNames(vendor.products.map((product) => product.name)).map((name, index) => [vendor.products[index]!.id, name] as const));
  const needle = query.trim().toLocaleLowerCase();
  const listed = needle ? vendor.products.filter((product) => product.name.toLocaleLowerCase().includes(needle) || (short.get(product.id) ?? "").toLocaleLowerCase().includes(needle)) : vendor.products;
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
          <div className="space-y-5" data-vendor-panel="overview" role="tabpanel" id="vendor-panel-overview" aria-labelledby="vendor-tab-overview">
            {/* one full-width column, the one grid of the other detail pages: the description, what the bundle brings as chips, one line about the network, the facts */}
            {line && <OverviewColumns description={line} />}
            <section data-vendor-brings="">
              <DetailLabel>{t("connectApps.detail.reach")}</DetailLabel>
              <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
                {(allChips ? vendor.products : vendor.products.slice(0, CHIPS_SHOWN)).map((product) => {
                  const state = productRowState(product, () => ctx.onOpen(product));
                  return (
                    <li key={product.id} className="min-w-0">
                      <button type="button" data-vendor-chip-product={product.id} title={product.name} onClick={() => ctx.onOpen(product)}
                        aria-label={t("connectApps.openAria", { name: product.name })}
                        className="flex h-9 w-full min-w-0 items-center gap-2 rounded-full border-[0.5px] border-ink/[0.1] px-3 py-0 text-left text-[13px] leading-[18px] text-ink transition-colors hover:bg-ink/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong motion-reduce:transition-none">
                        <span className="min-w-0 flex-1 break-words">{short.get(product.id)}</span>
                        {/* the state only when it is not "on": a connector off or broken is marked, a bundle that is all on says so once in its header */}
                        {state.tone !== "ok" && <StateIcon state={state} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {vendor.products.length > CHIPS_SHOWN && (
                <button type="button" data-vendor-chips-more="" onClick={() => setAllChips((value) => !value)} className={cn(PLUGINS.groupLink, "-ml-2 mt-2")}>
                  {allChips ? t("connectApps.manage.showFewer") : t("connectApps.showMoreRows", { count: vendor.products.length - CHIPS_SHOWN })}
                </button>
              )}
            </section>
            {network && (
              <p className="flex items-center gap-1.5 text-[13px] leading-5 text-ink" data-detail-network="">
                {t("connectApps.detail.sendsData")}
                <span title={t("connectApps.detail.sendsDataTip")} aria-label={t("connectApps.detail.sendsDataTip")} role="img" className="inline-flex text-ink-tertiary"><Info size={14} aria-hidden="true" /></span>
              </p>
            )}
            <DetailsBlock rows={[
              ...(consoleName ? [{ label: t("connectApps.detail.source"), value: consoleName }] : []),
              { label: t("connectApps.plugin.connectors"), value: String(vendor.products.length) },
            ]} />
          </div>
        ) : tab === "skills" ? (
          <SkillCards skills={skills} />
        ) : (
          <div data-vendor-panel="connectors" role="tabpanel" id="vendor-panel-connectors" aria-labelledby="vendor-tab-connectors">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <p className={PLUGINS.rowSub}>{t("connectApps.detail.connectorsLine")}</p>
              {vendor.products.length > SEARCH_FROM && (
                <label className={cn(PLUGINS.search, "max-w-[260px] flex-none")} data-vendor-search="">
                  <Search size={15} className="shrink-0 text-ink-secondary" aria-hidden="true" />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("connectApps.search.short")} aria-label={t("connectApps.search.short")} className={PLUGINS.searchInput} />
                </label>
              )}
            </div>
            <ul className="flex flex-col divide-y divide-hairline-weak">
              {listed.map((product) => (
                <li key={product.id}><ProductRow product={product} ctx={ctx} hideOrigin line displayName={short.get(product.id)} /></li>
              ))}
            </ul>
            {listed.length === 0 && <p className="py-3 text-[13px] text-ink-secondary" role="status">{t("connectApps.search.empty", { query })}</p>}
          </div>
        )}
      </div>
    </>
  );
}
