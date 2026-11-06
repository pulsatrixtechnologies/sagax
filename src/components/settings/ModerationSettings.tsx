// Settings > Notifications > Privacy (App Store 1.2, src/lib/moderation.ts):
// - Blocked people: the person's own list, folded under one Manage row.
// - Reports (organization admins / solo owner): every report people sent,
//   folded under one View row. The row hides itself when the viewer is not
//   an admin so NotificationSettings stays free of an adminGate (#2080).
import { useCallback, useEffect, useState } from "react";
import { activeLocale, t } from "@/lib/i18n";
import { fetchReports, onReportsChanged, resolveReport, unblockPerson, useBlockedPeople, type ModerationReport } from "@/lib/moderation";
import { CompactRow, DescribedRow, PILL } from "../SettingsPrimitives";
import { DisclosurePill } from "./AppearanceSettings";
import { readableError } from "@/lib/plain-error";
import { useStoreSelector } from "@/state/store-selector";
import { viewerIsOrgAdmin } from "@/lib/group-owner";

function formatDate(at: number): string {
  return new Date(at).toLocaleString(activeLocale(), { dateStyle: "medium", timeStyle: "short" });
}

function BlockedPeopleList({ onError }: { onError: (message: string | null) => void }) {
  const people = useBlockedPeople();
  if (people.length === 0) {
    return <p className="px-0.5 pt-1 text-[12.5px] leading-[18px] text-ink-secondary">{t("moderation.blocked.none")}</p>;
  }
  return (
    <div className="mt-1 flex flex-col" data-blocked-list="">
      {people.map((person) => (
        <CompactRow key={person.id} label={person.name || t("moderation.blocked.someone")} rowId={`blocked-${person.id}`}>
          <button
            type="button"
            className={PILL}
            data-unblock=""
            onClick={() => { onError(null); void unblockPerson(person.id).catch((failure: unknown) => onError(readableError(failure))); }}
          >
            {t("moderation.unblock.short")}
          </button>
        </CompactRow>
      ))}
      <p className="px-0.5 pb-1 text-[12.5px] leading-[18px] text-ink-secondary">{t("moderation.blocked.help")}</p>
    </div>
  );
}

/** One Privacy row: summary in grey, Manage unfolds the list. */
export function BlockedPeopleRow() {
  const people = useBlockedPeople();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summary = people.length === 0
    ? t("settings.blockedPeople.none")
    : t("settings.blockedPeople.summary", { count: people.length });
  return (
    <DescribedRow
      label={t("moderation.blocked.title")}
      description={summary}
      rowId="blockedPeople"
      below={open ? (
        <div className="mt-2">
          <BlockedPeopleList onError={setError} />
          {error && <p role="alert" className="px-0.5 pb-1 text-[12.5px] text-danger">{error}</p>}
        </div>
      ) : undefined}
    >
      <DisclosurePill open={open} onToggle={() => setOpen((value) => !value)} label={t("moderation.blocked.title")}>
        {open ? t("settings.appearance.hide") : t("settings.blockedPeople.manage")}
      </DisclosurePill>
    </DescribedRow>
  );
}

/** @deprecated Prefer BlockedPeopleRow. Kept for gallery imports that still call the group. */
export function BlockedPeopleSettings() {
  return (
    <div data-settings-group="blockedPeople">
      <BlockedPeopleRow />
    </div>
  );
}

function ReportsList({
  reports,
  openReports,
  handled,
  onResolve,
  error,
}: {
  reports: ModerationReport[] | null;
  openReports: ModerationReport[];
  handled: ModerationReport[];
  onResolve: (id: string) => void;
  error: string | null;
}) {
  if (!reports) return null;
  if (openReports.length === 0 && handled.length === 0) {
    return <p className="px-0.5 pt-1 text-[12.5px] leading-[18px] text-ink-secondary">{t("moderation.reports.none")}</p>;
  }
  return (
    <div className="mt-1 flex flex-col gap-1" data-reports-list="">
      {[...openReports, ...handled].map((report) => (
        <div key={report.id} data-report-row={report.status} className="flex flex-col gap-1 py-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 text-[13px] leading-[18px] text-ink">
              {t("moderation.reports.line", {
                reporter: report.reporterName || t("moderation.blocked.someone"),
                reported: report.reportedName || t("moderation.blocked.someone"),
                reason: t(`moderation.reason.${report.reason}`),
              })}
              <div className="text-[12px] text-ink-secondary">
                {report.peopleDm ? t("moderation.reports.inDm") : report.groupName ? t("moderation.reports.inRoom", { room: report.groupName }) : null}
                {" · "}{formatDate(report.at)}
              </div>
            </div>
            {report.status === "open" ? (
              <button
                type="button"
                className={PILL}
                data-resolve-report=""
                onClick={() => onResolve(report.id)}
              >
                {t("moderation.reports.resolve")}
              </button>
            ) : (
              <span className="shrink-0 text-[12px] text-ink-secondary">{t("moderation.reports.handled")}</span>
            )}
          </div>
          {report.excerpt && <blockquote className="whitespace-pre-wrap border-l-2 border-hairline pl-2 text-[12.5px] leading-[18px] text-ink-secondary">{report.excerpt}</blockquote>}
          {report.note && <div className="text-[12.5px] leading-[18px] text-ink-secondary">{t("moderation.reports.note", { note: report.note })}</div>}
        </div>
      ))}
      {error && <p role="alert" className="px-0.5 pb-1 text-[12.5px] text-danger">{error}</p>}
    </div>
  );
}

/** One Privacy row for admins: open-count summary, View unfolds the list. */
export function ReportsRow() {
  const admin = useStoreSelector((current) => viewerIsOrgAdmin(current.config));
  const [open, setOpen] = useState(false);
  const [reports, setReports] = useState<ModerationReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetchReports().then((list) => { setReports(list); setError(null); }, (failure: unknown) => setError(readableError(failure)));
  }, []);
  useEffect(() => {
    if (!admin) return;
    load();
    return onReportsChanged(load);
  }, [admin, load]);
  if (!admin) return null;
  const openReports = (reports ?? []).filter((report) => report.status === "open");
  const handled = (reports ?? []).filter((report) => report.status === "resolved").slice(0, 20);
  const summary = reports == null
    ? ""
    : openReports.length === 0
      ? t("settings.reports.none")
      : t("settings.reports.summary", { count: openReports.length });
  return (
    <div data-settings-card="notifications.reports">
      <DescribedRow
        label={t("moderation.reports.title")}
        description={summary || undefined}
        rowId="reports"
        below={open ? (
          <div className="mt-2">
            <ReportsList
              reports={reports}
              openReports={openReports}
              handled={handled}
              error={error}
              onResolve={(id) => void resolveReport(id).then(load, (failure: unknown) => setError(readableError(failure)))}
            />
          </div>
        ) : undefined}
      >
        <DisclosurePill open={open} onToggle={() => setOpen((value) => !value)} label={t("moderation.reports.title")}>
          {open ? t("settings.appearance.hide") : t("settings.reports.view")}
        </DisclosurePill>
      </DescribedRow>
    </div>
  );
}

/** @deprecated Prefer ReportsRow. Kept for gallery imports that still call the group. */
export function ReportsSettings() {
  return <ReportsRow />;
}
