// Mail, calendar, Teams and SharePoint through the engines' own connectors
// (parité R9 + R11, shared/engine-connectors.ts): which engine and which
// connector reach each one, and that every send or write asks first on its
// card. Read-only: the connectors are managed on claude.ai and grok.com.
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { capabilityRoutes, type ConnectorCapability, type EngineConnectorOffer } from "../../../shared/engine-connectors";

const CAPABILITY_KEY: Record<ConnectorCapability, LocaleKey> = {
  mail: "connectApps.capabilities.mail",
  calendar: "connectApps.capabilities.calendar",
  teams: "connectApps.capabilities.teams",
  sharepoint: "connectApps.capabilities.sharepoint",
  files: "connectApps.capabilities.files",
};

/** The four Grok Bot shows; files ride along on SharePoint and OneDrive. */
const SHOWN: readonly ConnectorCapability[] = ["mail", "calendar", "teams", "sharepoint"];

const ENGINE_NAME = { claude: "Claude", grok: "Grok" } as const;

/** "Email · Calendar" beside a connector's name; a word the name already
 * says (SharePoint, Microsoft Teams) is not repeated. */
export function CapabilityTags({ capabilities, name = "" }: { capabilities: readonly ConnectorCapability[]; name?: string }) {
  const shown = SHOWN
    .filter((capability) => capabilities.includes(capability))
    .map((capability) => t(CAPABILITY_KEY[capability]))
    .filter((label) => !name.toLowerCase().includes(label.toLowerCase()));
  if (!shown.length) return null;
  return (
    <span data-connector-capabilities className="truncate text-[11.5px] text-ink-tertiary">
      {shown.join(" · ")}
    </span>
  );
}

/** Per capability, the engines and connectors that reach it. */
export function EngineCapabilities({ offers }: { offers: readonly EngineConnectorOffer[] }) {
  const routes = capabilityRoutes(offers);
  const hasGrok = offers.some((offer) => offer.engine === "grok");
  return (
    <section data-engine-capabilities aria-labelledby="engine-capabilities-title" className="rounded-2xl border border-border bg-card px-4 py-3.5 sm:px-5">
      <h3 id="engine-capabilities-title" className="text-[13.5px] font-semibold text-ink">{t("connectApps.capabilities.title")}</h3>
      <dl className="mt-2 space-y-1.5">
        {SHOWN.map((capability) => {
          const list = routes[capability];
          return (
            <div key={capability} data-capability={capability} className="flex items-baseline justify-between gap-3 text-[12.5px]">
              <dt className="shrink-0 text-ink">{t(CAPABILITY_KEY[capability])}</dt>
              <dd className="min-w-0 text-right leading-snug text-ink-secondary">
                {list.length ? list.map((route) => `${ENGINE_NAME[route.engine]} · ${route.connector}`).join(", ") : t("connectApps.capabilities.none")}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-secondary">{t("connectApps.capabilities.approval")}</p>
      {hasGrok && <p className="mt-1 text-[11.5px] text-ink-tertiary">{t("connectApps.capabilities.grokOrg")}</p>}
    </section>
  );
}

/** The line on an engine's card in Settings > Engines: what its own
 * connectors reach, or nothing for an engine that brings none. */
export function EngineConnectorsLine({ driverKind }: { driverKind: string }) {
  const key: LocaleKey | null = driverKind === "claudeAgent" ? "engines.connectors.claude"
    : driverKind === "grokAgent" || driverKind === "grok" ? "engines.connectors.grok"
      : null;
  if (!key) return null;
  return <p data-engine-connectors={driverKind} className="mt-3 text-[12px] leading-relaxed text-ink-secondary">{t(key)}</p>;
}
