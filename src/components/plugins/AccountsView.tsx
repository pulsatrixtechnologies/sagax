// Plugins > Installed > the engine accounts (#2104, 2026-11-05; once the
// Providers tab, then a filtered section with service pills): what the
// person's own engine accounts bring (Claude, Grok, ChatGPT when its
// connectors are listed), then the person's own MCP servers and, on a solo
// installation, Claude Code. One list, no second filter row: the one search
// above finds a connector. GitHub is not a provider (owner, 2026-10-29): its
// connection is on the GitHub plugin's page (PluginsPanel, `openGithub`).
import type { ReactNode } from "react";

import { t } from "@/lib/i18n";
import { HarnessConnectorGroups, type HarnessConnectorGroup, type HarnessEngine } from "./HarnessConnectorGroups";

export interface AccountsViewProps {
  groups: HarnessConnectorGroup[];
  refreshing?: boolean;
  /** the retry of a failed load (the tab row holds the one refresh) */
  onRefresh?: () => void;
  /** the person's own MCP servers (organization server) */
  servers?: ReactNode;
  /** Claude Code on this computer (a solo installation): Claude's */
  claudeCode?: ReactNode;
  /** set an engine up, from a section with no account (Settings > Models and voice) */
  onSetUp?: (engine: HarnessEngine) => void;
}

export function AccountsView({ groups, refreshing, onRefresh, servers, claudeCode, onSetUp }: AccountsViewProps) {
  const empty = groups.length === 0 && !servers && !claudeCode;
  return (
    <div data-plugins-accounts>
      {empty && (
        <div className="rounded-xl bg-inset px-4 py-3 text-[12.5px] text-ink-secondary" data-plugins-empty>{t("connectApps.manage.accountsEmpty")}</div>
      )}
      <HarnessConnectorGroups groups={groups} refreshing={refreshing} onRefresh={onRefresh} onSetUp={onSetUp} />
      {servers && (
        <section className="mt-6 first:mt-0" data-plugins-personal>
          {servers}
        </section>
      )}
      {claudeCode && (
        <section className="mt-6 first:mt-0" data-plugins-claude-code>
          <h3 className="mb-2 text-[13px] font-semibold text-ink">{t("connectApps.accounts.claudeCode")}</h3>
          {claudeCode}
        </section>
      )}
    </div>
  );
}
