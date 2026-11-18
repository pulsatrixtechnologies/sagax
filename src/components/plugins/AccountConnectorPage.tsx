// A connector an engine account brought (Claude, ChatGPT, Grok), opened from Discover or Yours (2026-11-17, the owner:
// "clicking item should open the installed page with the details"): what the account says about it (its name, the
// account, what it reaches, its state), and the one action the provider owns: Manage on <provider>. The connector's
// tools are the provider's to list: when the account does not say, the page says so and never stays empty.
import { ExternalLink } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Crumb } from "../Breadcrumb";
import { CapabilityTags } from "./EngineCapabilities";
import { AccountConnectorStatus, AccountMark, accountStatusWord, openAccountManage, type AccountConnectorRow } from "./HarnessConnectorGroups";
import { PluginCard, PluginPageHeader } from "./PluginParts";
import { DETAIL_BODY, DetailHeader, FactRow, FactRows, HEADER_ACTION, sourceLine } from "./DetailParts";
import { PluginStatusLabel } from "./PluginParts";
import { CARD_ICON, PLUGINS } from "./plugins-style";

export function AccountConnectorPage({ row, onBack, trail }: { row: AccountConnectorRow; onBack: () => void; trail?: readonly Crumb[] }) {
  const state = accountStatusWord(row.status);
  return (
    <>
      <PluginPageHeader title={row.name} trail={trail} onBack={onBack} named />
      <div className={DETAIL_BODY} data-account-page={row.key}>
        <DetailHeader
          attrs={{ "data-account-head": "" }}
          icon={<AccountMark row={row} className={cn(CARD_ICON, "size-14 rounded-[14px]")} />}
          name={row.name}
          line={sourceLine([t("connectApps.brings.accountConnector", { provider: row.provider })])}
          actions={(
            <>
              <AccountConnectorStatus row={row} installedMark={<PluginStatusLabel status="connected" className="text-[12px] font-normal" />} />
              <button type="button" data-account-manage={row.engine} className={cn(PLUGINS.fillPill, HEADER_ACTION)} onClick={() => openAccountManage(row.manageUrl)}>
                <ExternalLink size={14} aria-hidden="true" />
                {t("connectApps.providers.manage", { provider: row.provider })}
              </button>
            </>
          )}
        />
        <PluginCard title={t("connectApps.detail.details")}>
          <FactRows attrs={{ "data-account-facts": "" }}>
            <FactRow label={t("connectApps.detail.source")}>{row.provider}</FactRow>
            {state && <FactRow label={t("capabilities.detail.state")}>{state}</FactRow>}
            {row.capabilities.length > 0 && <FactRow label={t("connectApps.detail.reach")}><CapabilityTags capabilities={row.capabilities} /></FactRow>}
          </FactRows>
        </PluginCard>
      </div>
    </>
  );
}
