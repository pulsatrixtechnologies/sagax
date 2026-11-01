// Details > Coding and Details > Activity, from one list (GET
// /api/bots/:id/activity, narrowed by the server to what this person may
// read: on an organization server their own threads only).
//
// Coding is code work only: the agents this bot launched that did code work
// (launchedAgents' `coding`; the others, a dispatch run or bot-to-bot work,
// are listed under Activity), running coding jobs (the server's `coding`:
// edits to source files, version control, pull requests, file changes inside
// a repository; never a title) with their repository and branch, then the
// pull requests, branches and commits the bot's coding jobs of the window
// produced (the server's `code`, read off their own git, gh and GitHub
// calls), each opening in the browser, in the Routines card
// (src/lib/grouped-card.ts); a branch also has its actions
// (CodeBranchList: commit, push, pull request, diff, archive, delete). Activity is parallel work only
// (isParallelWork): routine runs, work handed over, the sub-agents this bot's
// threads started, parallel tasks and jobs the bot opened on itself; never a
// conversation's own turn, which is the chat. A running entry has a spinner,
// elapsed time, current step and Stop where the viewer may. When it finishes
// it reads "Finished" for FINISHED_LINGER_MS, fades out and leaves
// (LiveActivity). Activity is drawn first, as "Ongoing activities", above
// Coding (the All history row shows only when neither is drawn); it replaces the separate rail that used to
// open beside the chat. A section with nothing to show is not drawn, title
// included. The section title opens ActivityListModal, the history (newest
// first, by status, searchable, each entry's detail beside the list), and a
// card opens ActivityDetailModal. The
// list refetches when the bot's threads change (the store's event stream)
// and polls while work runs.
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, History, GitCommitHorizontal, GitMerge, GitPullRequest, GitPullRequestClosed, SquareTerminal } from "lucide-react";

import { api, openRoutineRun, type Bot } from "@/state/store";
import { useStoreDispatch, useStoreGetter } from "@/state/store-selector";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { openExternalLink } from "@/lib/app-links";
import { useShowAllHistory, watchBotHistoryRequests } from "@/lib/panel-visibility";
import { useAdvancedMode } from "@/lib/interface-mode";
import {
  activityLive,
  codeWorkWhen,
  codingLive,
  codingWhere,
  codingWork,
  codingWorkEmpty,
  pullActionLabel,
  type BotCodePullRequest,
  type CodingWork,
  type LiveView,
  loadBotActivityDetail,
  type BotActivityFilter,
  type BotActivityItem,
  type BotActivityList,
  type BotLaunchedAgentItem,
} from "@/lib/bot-activity";
import { LaunchedAgentsList } from "./LaunchedAgentsList";
import { ActivityDetailModal } from "./ActivityDetailModal";
import { ActivityListModal } from "./ActivityListModal";
import { ActivityList, type CardActions } from "./ActivityList";
import { useBotActivityFeed } from "@/lib/use-bot-activity-feed";
import { GROUPED_CARD, GROUPED_ROW } from "@/lib/grouped-card";
import { loadArchivedBranches, setBranchArchived } from "@/lib/code-branches";
import { CodeBranchList, type BranchListActions } from "./CodeBranchList";

export { ActivityList, type CardActions };

/** One row of code work: an icon, a line, a quieter line; with a web page
 * it opens in the system browser. */
function CodeRow({ kind, icon, title, subtitle, url, name }: { kind: string; icon: React.ReactNode; title: string; subtitle: string; url?: string; name: string }) {
  const body = (
    <>
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-[18px] text-ink">{title}</span>
        <span className="block truncate text-[12px] leading-[17px] text-ink-secondary">{subtitle}</span>
      </span>
    </>
  );
  const row = "flex w-full min-w-0 items-center gap-3 text-left";
  return (
    <li data-code-row={kind} className={cn("hover:bg-hover", GROUPED_ROW)}>
      {url ? (
        <button
          type="button"
          data-code-link={url}
          onClick={() => void openExternalLink(url)}
          aria-label={t("botPanel.code.openAria", { name })}
          title={url}
          className={cn(row, "rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60")}
        >
          {body}
        </button>
      ) : <div className={row}>{body}</div>}
    </li>
  );
}

function pullIcon(pull: BotCodePullRequest) {
  const common = { size: 16, strokeWidth: 1.9, "aria-hidden": true as const };
  if (pull.action === "merged") return <GitMerge {...common} className="shrink-0 text-accent-text" />;
  if (pull.action === "closed") return <GitPullRequestClosed {...common} className="shrink-0 text-danger" />;
  return <GitPullRequest {...common} className="shrink-0 text-success" />;
}

function pullTitle(pull: BotCodePullRequest): string {
  if (pull.title && pull.number !== undefined) return `#${pull.number} ${pull.title}`;
  if (pull.title) return pull.title;
  return pull.number !== undefined ? t("botPanel.code.pr.numbered", { number: pull.number }) : t("botPanel.code.pr.new");
}

/** A group of code work: its grey label, then one grouped card like
 * Routines' (src/lib/grouped-card.ts). */
function CodeGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="px-1 text-[12px] leading-[17px] text-ink-tertiary">{label}</h3>
      {children}
    </div>
  );
}

function CodeCard({ label, children }: { label: string; children: React.ReactNode }) {
  return <ul className={GROUPED_CARD} aria-label={label}>{children}</ul>;
}

/** The Coding section's code work: pull requests, branches, commits. Each
 * group shows only when it has rows. Split out so it renders without the
 * fetching around it. */
export function CodeWorkList({ work, now, branchActions }: { work: CodingWork; now: number; branchActions?: BranchListActions }) {
  if (codingWorkEmpty(work)) return null;
  const common = { size: 16, strokeWidth: 1.9, "aria-hidden": true as const, className: "shrink-0 text-ink-secondary" };
  const line = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(" · ");
  return (
    <div data-code-work className="flex flex-col gap-2">
      {work.pullRequests.length > 0 && (
        <CodeGroup label={t("botPanel.code.pullRequests")}>
          <CodeCard label={t("botPanel.code.pullRequests")}>
          {work.pullRequests.map((pull) => (
            <CodeRow
              key={pull.url ?? `${pull.repo}#${pull.number}:${pull.at}`}
              kind="pull"
              icon={pullIcon(pull)}
              title={pullTitle(pull)}
              subtitle={line(pull.repo, pullActionLabel(pull.action), codeWorkWhen(pull.at, now))}
              url={pull.url}
              name={pullTitle(pull)}
            />
          ))}
          </CodeCard>
        </CodeGroup>
      )}
      {(work.branches.length > 0 || (branchActions && (work.archivedBranches?.length ?? 0) > 0)) && (
        <CodeGroup label={t("botPanel.code.branches")}>
          <CodeBranchList
            branches={work.branches}
            archivedBranches={branchActions ? work.archivedBranches : undefined}
            now={now}
            actions={branchActions}
            label={t("botPanel.code.branches")}
          />
        </CodeGroup>
      )}
      {work.commits.length > 0 && (
        <CodeGroup label={t("botPanel.code.commits")}>
          <CodeCard label={t("botPanel.code.commits")}>
          {work.commits.map((commit) => (
            <CodeRow
              key={commit.sha}
              kind="commit"
              icon={<GitCommitHorizontal {...common} />}
              title={commit.message ?? commit.sha.slice(0, 7)}
              subtitle={line(commit.sha.slice(0, 7), commit.branch, t(commit.pushed ? "botPanel.code.pushed" : "botPanel.code.notPushed"), codeWorkWhen(commit.at, now))}
              url={commit.url}
              name={commit.sha.slice(0, 7)}
            />
          ))}
          </CodeCard>
        </CodeGroup>
      )}
    </div>
  );
}

/** What Details shows for Coding and Activity, given the loaded list:
 * each section's entries, and whether it is drawn at all. Nothing loaded
 * yet (or a failed first load) draws neither. */
export function panelSections(list: BotActivityList | null, live?: LiveView, advanced = true, archived?: ReadonlySet<string>) {
  const coding = list ? codingLive(list.items, live) : [];
  // The pull requests, branches and commits are for Advanced mode only.
  const work: CodingWork = list && advanced ? codingWork(list.items, archived) : { pullRequests: [], branches: [], commits: [] };
  // Launched agents split by their work: code under Coding, the rest (a
  // dispatch run, bot-to-bot work) under Activity.
  const launchedAll = list?.launchedAgents ?? [];
  const launched = launchedAll.filter((item) => item.coding === true);
  const launchedOther = launchedAll.filter((item) => item.coding !== true);
  const other = list ? activityLive(list.items, list.subagents, live) : [];
  return {
    coding,
    work,
    launched,
    launchedOther,
    other,
    showCoding: coding.length > 0 || launched.length > 0 || !codingWorkEmpty(work),
    showActivity: other.length > 0 || launchedOther.length > 0,
  };
}

/** A section header; its title opens the section's history. */
export function SectionHeader({ icon, title, name, onOpenHistory }: { icon: React.ReactNode; title: string; name: BotActivityFilter | "all"; onOpenHistory: (filter: BotActivityFilter) => void }) {
  return (
    <h2 className="flex">
      <button
        type="button"
        data-activity-history={name}
        onClick={() => onOpenHistory(name === "all" ? "coding" : name)}
        aria-haspopup="dialog"
        title={t("botPanel.history.open")}
        className="group -mx-1 flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left text-[13px] font-normal leading-[18px] text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        {icon}
        <span className="truncate">{title}</span>
        <ChevronRight size={13} aria-hidden="true" className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      </button>
    </h2>
  );
}

/** Details' activity block, top down: Ongoing activities (parallel work
 * running or just finished), then Coding. Each section is drawn only when it
 * has something to show, title included, and its title opens the history.
 * When neither is drawn (once the list loaded), one quiet "All history" row
 * keeps the history one click away. A first load that failed
 * is one quiet line; a later failed refresh keeps the last list. Split out so
 * it renders without the fetching. */
export function PanelSections({ list, live, actions, onOpenHistory, onOpenLaunched, error = false, advanced = true, archived, branchActions, showAllHistory = true }: {
  list: BotActivityList | null;
  live?: LiveView;
  actions: CardActions;
  onOpenHistory: (filter: BotActivityFilter) => void;
  onOpenLaunched?: (item: BotLaunchedAgentItem) => void;
  /** The newest list fetch failed. */
  error?: boolean;
  /** Advanced mode: the Git links (pull requests, branches, commits) show. */
  advanced?: boolean;
  /** The branches this person archived (codingBranchKey). */
  archived?: ReadonlySet<string>;
  /** The branches' menus (commit, push, ...); without it they have none. */
  branchActions?: BranchListActions;
  /** The quiet "All history" row (Settings > Appearance; hidden by default in the panel). */
  showAllHistory?: boolean;
}) {
  const { coding, work, launched, showCoding } = panelSections(list, live, advanced, archived);
  if (list === null) {
    return error ? <p role="status" data-activity-error className="px-0.5 text-[12.5px] text-ink-tertiary">{t("botPanel.coding.error")}</p> : null;
  }
  return (
    <>
      {/* Work other bots do for this one is not shown here: it is seen in the
          chat (the bot-to-bot conversation card), 2026-10-19. */}
      {showCoding && (
        <section data-bot-settings-section="coding" className="flex flex-col gap-2">
          <SectionHeader
            icon={<SquareTerminal size={16} aria-hidden="true" className="text-ink-secondary" />}
            title={t("botPanel.coding.title")}
            name="coding"
            onOpenHistory={onOpenHistory}
          />
          {launched.length > 0 && onOpenLaunched && <LaunchedAgentsList items={launched} onOpen={onOpenLaunched} />}
          {coding.length > 0 && <ActivityList items={coding} error={false} {...actions} where={codingWhere} />}
          <CodeWorkList work={work} now={actions.now ?? Date.now()} branchActions={branchActions} />
        </section>
      )}
      {/* Only when no section title opens the history: same header as
          Routines, 28px like its row. */}
      {!showCoding && showAllHistory && (
        <div className="flex min-h-7 items-center">
          <SectionHeader
            icon={<History size={16} aria-hidden="true" className="text-ink-secondary" />}
            title={t("botPanel.history.all")}
            name="all"
            onOpenHistory={onOpenHistory}
          />
        </div>
      )}
    </>
  );
}

export function ActivitySection({ bot }: { bot: Bot }) {
  const advanced = useAdvancedMode();
  const showAllHistory = useShowAllHistory();
  const feed = useBotActivityFeed(bot);
  const [open, setOpen] = useState<BotActivityItem | null>(null);
  const [all, setAll] = useState<BotActivityFilter | null>(null);
  const list = feed.list;
  const error = feed.error;
  const stop = feed.stop;
  const dispatch = useStoreDispatch();
  const getState = useStoreGetter();
  // 2026-10-29: a routine run opens its run detail (the Routines page), as
  // View run does; a run this client does not hold keeps the task sheet.
  const openItem = (item: BotActivityItem) => {
    const runId = item.kind === "routine" && item.id.startsWith("run:") ? item.id.slice(4) : undefined;
    const run = runId ? getState().routineRuns.find((candidate) => candidate.id === runId) : undefined;
    if (run) openRoutineRun(dispatch, { runId: run.id, routineId: run.routineId });
    else setOpen(item);
  };
  const actions: CardActions = { onOpen: openItem, onStop: stop, stopping: feed.stopping, now: feed.now, fading: feed.live.fading };
  // The branches this person archived from their Coding list (kept on the
  // server per person and bot; the branches themselves stay).
  const [archived, setArchived] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!advanced) return;
    let live = true;
    loadArchivedBranches(bot.id).then((keys) => { if (live) setArchived(new Set(keys)); }).catch(() => {});
    return () => { live = false; };
  }, [bot.id, advanced]);
  const branchActions: BranchListActions = {
    botId: bot.id,
    onArchive: async (key, value) => setArchived(new Set(await setBranchArchived(bot.id, key, value))),
    onChanged: () => { void feed.refresh(); },
  };

  // The command palette's "<bot> history" opens it with the row hidden.
  useEffect(() => watchBotHistoryRequests(bot.id, () => setAll("coding")), [bot.id]);
  useEffect(() => {
    if (feed.deepLinked) setOpen(feed.deepLinked);
  }, [feed.deepLinked]);
  const openLaunched = useCallback((item: BotLaunchedAgentItem) => {
    if (!item.threadId) return;
    loadBotActivityDetail(api, item.targetBotId, item.id)
      .then((detail) => setOpen(detail))
      .catch(() => {});
  }, []);

  return (
    <>
      <PanelSections list={list} live={feed.live} actions={actions} onOpenHistory={setAll} onOpenLaunched={openLaunched} error={error} advanced={advanced} archived={archived} branchActions={branchActions} showAllHistory={showAllHistory} />
      {all && (
        <ActivityListModal
          botId={bot.id}
          filter={all}
          onFilter={setAll}
          onClose={() => setAll(null)}
          onChanged={() => { void feed.refresh(); }}
          onStop={stop}
          stopping={feed.stopping}
        />
      )}
      {open && (
        <ActivityDetailModal
          item={open}
          onClose={() => setOpen(null)}
          onChanged={() => { void feed.refresh(); }}
        />
      )}
    </>
  );
}
