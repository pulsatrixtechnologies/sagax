// Connect apps > Sources (2026-10-27): where plugins come from, the
// marketplaces only (2026-10-28).
//
//   - GitHub connection (2026-10-29): one row that opens the GitHub
//     plugin's page, where the person's GitHub account and the other
//     credentials are. A link, not a second copy: it keeps the connection
//     in reach when the GitHub plugin is neither installed nor listed.
//   - Marketplaces: add, list, fetch again, remove, and who sees each one.
//     A private one reads with the person's GitHub account by default; a
//     row picks another credential in a small selector only when one
//     exists. The account and those credentials are on the GitHub
//     plugin's page.
//   - Organization (admins only, the same right as before): allowed
//     marketplaces.
//
// A part with nothing to show is left out.
import type { ReactNode } from "react";
import { GitBranch } from "lucide-react";

import { t } from "@/lib/i18n";

export interface SourcesViewProps {
  /** the GitHub plugin's page, where the GitHub connection is */
  onOpenGithub?: () => void;
  /** the GitHub row's account line (connected as, or not) */
  githubSummary?: ReactNode;
  marketplaces?: ReactNode;
  /** the organization's allowed marketplaces, for an organization admin */
  organization?: ReactNode;
}

export function SourcesView({ onOpenGithub, githubSummary, marketplaces, organization }: SourcesViewProps) {
  return (
    <div data-plugins-sources>
      {onOpenGithub && (
        <section className="mb-6" data-plugins-sources-github>
          <div className="flex items-center gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center"><GitBranch size={16} aria-hidden="true" className="text-ink" /></span>
            <h3 className="min-w-0 truncate text-[13px] font-semibold text-ink">{t("connectApps.sources.githubConnection")}</h3>
            {githubSummary && <span className="min-w-0 truncate text-[11.5px] text-ink-secondary" data-github-summary>{githubSummary}</span>}
            <span className="flex-1" />
            <button
              type="button"
              data-plugins-sources-github-open
              onClick={onOpenGithub}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-control px-2.5 py-1 text-[11.5px] font-medium text-ink hover:bg-raised-hover"
            >
              {t("connectApps.detail.openGithub")}
            </button>
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-tertiary">{t("sources.github.intro")}</p>
        </section>
      )}
      {marketplaces}
      {organization && (
        <section className="mt-8 rounded-[14px] border-[0.5px] border-ink/10 bg-ink/[0.015] px-4 py-4 sm:px-5" data-plugins-sources-admin>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold text-ink">{t("connectApps.orgAccess.title")}</h3>
            <span className="rounded-full bg-hover px-2 py-0.5 text-[11px] text-ink-secondary">{t("connectApps.sources.adminsOnly")}</span>
          </div>
          {organization}
        </section>
      )}
    </div>
  );
}
