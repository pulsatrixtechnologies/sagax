// Plugins > Installed > the person's own (#2104, 2026-11-05; once the
// Providers tab): on a solo installation, Claude Code. The person's own MCP
// servers are rows of the Installed list since 2026-11-06 (PersonalServers). The engine accounts' connectors (Claude, Grok, ChatGPT) are
// rows of the Installed list itself since #2306 (InstalledView `accounts`).
// GitHub is not a provider (owner, 2026-10-29): its connection is on the
// GitHub plugin's page (PluginsPanel, `openGithub`).
import type { ReactNode } from "react";

import { t } from "@/lib/i18n";
import { SectionHead } from "./ConnectAppsView";

export interface AccountsViewProps {
  /** Claude Code on this computer (a solo installation): Claude's */
  claudeCode?: ReactNode;
}

export function AccountsView({ claudeCode }: AccountsViewProps) {
  if (!claudeCode) return null;
  return (
    <div data-plugins-accounts>
      {claudeCode && (
        <section className="mt-[30px] first:mt-0" data-plugins-claude-code>
          {/* a group like the others: its heading on the page edge, its one line under it as Discover's group notes are */}
          <SectionHead title={t("connectApps.accounts.claudeCode")} />
          <div className="text-[12px] leading-4 text-ink-secondary [&_p]:!px-0">{claudeCode}</div>
        </section>
      )}
    </div>
  );
}
