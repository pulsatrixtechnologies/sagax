// Settings > Providers > Advanced (#4408): the connectors of the person's
// own provider accounts, one section per provider whose account carries
// them, each drawn the same way: "Provided by <provider> (your account)",
// the count, each connector with its state, Check again and the provider's
// own place to manage them. Fed by the one providers list of
// GET /api/me/harness-connectors (shared/account-connectors.ts), the list
// Connect Apps builds its groups from too. A provider the person never
// signed in to shows its one first step here (the same Connect as its
// engine's), since its row waits under Add a provider, off this page; one
// whose sign-in expired draws nothing: its row on this same page already
// offers Sign in again, so the step shows once.
// This is the one place a screen draws these sections: Connect Apps lists the
// same connectors as plugin rows of its own grid (plugins/HarnessConnectorGroups.tsx),
// on its own screen, never beside this one.
// Read-only here: people add, sign in to and remove them on the provider's site.
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { openExternalLink } from "@/lib/app-links";
import { DescribedRow, FoldRow, PILL, SettingsGroup } from "./SettingsPrimitives";
import { StatusText } from "./settings/SettingsPatterns";
import { ConnectFromEngine } from "./ConnectFromEngine";
import { CapabilityTags } from "./plugins/EngineCapabilities";
import {
  ACCOUNT_CONNECTOR_PROVIDERS, accountConnectorCapabilities, accountConnectorProviders,
  type AccountConnector, type AccountConnectorProvider, type AccountConnectorStatus, type AccountConnectorsUnavailable,
} from "../../shared/account-connectors";
import { vendorLabel } from "../../shared/model-provider";
import { reloadMyEngines, useMyEngines, type MyEngine } from "@/lib/perspicax-org";
import { EngineConnect } from "./EngineConnect";
import { readableError } from "@/lib/plain-error";

/** GET /api/me/harness-connectors: `providers` (#4408), and the older
 * fields a released app still reads. */
export interface HarnessConnectorsAnswer {
  manageUrl: string;
  canManage: boolean;
  enabled: boolean;
  claude: { available: boolean; reason?: AccountConnectorsUnavailable; connectors: Array<{ name: string; status: AccountConnectorStatus }> };
  codex: { available: boolean; reason?: string; connectors?: AccountConnector[] };
  grok?: { accounts: Array<{ auth: "subscription" | "key" | "none" | "unknown"; connectors: AccountConnector[] }> };
  providers?: AccountConnectorProvider[];
}

const STATUS_KEY: Record<AccountConnectorStatus, LocaleKey> = {
  connected: "harnessConnectors.status.connected",
  needs_auth: "harnessConnectors.status.needsAuth",
  failed: "harnessConnectors.status.failed",
  unknown: "harnessConnectors.status.unknown",
};

/** The engine instance each provider's own sign-in runs on by default. */
const DEFAULT_INSTANCE: Readonly<Record<string, string>> = { claudeAgent: "claude", codex: "codex", grokAgent: "grok" };

/** #1533: the person's own engine of a driver on an organization server, the
 * one its Connect signs in to (the default instance first). */
export function myEngineFor(engines: readonly MyEngine[] | null | undefined, driver: string): MyEngine | undefined {
  const mine = (engines ?? []).filter((engine) => engine.driver === driver && engine.subscription.supported);
  return mine.find((engine) => engine.instanceId === DEFAULT_INSTANCE[driver]) ?? mine[0];
}

export function myClaudeEngine(engines: readonly MyEngine[] | null | undefined): MyEngine | undefined {
  return myEngineFor(engines, "claudeAgent");
}

/** One provider's section: its connectors, that its read did not answer
 * (Check again), or its one first step (Connect). */
export interface AccountSection {
  entry: AccountConnectorProvider;
  /** the provider's name as the Providers page names it */
  name: string;
  kind: "list" | "unknown" | "signIn";
  /** signIn: the person's own engine its Connect signs in to */
  engine?: MyEngine;
}

/** The sections to draw: a provider whose account carries connectors, a
 * read that did not answer on a live sign-in, and a provider the person
 * never signed in to on an engine of their own (its one first step: its row
 * is not on the page, it waits under Add a provider). A provider with no
 * account connectors (none added, a key, no engine, someone else's sign-in)
 * draws nothing, and so does one whose sign-in expired or that is signed in:
 * the provider's row on the page already says so, once. */
export function accountSections(answer: HarnessConnectorsAnswer | null, engines: readonly MyEngine[] | null | undefined): AccountSection[] {
  const out: AccountSection[] = [];
  for (const entry of accountConnectorProviders(answer)) {
    const driver = ACCOUNT_CONNECTOR_PROVIDERS.find((known) => known.provider === entry.provider)?.driver ?? "";
    const engine = myEngineFor(engines, driver);
    // an expired sign-in the provider no longer answers on: the row says so
    const expired = Boolean(engine?.subscription.signedIn && engine.subscription.expired);
    const name = vendorLabel(entry.vendor);
    const connectors = entry.connectors.filter((connector) => connector.name.trim() !== "");
    if (entry.available && connectors.length) out.push({ name, entry: { ...entry, connectors }, kind: "list" });
    else if (!entry.available && entry.reason === "unknown" && !expired) out.push({ name, entry, kind: "unknown" });
    else if (!entry.available && entry.reason === "not_signed_in" && engine && !engine.subscription.signedIn) out.push({ name, entry, kind: "signIn", engine });
  }
  return out;
}

/** The provider's place, as people know it ("claude.ai", "chatgpt.com"). */
function placeOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

export function HarnessConnectorsSection() {
  const [answer, setAnswer] = useState<HarnessConnectorsAnswer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      setAnswer(await api<HarnessConnectorsAnswer>(`/api/me/harness-connectors${refresh ? "?refresh=1" : ""}`, { timeoutMs: 90_000 }));
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // #1533: a sign-in or sign-out of one of the person's own engines (here or
  // on the provider's page) reads the connectors again: no stale first step.
  const myEngines = useMyEngines();
  const signInState = ACCOUNT_CONNECTOR_PROVIDERS.map(({ driver }) => {
    const engine = myEngineFor(myEngines, driver);
    return engine ? `${driver}:${engine.subscription.signedIn}:${Boolean(engine.subscription.expired)}` : "";
  }).join("|");
  const seenState = useRef<string | null>(null);
  useEffect(() => {
    if (!myEngines) return;
    const before = seenState.current;
    seenState.current = signInState;
    if (before !== null && before !== signInState) void load(true);
  }, [signInState, myEngines, load]);

  const sections = accountSections(answer, myEngines);
  const refresh = () => void load(true);
  if (!answer) {
    if (!loading && !error) return null;
    return (
      <div data-harness-connectors="settings">
        <SettingsGroup groupId="providers-account-connectors">
          {loading
            ? <DescribedRow label={t("harnessConnectors.accountsTitle")} rowId="providers.accountConnectors"
                description={<span className="inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" aria-hidden="true" />{t("harnessConnectors.loadingAccounts")}</span>} />
            : <DescribedRow label={t("harnessConnectors.accountsTitle")} rowId="providers.accountConnectors"
                description={<span role="alert" className="text-danger">{error}</span>}>
                <RefreshButton loading={loading} onRefresh={refresh} />
              </DescribedRow>}
        </SettingsGroup>
      </div>
    );
  }
  if (!sections.length && !error) return null;
  return (
    <div data-harness-connectors="settings" className="flex flex-col gap-6">
      {sections.map((section) => <AccountConnectorsGroup key={section.entry.provider} section={section} loading={loading} onRefresh={refresh} />)}
      {error && <p role="alert" className="px-3.5 text-[12px] text-danger">{error}</p>}
    </div>
  );
}

function RefreshButton({ loading, onRefresh }: { loading: boolean; onRefresh: () => void }) {
  return (
    <button type="button" onClick={onRefresh} disabled={loading} className="ui-icon-button disabled:opacity-50"
      title={t("harnessConnectors.refresh")} aria-label={t("harnessConnectors.refresh")}>
      <RefreshCw size={14} className={cn(loading && "animate-spin")} />
    </button>
  );
}

/** One provider's section (#2295, #4408): rows of its own group, never a
 * card in a card. One row names the account, counts the connectors and holds
 * Check again and Manage on the provider's site; its count pill opens the
 * list (same rows as the providers above). The longer explanation sits
 * behind the info button. */
function AccountConnectorsGroup({ section, loading, onRefresh }: { section: AccountSection; loading: boolean; onRefresh: () => void }) {
  const { entry, name, kind, engine } = section;
  const title = t("harnessConnectors.providedBy", { provider: name });
  const help = t("harnessConnectors.help", { provider: name });
  if (kind === "signIn" && engine) {
    // the one first step: the same Connect as the engine's own, nothing else
    // (no Check again, no Manage: neither helps before a sign-in)
    return (
      <div data-account-connectors={entry.provider} data-harness-connectors-unavailable="not_signed_in">
        <SettingsGroup groupId={`providers-${entry.vendor}-connectors`}>
          <DescribedRow label={title} help={help} rowId={`providers.connectors.${entry.vendor}`}
            description={<span role="status">{t("connectApps.accounts.notice.notSignedIn", { provider: name })}</span>}
            below={<EngineConnect engine={engine} issuer="" onChanged={reloadMyEngines} statusLine={false} disconnect={false} keysManaged className="mt-2" />} />
        </SettingsGroup>
      </div>
    );
  }
  const controls = (
    <>
      <RefreshButton loading={loading} onRefresh={onRefresh} />
      <button type="button" data-harness-connectors-manage={entry.provider} className={cn(PILL, "inline-flex items-center gap-1.5")}
        onClick={() => void openExternalLink(entry.manageUrl)}>
        {t("connectApps.providers.manage", { provider: placeOf(entry.manageUrl) })}
        <ExternalLink size={12} aria-hidden="true" className="shrink-0 text-ink-secondary" />
      </button>
    </>
  );
  const description = kind === "list"
    ? t(entry.connectors.length === 1 ? "harnessConnectors.countOne" : "harnessConnectors.count", { count: entry.connectors.length })
    : <span role="status">{t("connectApps.accounts.notice.unknown", { provider: name })}</span>;
  return (
    <div data-account-connectors={entry.provider} data-harness-connectors-unavailable={kind === "list" ? undefined : "unknown"}>
      <SettingsGroup groupId={`providers-${entry.vendor}-connectors`}>
        {kind === "list" ? (
          <FoldRow cardId={`providers.advanced.connectors.${entry.vendor}`} label={title} description={description} help={help}
            count={entry.connectors.length} toggleLabel={t("harnessConnectors.show")} controls={controls}>
            <ul className="flex flex-col" data-harness-connector-list="">
              {entry.connectors.map((connector) => <ConnectorRow key={connector.id ?? connector.name} provider={entry.provider} connector={connector} manageUrl={entry.manageUrl} />)}
            </ul>
          </FoldRow>
        ) : (
          <DescribedRow label={title} description={description} help={help} rowId={`providers.connectors.${entry.vendor}`}>
            {controls}
          </DescribedRow>
        )}
      </SettingsGroup>
    </div>
  );
}

/** One connector as a plain row of the list (no surface of its own). */
function ConnectorRow({ provider, connector, manageUrl }: { provider: AccountConnectorProvider["provider"]; connector: AccountConnector; manageUrl: string }) {
  const missing = connector.status === "needs_auth" || connector.status === "failed";
  return (
    <li className="flex min-h-[36px] min-w-0 items-center justify-between gap-3 py-1" data-harness-connector={connector.name}>
      <span className="flex min-w-0 items-center gap-2 text-[13px] text-ink">
        <span className="truncate">{connector.name}</span>
        <CapabilityTags capabilities={accountConnectorCapabilities(provider, connector)} name={connector.name} />
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <StatusText tone={connector.status === "connected" ? "success" : connector.status === "needs_auth" ? "warning" : "neutral"}>
          {t(STATUS_KEY[connector.status] ?? STATUS_KEY.unknown)}
        </StatusText>
        {missing && <ConnectFromEngine missing manageUrl={manageUrl} />}
      </span>
    </li>
  );
}
