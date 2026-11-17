// Mail, calendar, Teams and SharePoint through the engines' own connectors
// (parité R9 + R11, shared/engine-connectors.ts): the service a connector
// reaches, beside its name on its card, and the line on an engine's card in
// Settings > Engines. Read-only: the connectors are managed on claude.ai and
// grok.com. The summary panel per capability ("What your engines reach")
// was removed on 2026-10-27 (owner): each card already names its service and
// sits under its engine.
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { ConnectorCapability } from "../../../shared/engine-connectors";

const CAPABILITY_KEY: Record<ConnectorCapability, LocaleKey> = {
  mail: "connectApps.capabilities.mail",
  calendar: "connectApps.capabilities.calendar",
  teams: "connectApps.capabilities.teams",
  sharepoint: "connectApps.capabilities.sharepoint",
  files: "connectApps.capabilities.files",
};

/** The four Grok Bot shows; files ride along on SharePoint and OneDrive. */
const SHOWN: readonly ConnectorCapability[] = ["mail", "calendar", "teams", "sharepoint"];

/** "Email · Calendar" beside a connector's name; a word the name already
 * says (SharePoint, Microsoft Teams) is not repeated. */
export function CapabilityTags({ capabilities, name = "" }: { capabilities: readonly ConnectorCapability[]; name?: string }) {
  const shown = SHOWN
    .filter((capability) => capabilities.includes(capability))
    .map((capability) => t(CAPABILITY_KEY[capability]))
    .filter((label) => !name.toLowerCase().includes(label.toLowerCase()));
  if (!shown.length) return null;
  return (
    <span data-connector-capabilities className="truncate text-[12px] text-ink-tertiary">
      {shown.join(" · ")}
    </span>
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
