// A plugin or skill the organization installed and that is on for the person
// (the console's section of Connect Apps): its page, in the shape of every
// detail page (one header, underlined tabs). Overview says what it is; Contents
// reads its files through the person's own route (GET
// /api/me/org-capabilities/:id/files, read only, what their turns mount).
import { useState } from "react";

import { t } from "@/lib/i18n";
import type { MemberOrgCapability } from "@/lib/org-capabilities";
import type { Crumb } from "../Breadcrumb";
import { PillTabs } from "../PillTabs";
import { DetailHeader, DetailsBlock, FileExplorer, OverviewColumns, sourceLine, VersionPill } from "./DetailParts";
import { NeutralTile, PluginPageHeader } from "./PluginParts";
import { formWords, modeWords } from "./OrgCapabilitiesSection";

type OrgItemTab = "overview" | "contents";

export function OrgItemPage({ item, consoleName, onBack, trail }: { item: MemberOrgCapability; consoleName?: string; onBack: () => void; trail?: readonly Crumb[] }) {
  const [tab, setTab] = useState<OrgItemTab>("overview");
  const tabs: OrgItemTab[] = ["overview", "contents"];
  return (
    <>
      <PluginPageHeader title={item.name} trail={trail} onBack={onBack} named />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-8 pt-1 sm:px-[34px]" data-org-item-page={item.id}>
        <DetailHeader
          icon={<NeutralTile kind={item.form === "skill" ? "skill" : "plugin"} className="size-14 rounded-[14px]" />}
          name={item.name}
          line={sourceLine([consoleName && t("connectApps.detail.lineFrom", { source: consoleName }), item.version, t(item.mode === "imposed" ? "connectApps.origin.required" : "connectApps.origin.offered")])}
        />
        <PillTabs variant="line" tabs={tabs} tab={tab} onTab={setTab} ariaLabel={item.name} idPrefix="org-item"
          label={(id) => t(id === "overview" ? "connectApps.detail.tab.overview" : "connectApps.detail.tab.contents")}
          tabAttributes={(id) => ({ "data-org-item-tab": id })} />
        {tab === "contents" ? (
          <FileExplorer listUrl={`/api/me/org-capabilities/${encodeURIComponent(item.id)}/files`} pill={<VersionPill name={item.name} version={item.version} current />} />
        ) : (
          <>
            <OverviewColumns description={item.description} />
            <DetailsBlock rows={[
              { label: t("orgCapabilities.field.form"), value: formWords(item.form) },
              { label: t("orgCapabilities.field.mode"), value: modeWords(item.mode) },
              ...(item.version ? [{ label: t("connectApps.detail.version"), value: item.version }] : []),
            ]} />
          </>
        )}
      </div>
    </>
  );
}
