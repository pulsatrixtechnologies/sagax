// Connected apps > "Provided by Claude (your account)": the claude.ai
// connectors of the caller's own Claude account (server/harness-connectors.ts).
// While Connected apps is switched off (Settings > Experimental), the same
// read-only status shows in Settings > Model providers instead.
// Read-only here: people add, sign in to and remove them on claude.ai.
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, Plug, RefreshCw } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { openExternalLink } from "@/lib/app-links";
import { HelpTip } from "./SettingsPrimitives";
import { ConnectFromEngine } from "./ConnectFromEngine";
import { CapabilityTags } from "./plugins/EngineCapabilities";
import { claudeAiConnectorCapabilities } from "../../shared/engine-connectors";

type ConnectorStatus = "connected" | "needs_auth" | "failed" | "unknown";
type Unavailable = "disabled" | "managed_policy" | "no_engine" | "not_signed_in" | "not_operator" | "key" | "unknown";

export interface HarnessConnectorsAnswer {
  manageUrl: string;
  canManage: boolean;
  enabled: boolean;
  claude: { available: boolean; reason?: Unavailable; connectors: Array<{ name: string; status: ConnectorStatus }> };
  codex: { available: boolean; reason?: string };
}

const STATUS_KEY: Record<ConnectorStatus, LocaleKey> = {
  connected: "harnessConnectors.status.connected",
  needs_auth: "harnessConnectors.status.needsAuth",
  failed: "harnessConnectors.status.failed",
  unknown: "harnessConnectors.status.unknown",
};

const UNAVAILABLE_KEY: Record<Unavailable, LocaleKey> = {
  disabled: "harnessConnectors.unavailable.disabled",
  managed_policy: "harnessConnectors.unavailable.managedPolicy",
  no_engine: "harnessConnectors.unavailable.noEngine",
  not_signed_in: "harnessConnectors.unavailable.notSignedIn",
  not_operator: "harnessConnectors.unavailable.notOperator",
  key: "harnessConnectors.unavailable.key",
  unknown: "harnessConnectors.unavailable.unknown",
};

/** The sentence for a person whose turns get no Claude connectors. */
export function harnessUnavailableKey(reason: Unavailable | undefined): LocaleKey {
  return UNAVAILABLE_KEY[reason ?? "unknown"] ?? UNAVAILABLE_KEY.unknown;
}

/** `provider`: inside Plugins > Manage > Providers, under the Claude
 * accounts, which already carry the title and the Manage link: only the
 * connectors and Check again. */
export function HarnessConnectorsSection({ placement = "panel", onAnswer }: {
  placement?: "panel" | "settings" | "provider";
  /** The answer once it loads: Providers reads which connectors reach mail,
   * calendar, Teams and SharePoint from it (no second request). */
  onAnswer?: (answer: HarnessConnectorsAnswer) => void;
} = {}) {
  const [answer, setAnswer] = useState<HarnessConnectorsAnswer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const next = await api<HarnessConnectorsAnswer>(`/api/me/harness-connectors${refresh ? "?refresh=1" : ""}`, { timeoutMs: 90_000 });
      setAnswer(next);
      onAnswer?.(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [onAnswer]);

  useEffect(() => {
    void load();
  }, [load]);

  const claude = answer?.claude;
  return (
    <section aria-labelledby="harness-connectors-title" data-harness-connectors={placement}
      className={cn(placement === "panel" && "mx-6 mb-3 rounded-xl border border-border bg-inset px-4 py-3 sm:mx-8", placement === "settings" && "rounded-xl border border-hairline/40 px-3.5 py-2.5")}>
      {placement === "provider" ? (
        <div className="flex items-center justify-between gap-3">
          <h4 id="harness-connectors-title" className="text-[12px] font-medium text-ink-secondary">{t("connectApps.providers.connectors")}</h4>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
            className="ui-icon-button disabled:opacity-50"
            title={t("harnessConnectors.refresh")}
            aria-label={t("harnessConnectors.refresh")}
          >
            <RefreshCw size={14} className={cn(loading && "animate-spin")} />
          </button>
        </div>
      ) : (
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="harness-connectors-title" className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            {t("harnessConnectors.title")}
            {placement === "settings" && (
              <HelpTip label={t("settings.moreAbout", { title: t("harnessConnectors.title") })}>
                {t("harnessConnectors.body")}
                {answer && !answer.codex.available && <span className="mt-2 block">{t("harnessConnectors.codex")}</span>}
              </HelpTip>
            )}
          </h3>
          {placement === "settings"
            ? claude?.available && claude.connectors.length > 0 && (
              <p className="mt-0.5 text-[12px] text-ink-secondary">{t(claude.connectors.length === 1 ? "harnessConnectors.countOne" : "harnessConnectors.count", { count: claude.connectors.length })}</p>
            )
            : <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{t("harnessConnectors.body")}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
            className="ui-icon-button disabled:opacity-50"
            title={t("harnessConnectors.refresh")}
            aria-label={t("harnessConnectors.refresh")}
          >
            <RefreshCw size={15} className={cn(loading && "animate-spin")} />
          </button>
          <button
            type="button"
            onClick={() => void openExternalLink(answer?.manageUrl ?? "https://claude.ai/customize/connectors")}
            className="inline-flex items-center gap-1 rounded-full bg-control px-2.5 py-1 text-[11.5px] font-medium text-ink hover:bg-raised-hover"
          >
            <ExternalLink size={12} /> {t("harnessConnectors.manage")}
          </button>
        </div>
      </div>
      )}

      {loading && !answer ? (
        <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-secondary">
          <Loader2 size={13} className="animate-spin" /> {t("harnessConnectors.loading")}
        </div>
      ) : claude && !claude.available ? (
        <p role="status" className="mt-2 text-[12px] text-ink-secondary">{t(harnessUnavailableKey(claude.reason))}</p>
      ) : claude && claude.connectors.length === 0 ? (
        <p className="mt-2 text-[12px] text-ink-secondary">{t("harnessConnectors.empty")}</p>
      ) : claude && placement === "settings" ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-[12px] text-ink-secondary hover:text-ink">{t("harnessConnectors.show")}</summary>
          <ConnectorList connectors={claude.connectors} manageUrl={answer?.manageUrl} />
        </details>
      ) : claude ? (
        <ConnectorList connectors={claude.connectors} manageUrl={answer?.manageUrl} />
      ) : null}

      {answer && !answer.codex.available && placement === "panel" && (
        <p className="mt-2 text-[11.5px] text-ink-tertiary">{t("harnessConnectors.codex")}</p>
      )}

      {error && <div role="alert" className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>}
    </section>
  );
}

function ConnectorList({ connectors, manageUrl }: { connectors: HarnessConnectorsAnswer["claude"]["connectors"]; manageUrl?: string }) {
  return (
        <ul className="mt-2 flex flex-col gap-1.5">
          {connectors.map((connector) => {
            // A connector that needs sign-in or failed is not usable: offer the
            // one-click path to the engine's own page instead of a dead badge.
            const missing = connector.status === "needs_auth" || connector.status === "failed";
            return (
            <li key={connector.name} className="flex items-center justify-between gap-3 rounded-lg bg-elevated px-3 py-2">
              <span className="flex min-w-0 items-center gap-2 text-[13px] text-ink">
                <Plug size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
                <span className="truncate">{connector.name}</span>
                <CapabilityTags capabilities={claudeAiConnectorCapabilities(connector.name)} name={connector.name} />
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    connector.status === "connected" ? "bg-accent/15 text-accent-text"
                      : connector.status === "needs_auth" ? "bg-warning/10 text-warning"
                        : "bg-hover text-ink-secondary",
                  )}
                >
                  {t(STATUS_KEY[connector.status] ?? STATUS_KEY.unknown)}
                </span>
                {missing && manageUrl && <ConnectFromEngine missing manageUrl={manageUrl} />}
              </span>
            </li>
            );
          })}
        </ul>
  );
}
