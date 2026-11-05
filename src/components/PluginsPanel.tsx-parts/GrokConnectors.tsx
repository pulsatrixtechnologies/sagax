import { useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { isGrokConnector, type PluginItem } from "@/lib/plugins-model";
import { cardActionClass } from "../category-modal";
import type { PluginDetailProps } from "../plugins/PluginDetailView";
import { openGrokConnectors, pluginSourceLabel } from "./helpers";

/** "Manage on Grok": the only thing a Grok connector row offers. Sagax
 * neither connects it nor reads its account state. */
export function GrokConnectorAction() {
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" data-grok-manage onClick={() => void openGrokConnectors().then(setError)} className={cn(cardActionClass("quiet"), "inline-flex items-center gap-1")}>
        <ExternalLink size={12} /> {t("connectApps.providers.manage", { provider: "Grok" })}
      </button>
      {error && <span role="alert" className="text-[11.5px] text-danger">{error}</span>}
    </span>
  );
}

/** The row action of an xAI connector, or undefined for any other row. */
export function grokRowAction(item: PluginItem): ReactNode | undefined {
  return isGrokConnector(item) ? <GrokConnectorAction /> : undefined;
}

/** The detail page of an xAI connector: managed on Grok, not connected here. */
export function grokConnectorDetail(item: PluginItem): Omit<PluginDetailProps, "onBack" | "onClose"> {
  return {
    item,
    subtitle: "grok.com/connectors",
    busy: false,
    accounts: [],
    accountAction: <GrokConnectorAction />,
    accountExtra: <p className="mt-2 text-[12px] text-ink-secondary">{t("connectApps.grok.detail")}</p>,
    details: [
      { label: t("connectApps.detail.source"), value: pluginSourceLabel("grok") },
      { label: t("connectApps.detail.accountsCount"), value: t("connectApps.grok.description") },
    ],
  };
}
