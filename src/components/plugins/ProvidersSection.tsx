// Plugins > Manage > Providers: per provider (Claude, ChatGPT / Codex, Grok,
// Gemini and every other engine on this installation), its accounts and the
// connectors it brings to bots. Claude's are read from the account
// (HarnessConnectorsSection's request). A Grok bot on an organization server
// sees the cloud connectors of the xAI account it runs on. Codex and Gemini still have none to pass.
import { useCallback, useState } from "react";
import { ExternalLink } from "lucide-react";

import { openExternalLink } from "@/lib/app-links";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { accountDetail, grokProviderConfigured, providerGroups } from "@/lib/providers-model";
import { GROK_CLOUD_CONNECTORS } from "../../../shared/grok-cloud-connectors";
import type { InstanceInfo } from "@/state/store";
import { HarnessConnectorsSection, type HarnessConnectorsAnswer } from "../HarnessConnectorsSection";
import { CapabilityTags, EngineCapabilities } from "./EngineCapabilities";
import { engineConnectorOffers, grokConnectorCapabilities } from "../../../shared/engine-connectors";
import { InstanceProviderMark } from "../ProviderIcons";

const STATUS_LINE: Record<string, LocaleKey> = {
  openai: "harnessConnectors.codex",
  xai: "connectApps.providers.grok",
  google: "connectApps.providers.gemini",
};

const DETAIL_KEY: Record<Exclude<ReturnType<typeof accountDetail>, "email">, LocaleKey> = {
  apiKey: "connectApps.providers.apiKey",
  notSignedIn: "connectApps.providers.notSignedIn",
  unavailable: "connectApps.providers.unavailable",
  signedIn: "connectApps.providers.signedIn",
};

export function ProvidersSection({ instances }: { instances: readonly InstanceInfo[] }) {
  const groups = providerGroups(instances);
  const [claudeConnectors, setClaudeConnectors] = useState<HarnessConnectorsAnswer["claude"]["connectors"]>([]);
  const onClaudeAnswer = useCallback((answer: HarnessConnectorsAnswer) => {
    setClaudeConnectors(answer.claude.available ? answer.claude.connectors : []);
  }, []);
  const offers = engineConnectorOffers({ claude: claudeConnectors, grok: grokProviderConfigured(instances) });
  return (
    <section data-plugins-providers className="space-y-3">
      <p className="text-[12px] leading-relaxed text-ink-secondary">{t("connectApps.providers.intro")}</p>
      {groups.length > 0 && <EngineCapabilities offers={offers} />}
      {groups.length === 0 && <p className="rounded-xl bg-inset px-4 py-3 text-[12.5px] text-ink-secondary">{t("connectApps.providers.none")}</p>}
      {groups.map((group) => (
        <div key={group.id} data-provider={group.id} className="rounded-2xl border border-border bg-card px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center"><InstanceProviderMark instance={group.accounts[0]!} size={20} /></span>
            <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">{group.name}</h3>
            {group.manageUrl && (
              <button
                type="button"
                onClick={() => void openExternalLink(group.manageUrl!)}
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-control px-2.5 py-1 text-[11.5px] font-medium text-ink hover:bg-raised-hover"
              >
                <ExternalLink size={12} /> {t("connectApps.providers.manage", { provider: group.name })}
              </button>
            )}
          </div>
          <ul className="mt-2 space-y-1">
            {group.accounts.map((account) => {
              const detail = accountDetail(account);
              return (
                <li key={account.instanceId} className="flex items-center justify-between gap-3 text-[12.5px]">
                  <span className="min-w-0 truncate text-ink">{account.displayName}</span>
                  <span className="shrink-0 truncate text-[11.5px] text-ink-secondary">
                    {detail === "email" ? account.snapshot.account!.email : t(DETAIL_KEY[detail])}
                  </span>
                </li>
              );
            })}
          </ul>
          {group.bringsConnectors ? (
            <div className="mt-3"><HarnessConnectorsSection placement="provider" onAnswer={onClaudeAnswer} /></div>
          ) : (
            <div className="mt-2">
              <p role="status" className="text-[12px] text-ink-secondary">
                {STATUS_LINE[group.id] ? t(STATUS_LINE[group.id]!) : t("connectApps.providers.other", { name: group.name })}
              </p>
              {group.id === "xai" && grokProviderConfigured(group.accounts) && (
                <ul data-grok-cloud-connectors className="mt-2 space-y-1">
                  {GROK_CLOUD_CONNECTORS.map((connector) => (
                    <li key={connector.id} data-grok-connector={connector.id} className="flex min-w-0 items-baseline gap-2 text-[12.5px] text-ink">
                      <span className="truncate">{connector.name}</span>
                      <CapabilityTags capabilities={grokConnectorCapabilities(connector.id)} name={connector.name} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
