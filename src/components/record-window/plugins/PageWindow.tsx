// A BookStack page in the record window (M-20261127-141): the page to read,
// its headings, callouts and code (the chat's Markdown renderer: a callout is
// a GitHub alert), beside the book's contents, the page's facts and tags, and
// its actions (Edit on the web, Ask the bot, Copy the link). Tabs: Page,
// Revisions, Attachments.
//
// The console's sections: `view` (path, body, updated, book, facts, tags,
// edit_url), `revisions`, `attachments` (a file through `download`).
// BookStack serves no page as a record kind today (no `records` in its
// guide): the window waits for the console.
import { ChevronRight, FileText, Link2, SquarePen } from "lucide-react";
import { useOpenRef } from "@/components/RecordCard";
import { RecordMarkdown } from "@/components/RecordMarkdown";
import { RECORD_ACTION, RECORD_PRIMARY, RecordPod } from "@/components/record-window/RecordBlocks";
import { RecordSplit } from "@/components/record-window/RecordSplit";
import { RecordName } from "@/components/record-window/ticket/parts";
import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { parseLines, parsePageView, parseRevision, type PageBookEntry } from "@/lib/record-plugin-views";
import { CardFacts, FactList, PluginFiles, SectionStatus, Steps, tabCount, type PluginContext } from "./PluginParts";
import type { PluginWindowSpec } from "./PluginWindow";

function BookEntry({ entry }: { entry: PageBookEntry }) {
  const open = useOpenRef(entry.ref);
  const inner = (
    <>
      {entry.depth === 0 ? <FileText size={14} aria-hidden="true" className="shrink-0 text-popover-ink-secondary" /> : <span className="w-3.5 shrink-0" aria-hidden="true" />}
      <span dir="auto" className="min-w-0 break-words">{entry.label}</span>
    </>
  );
  const row = cn("flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-start", entry.depth === 1 && "ps-6", entry.current ? "bg-popover-hover text-popover-ink" : "text-popover-ink-secondary");
  return (
    <li aria-current={entry.current ? "page" : undefined} data-record-book-entry={entry.current ? "current" : ""}>
      {open && entry.ref && !entry.current
        ? <button type="button" className={cn(row, "w-full hover:bg-popover-hover hover:text-popover-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus")} onClick={() => open(entry.ref!, entry.label)}>{inner}</button>
        : <span className={row}>{inner}</span>}
    </li>
  );
}

function Page({ ctx }: { ctx: PluginContext }) {
  const { card, detail } = ctx;
  const state = detail.section("view");
  const view = parsePageView(state.data);
  if (!view) return <div className="record-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{state.data || state.refused ? <CardFacts card={card} now={ctx.now} /> : <SectionStatus state={state} />}</div>;
  const link = card.openUrl;
  return (
    <RecordSplit
      type={ctx.type}
      fallback={760}
      least={420}
      rightLeast={320}
      left={
        <div className="p-4">
          <RecordPod className="gap-2" data-record-page="">
            {view.path.length > 0 && (
              <nav aria-label={t("recordWindow.page.path")} className="flex min-w-0 flex-wrap items-center gap-1 text-[13px] leading-[18px]">
                {view.path.map((crumb, index) => (
                  <span key={`${index}-${crumb.label}`} className="inline-flex min-w-0 items-center gap-1">
                    {index > 0 && <ChevronRight size={12} aria-hidden="true" className="text-popover-ink-secondary" />}
                    <RecordName name={crumb.label} recordRef={crumb.ref} />
                  </span>
                ))}
              </nav>
            )}
            <h2 dir="auto" className="text-[24px] font-semibold leading-8">{card.title}</h2>
            {view.updated && <p dir="auto" className="text-[13px] leading-[18px] text-popover-ink-secondary">{view.updated}</p>}
            <RecordMarkdown text={view.body} className="mt-1" />
          </RecordPod>
        </div>
      }
      right={
        <div className="flex min-w-0 flex-col gap-4 p-4">
          {view.book.length > 0 && (
            <RecordPod title={t("recordWindow.page.book")} data-record-book="">
              <ul className="flex min-w-0 flex-col gap-0.5">{view.book.map((entry, index) => <BookEntry key={`${index}-${entry.label}`} entry={entry} />)}</ul>
            </RecordPod>
          )}
          {(view.facts.length > 0 || view.tags.length > 0) && (
            <RecordPod title={t("recordWindow.page.facts")} data-record-page-facts="">
              <FactList facts={view.facts} labelWidth="7rem" />
              {view.tags.length > 0 && (
                <div className="mt-2.5 grid min-w-0 gap-x-4 [grid-template-columns:minmax(0,7rem)_minmax(0,1fr)]">
                  <span className="text-[13px] leading-7 text-popover-ink-secondary">{t("recordWindow.page.tags")}</span>
                  <span className="flex min-w-0 flex-wrap gap-1.5">{view.tags.map((tag) => <span key={tag} className="inline-flex h-7 items-center rounded-full bg-popover-hover px-2.5 text-[13px] leading-[18px]" data-record-tag="">{tag}</span>)}</span>
                </div>
              )}
            </RecordPod>
          )}
          <RecordPod>
            <div className="flex min-w-0 flex-wrap items-center gap-2" data-record-page-actions="">
              {view.editUrl && <button type="button" className={RECORD_PRIMARY} onClick={() => { void openExternalLink(view.editUrl!); }}><SquarePen size={14} aria-hidden="true" />{t("recordWindow.page.edit")}</button>}
              {ctx.compose && <button type="button" className={RECORD_ACTION} onClick={ctx.compose}>{t("recordWindow.page.ask")}</button>}
              {link && <button type="button" className={RECORD_ACTION} onClick={() => { void copyText(link); }}><Link2 size={14} aria-hidden="true" />{t("recordWindow.page.copyLink")}</button>}
            </div>
          </RecordPod>
        </div>
      }
    />
  );
}

function Revisions({ ctx }: { ctx: PluginContext }) {
  const state = ctx.detail.section("revisions");
  if (!state.data) return <SectionStatus state={state} />;
  const steps = parseLines(state.data, parseRevision).map((one) => ({ ...(one.id ? { id: one.id } : {}), text: one.summary || one.when, when: [one.when, one.author].filter(Boolean).join(" · "), tone: "done" as const }));
  return <RecordPod><Steps steps={steps} now={ctx.now} /></RecordPod>;
}

export const PAGE_WINDOW: PluginWindowSpec = {
  first: "page",
  open: ["view"],
  reads: { page: ["view"], revisions: ["revisions"], attachments: ["attachments"] },
  tabs: (ctx) => {
    const { detail } = ctx;
    const revisions = detail.section("revisions");
    const files = detail.section("attachments");
    return [
      { id: "page", label: t("recordWindow.page.page") },
      { id: "revisions", label: t("recordWindow.page.revisions"), count: tabCount(detail, "revisions", revisions.data ? parseLines(revisions.data, parseRevision).length : undefined) },
      { id: "attachments", label: t("recordWindow.tabs.attachments"), count: tabCount(detail, "attachments", files.data ? parseLines(files.data, (line) => line).length : undefined), canAdd: detail.can("attachment.add") },
    ];
  },
  sides: (tab) => tab === "page",
  body: (ctx, tab) => tab === "page" ? <Page ctx={ctx} /> : (
    <div className="flex min-w-0 flex-col gap-4 p-4" data-record-page-tab={tab}>
      {tab === "revisions" && <Revisions ctx={ctx} />}
      {tab === "attachments" && <PluginFiles detail={ctx.detail} />}
    </div>
  ),
};
