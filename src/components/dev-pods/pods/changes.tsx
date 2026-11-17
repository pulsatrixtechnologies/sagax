// Changes: the pull requests and commits the bot made in this conversation,
// from its own gh and git rows and the pull request links in its replies.
// The menu opens the link or copies it; a local commit with no link offers
// its place in the conversation and its id.
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { GitCommitHorizontal, GitPullRequest, MoreHorizontal } from "lucide-react";
import { openExternalLink } from "@/lib/app-links";
import { copyText } from "@/lib/copy-text";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { DEV_MENU_ITEM, DevMenu } from "../DevMenu";
import { registerDevPod, type DevPodContext } from "../registry";
import { devChanges, type DevChange } from "../sources";
import type { LocaleKey } from "@/locales";
import { readableError } from "@/lib/plain-error";

const PULL_STATE: Record<"open" | "closed" | "merged", LocaleKey> = {
  open: "devPods.changes.state.open",
  merged: "devPods.changes.state.merged",
  closed: "devPods.changes.state.closed",
};
const PULL_ACTION: Record<NonNullable<DevChange["action"]>, LocaleKey> = {
  opened: "devPods.changes.action.opened",
  merged: "devPods.changes.action.merged",
  closed: "devPods.changes.action.closed",
  updated: "devPods.changes.action.updated",
};

/** The forge's own answer for a pull request this conversation opened. */
export interface PullStats {
  number: number;
  additions?: number;
  deletions?: number;
  state: "open" | "closed" | "merged";
  draft?: boolean;
  canAct?: boolean;
  autoMerge?: boolean;
}

function ChangeMenu({ change, ctx, open, anchorRef, onClose }: { change: DevChange; ctx: DevPodContext; open: boolean; anchorRef: RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const run = (action: () => void) => () => { onClose(); action(); };
  return (
    <DevMenu open={open} anchorRef={anchorRef} label={t("devPods.changes.more", { title: change.title })} onClose={onClose}>
      {change.url && <button type="button" role="menuitem" className={DEV_MENU_ITEM} onClick={run(() => void openExternalLink(change.url!))}>{t("devPods.changes.open")}</button>}
      {change.url && <button type="button" role="menuitem" className={DEV_MENU_ITEM} onClick={run(() => void copyText(change.url!))}>{t("devPods.changes.copy")}</button>}
      <button type="button" role="menuitem" className={DEV_MENU_ITEM} onClick={run(() => ctx.dispatch({ type: "focusMessage", threadId: ctx.bot.threadId, messageId: change.messageId }))}>{t("devPods.changes.show")}</button>
      {change.sha && <button type="button" role="menuitem" className={DEV_MENU_ITEM} onClick={run(() => void copyText(change.sha!))}>{t("devPods.changes.copySha")}</button>}
    </DevMenu>
  );
}

function lineCounts(stats: PullStats | undefined): string | null {
  if (!stats || stats.additions === undefined || stats.deletions === undefined) return null;
  return `+${stats.additions} -${stats.deletions}`;
}

function ChangeRow({ change, ctx, stats, notice, onAct }: {
  change: DevChange;
  ctx: DevPodContext;
  stats?: PullStats;
  notice?: string;
  onAct?: (action: "draft" | "close" | "autofix" | "merge-ready" | "archive") => void;
}) {
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const Icon = change.kind === "pull" ? GitPullRequest : GitCommitHorizontal;
  const where = change.kind === "pull"
    ? `${change.repo ?? ""} #${change.number}`
    : change.sha!.slice(0, 7);
  return (
    <li data-change={change.key} className="group/change relative flex min-h-[36px] items-start gap-2 py-1">
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-secondary" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ink" title={change.title}>{change.title}</span>
        <span className="flex items-center gap-1.5 truncate font-mono text-[11.5px] text-ink-secondary">
          <span className="truncate">{where}</span>
          {change.action && !stats && <span data-change-action={change.action} className="shrink-0 font-sans">{t(PULL_ACTION[change.action])}</span>}
          {stats && <span data-change-state={stats.draft ? "draft" : stats.state} className="shrink-0 font-sans">{t(stats.draft ? "devPods.changes.state.draft" : PULL_STATE[stats.state])}</span>}
          {lineCounts(stats) && <span data-change-lines="" className="shrink-0 font-sans tabular-nums">{lineCounts(stats)}</span>}
        </span>
        {stats?.canAct && onAct && (
          <span className="mt-0.5 flex flex-wrap gap-1">
            {stats.state === "open" && !stats.draft && (
              <button type="button" data-change-draft="" className="rounded-md px-1.5 py-0.5 text-[12px] text-ink-secondary hover:bg-hover hover:text-ink" onClick={() => onAct("draft")}>{t("devPods.changes.draft")}</button>
            )}
            {stats.state === "open" && (
              <button type="button" data-change-dismiss="" className="rounded-md px-1.5 py-0.5 text-[12px] text-ink-secondary hover:bg-hover hover:text-ink" onClick={() => onAct("close")}>{t("devPods.changes.dismiss")}</button>
            )}
            {stats.state === "open" && (
              <button type="button" data-change-autofix="" className="rounded-md px-1.5 py-0.5 text-[12px] text-ink-secondary hover:bg-hover hover:text-ink" onClick={() => onAct("autofix")}>{t("devPods.changes.autoFix")}</button>
            )}
            {stats.state === "open" && (
              <button type="button" data-change-merge-ready="" aria-pressed={stats.autoMerge === true} className="rounded-md px-1.5 py-0.5 text-[12px] text-ink-secondary hover:bg-hover hover:text-ink" onClick={() => onAct("merge-ready")}>{t("devPods.changes.mergeReady")}</button>
            )}
            <button type="button" data-change-archive="" className="rounded-md px-1.5 py-0.5 text-[12px] text-ink-secondary hover:bg-hover hover:text-ink" onClick={() => onAct("archive")}>{t("devPods.changes.autoArchive")}</button>
          </span>
        )}
        {notice && <span data-change-notice="" className="text-[12px] text-danger">{notice}</span>}
      </div>
      <button
        ref={menuButton}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("devPods.changes.more", { title: change.title })}
        title={t("devPods.changes.more", { title: change.title })}
        onClick={() => setOpen((value) => !value)}
        className={cn("flex size-6 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-hover hover:text-ink", !open && "opacity-60 touch:opacity-100 focus-visible:opacity-100 group-hover/change:opacity-100")}
      >
        <MoreHorizontal size={14} />
      </button>
      <ChangeMenu change={change} ctx={ctx} open={open} anchorRef={menuButton} onClose={close} />
    </li>
  );
}

function ChangesBody({ data, ctx }: { data: DevChange[]; ctx: DevPodContext }) {
  const [stats, setStats] = useState<Record<string, PullStats>>({});
  const [notices, setNotices] = useState<Record<string, string>>({});
  const pulls = data.filter((change) => change.kind === "pull" && change.repo && change.number);
  const key = pulls.map((change) => change.key).join(",");
  useEffect(() => {
    let live = true;
    for (const change of pulls) {
      const path = `/api/bots/${encodeURIComponent(ctx.bot.id)}/code/pull?threadId=${encodeURIComponent(ctx.bot.threadId)}&repo=${encodeURIComponent(change.repo!)}&number=${change.number}`;
      api<{ pull?: Omit<PullStats, "canAct"> | null; canAct?: boolean }>(path)
        .then((body) => {
          if (!live || !body.pull) return;
          setStats((current) => ({ ...current, [change.key]: { ...body.pull!, ...(body.canAct ? { canAct: true } : {}) } }));
        })
        .catch(() => { /* no forge reading: the row keeps what the transcript said */ });
    }
    return () => { live = false; };
  }, [ctx.bot.id, ctx.bot.threadId, key]);
  const act = (change: DevChange, action: "draft" | "close" | "autofix" | "merge-ready" | "archive") => {
    const known = stats[change.key];
    const on = action === "merge-ready" ? known?.autoMerge !== true : undefined;
    void api<{ pull?: Omit<PullStats, "canAct"> | null; restarted?: number }>(`/api/bots/${encodeURIComponent(ctx.bot.id)}/code/pull`, {
      method: "POST",
      body: JSON.stringify({ threadId: ctx.bot.threadId, repo: change.repo, number: change.number, action, ...(on === undefined ? {} : { on }) }),
    }).then((body) => {
      setNotices((current) => {
        const next = { ...current };
        delete next[change.key];
        return next;
      });
      setStats((current) => {
        const row = current[change.key];
        if (!row) return current;
        if (body.pull) return { ...current, [change.key]: { ...body.pull, canAct: row.canAct } };
        if (action === "close") return { ...current, [change.key]: { ...row, state: "closed", canAct: false } };
        if (action === "draft") return { ...current, [change.key]: { ...row, draft: true } };
        if (action === "merge-ready") return { ...current, [change.key]: { ...row, autoMerge: on === true } };
        return current;
      });
    }).catch((error: unknown) => {
      const message = readableError(error);
      setNotices((current) => ({ ...current, [change.key]: message }));
    });
  };
  return (
    <ul className="flex flex-col">
      {data.map((change) => <ChangeRow key={change.key} change={change} ctx={ctx} stats={stats[change.key]} notice={notices[change.key]} onAct={(action) => act(change, action)} />)}
    </ul>
  );
}

registerDevPod<DevChange[]>({
  id: "changes",
  order: 50,
  title: () => t("devPods.changes.title"),
  icon: GitPullRequest,
  collapsible: true,
  useData: (ctx) => {
    const changes = useMemo(() => devChanges(ctx.messages), [ctx.messages]);
    return changes.length ? { status: "ready", data: changes } : { status: "empty" };
  },
  Body: ChangesBody,
});
