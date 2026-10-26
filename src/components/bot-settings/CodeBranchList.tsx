// Details > Coding's branches, in the same grouped card as Routines (JC
// 2026-10-19: "Mets le même encadré pour les éléments de coding"), each
// with what it is now and a "..." menu to act on it (src/lib/code-branches.ts,
// server/routes/bot-code-branches.ts): Commit (proposed message, editable,
// the changed files), Push, open the pull request (or open a new one), View
// diff, Show in folder, Open in Computer, Archive (hidden from this
// person's list, the branch kept; "Show archived" brings it back) and
// Delete the local branch (confirmed; work not on origin needs a second
// confirmation). Each action shows its progress on the row, then one line
// saying what happened or what went wrong.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Archive, ArchiveRestore, ExternalLink, FileDiff, FolderOpen, GitBranch, GitCommitHorizontal, GitMerge, GitPullRequest,
  GitPullRequestClosed, Loader2, Monitor, MoreHorizontal, Trash2, Upload,
} from "lucide-react";

import { ApiError, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import { openExternalLink } from "@/lib/app-links";
import { writeComputerPanelView } from "@/lib/computer-panel-view";
import { GROUPED_CARD, GROUPED_ROW } from "@/lib/grouped-card";
import {
  branchAction, branchActions, branchCounts, branchStatus, branchUnavailable, codingBranchKey, deleteNeedsSecondConfirm, loadBranchDiff, loadBranchInfo, loadBranchPull, remoteActionNeedsConfirm,
  type BotBranchDiff, type BotBranchInfo, type BotBranchPull, type BranchTone, type CodingBranch,
} from "@/lib/code-branches";
import { codeWorkWhen } from "@/lib/bot-activity";
import { useHeldMenuMotion } from "../MenuMotion";
import { navigateThreadMenu } from "../BotProjects";
import { ConfirmDialog } from "../ConfirmDialog";
import { DialogFrame, DialogLayer, FIELD, PILL, PRIMARY_PILL } from "../SettingsPrimitives";
import { DiffView } from "../code/DiffView";

const ERROR_KEYS: Record<string, LocaleKey> = {
  auth: "botPanel.branch.error.auth",
  github_not_connected: "botPanel.branch.hint.githubNotConnected",
  rejected: "botPanel.branch.error.rejected",
  not_pushed: "botPanel.branch.hint.pushFirst",
  checked_out: "botPanel.branch.error.checkedOut",
  elsewhere: "botPanel.branch.hint.elsewhere",
  offline: "botPanel.branch.hint.offline",
  no_path: "botPanel.branch.hint.noPath",
  unknown_os: "botPanel.branch.hint.unknownOs",
  no_gh: "botPanel.branch.error.noGh",
  nothing_to_commit: "botPanel.branch.hint.nothingToCommit",
  unreachable: "botPanel.branch.error.unreachable",
  not_github: "botPanel.branch.hint.notGithub",
  default_branch: "botPanel.branch.hint.default",
  stale_files: "botPanel.branch.error.staleFiles",
  gone: "botPanel.branch.error.gone",
  empty_message: "botPanel.branch.error.emptyMessage",
  commit_failed: "botPanel.branch.error.commitFailed",
  no_person: "botPanel.branch.error.noPerson",
  no_author: "botPanel.branch.error.noAuthor",
  unsafe_config: "botPanel.branch.error.unsafeConfig",
};

/** The words for a refused action: ours for the known codes, else the
 * server's message. */
export function branchErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    const code = typeof error.body?.code === "string" ? error.body.code : "";
    if (ERROR_KEYS[code]) return t(ERROR_KEYS[code]!);
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

const TONE_ICON: Record<BranchTone, { icon: typeof GitBranch; className: string }> = {
  merged: { icon: GitMerge, className: "text-accent-text" },
  open: { icon: GitPullRequest, className: "text-success" },
  closed: { icon: GitPullRequestClosed, className: "text-danger" },
  pushed: { icon: GitBranch, className: "text-ink-secondary" },
  local: { icon: GitBranch, className: "text-ink-secondary" },
  gone: { icon: GitBranch, className: "text-ink-tertiary" },
};

const TONE_PILL: Record<BranchTone, string> = {
  merged: "bg-accent/15 text-accent-text",
  open: "bg-success/15 text-success",
  closed: "bg-danger/10 text-danger",
  pushed: "bg-inset text-ink-secondary",
  local: "bg-warning/15 text-warning",
  gone: "bg-inset text-ink-tertiary",
};

export interface BranchListActions {
  botId: string;
  /** Archive or bring back one branch (by `codingBranchKey`). */
  onArchive: (key: string, archived: boolean) => Promise<void>;
  /** Refresh the Coding list after a change. */
  onChanged?: () => void;
}

/** One branch row: icon, name, status pill, where and when, the "..." menu,
 * and the last action's line. `info` is the branch read now (absent until
 * it loads, or where it cannot be read). */
export function BranchRow({ branch, now, info, pull, busy, note, archived = false, actions, onAct }: {
  branch: CodingBranch;
  now: number;
  info?: BotBranchInfo;
  pull?: BotBranchPull | null;
  busy?: boolean;
  note?: { tone: "ok" | "error"; text: string };
  archived?: boolean;
  actions?: BranchListActions;
  onAct?: (action: BranchMenuAction) => void;
}) {
  const status = branchStatus(branch, info?.state, pull);
  const tone = TONE_ICON[status.tone];
  const Icon = tone.icon;
  const onComputer = info?.place === "remote" && info.host ? t("botPanel.branch.onComputer", { host: info.host }) : undefined;
  const subtitle = [branch.repo ?? info?.repo ?? info?.folderName, onComputer, ...branchCounts(info?.state), codeWorkWhen(branch.at, now)].filter(Boolean).join(" · ");
  const url = branch.url;
  const body = (
    <>
      <Icon size={16} strokeWidth={1.9} aria-hidden="true" className={cn("shrink-0", tone.className)} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-[13px] leading-[18px]", status.tone === "gone" ? "text-ink-secondary line-through" : "text-ink")}>{branch.name}</span>
          <span data-branch-status={status.tone} className={cn("shrink-0 rounded-md px-1.5 text-[11px] leading-[16px]", TONE_PILL[status.tone])}>{status.label}</span>
        </span>
        <span className="block truncate text-[12px] leading-[17px] text-ink-secondary">{subtitle}</span>
      </span>
    </>
  );
  return (
    <li data-code-row="branch" data-branch={branch.name} data-branch-archived={archived ? "" : undefined} className={cn("flex flex-col gap-1 hover:bg-hover", GROUPED_ROW)}>
      <div className="flex min-w-0 items-center gap-1">
        {url ? (
          <button
            type="button"
            data-code-link={url}
            onClick={() => void openExternalLink(url)}
            aria-label={t("botPanel.code.openAria", { name: branch.name })}
            title={url}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {body}
          </button>
        ) : <div className="flex min-w-0 flex-1 items-center gap-3">{body}</div>}
        {actions && onAct && (
          busy
            ? <span role="status" aria-label={t("botPanel.branch.working")} className="flex size-7 shrink-0 items-center justify-center text-ink-secondary"><Loader2 size={14} className="animate-spin" aria-hidden="true" /></span>
            : <BranchMenu branch={branch} info={info} pull={pull} archived={archived} onAct={onAct} />
        )}
      </div>
      {note && (
        <p role={note.tone === "error" ? "alert" : "status"} data-branch-note={note.tone} className={cn("pl-7 text-[12px] leading-[17px]", note.tone === "error" ? "text-danger" : "text-ink-secondary")}>
          {note.text}
        </p>
      )}
    </li>
  );
}

export type BranchMenuAction = "commit" | "push" | "pr" | "openPr" | "diff" | "reveal" | "computer" | "archive" | "unarchive" | "delete";

function revealBridge(): ((path: string) => Promise<"shown" | "missing" | "invalid">) | undefined {
  const ogb = typeof window === "undefined" ? undefined : window.ogb;
  return ogb?.remoteClient?.active ? undefined : ogb?.revealInFolder;
}

/** The "..." button and its menu (portalled: the grouped card clips). */
export function BranchMenu({ branch, info, pull, archived, onAct }: {
  branch: CodingBranch;
  info?: BotBranchInfo;
  pull?: BotBranchPull | null;
  archived: boolean;
  onAct: (action: BranchMenuAction) => void;
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const motion = useHeldMenuMotion(anchor);
  const shown = motion.value;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setAnchor(null), []);

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element || !shown) return;
    const { width, height } = element.getBoundingClientRect();
    element.style.top = `${Math.max(8, Math.min(shown.y, window.innerHeight - height - 8))}px`;
    element.style.left = `${Math.max(8, Math.min(shown.x - width, window.innerWidth - width - 8))}px`;
  });
  useEffect(() => {
    if (!anchor) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    const onDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-branch-menu], [data-branch-menu-button]")) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
      buttonRef.current?.focus();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [anchor, close]);

  const can = branchActions(info, pull, branch);
  const state = info?.state;
  const blocked = info?.publishBlocked;
  const publishHint = blocked === "github_not_connected" ? t("botPanel.branch.hint.githubNotConnected") : blocked === "elsewhere" || info?.place === "elsewhere" ? t("botPanel.branch.hint.elsewhere") : undefined;
  const unavailableKey = branchUnavailable(info, branch);
  const unavailable = unavailableKey ? t(unavailableKey) : undefined;
  const commitHint = unavailable ?? (!state ? undefined : !state.worktree ? t("botPanel.branch.hint.notCheckedOut") : state.changes.length === 0 ? t("botPanel.branch.hint.nothingToCommit") : undefined);
  const pushHint = unavailable ?? publishHint ?? (state?.isDefault ? t("botPanel.branch.hint.default") : state && state.pushed && state.ahead === 0 ? t("botPanel.branch.hint.alreadyPushed") : undefined);
  const prHint = unavailable ?? publishHint ?? (state && !state.pushed ? t("botPanel.branch.hint.pushFirst") : !(branch.repo ?? info?.repo) ? t("botPanel.branch.hint.notGithub") : undefined);
  const prNumber = pull?.number ?? branch.pull?.number;
  const reveal = revealBridge();
  const worktree = state?.worktree;
  const canReveal = Boolean(reveal && worktree && /^(?:\/(?!\/)|[a-zA-Z]:[\\/])/.test(worktree));

  const item = (id: BranchMenuAction, icon: ReactNode, label: string, opts?: { disabled?: boolean; hint?: string; danger?: boolean }) => (
    <button
      key={id}
      type="button"
      role="menuitem"
      data-menu-item={id}
      disabled={opts?.disabled}
      title={opts?.disabled ? opts.hint : undefined}
      onClick={() => { close(); onAct(id); }}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px]",
        opts?.danger ? "text-danger" : "text-ink",
        opts?.disabled ? "cursor-default opacity-40" : "hover:bg-hover",
      )}
    >
      <span className="shrink-0 [&>svg]:size-4">{icon}</span>
      {opts?.disabled && opts.hint ? (
        <span className="flex min-w-0 flex-col">
          <span>{label}</span>
          <span data-menu-item-reason="" className="text-[11.5px] leading-4 text-ink-secondary">{opts.hint}</span>
        </span>
      ) : <span className="min-w-0 flex-1 truncate">{label}</span>}
    </button>
  );
  const divider = (key: string) => <div key={key} className="mx-2 my-1 h-[0.5px] bg-border" aria-hidden="true" />;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-branch-menu-button={branch.name}
        aria-label={t("botPanel.branch.menu", { name: branch.name })}
        title={t("botPanel.branch.menu", { name: branch.name })}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(event) => {
          if (anchor) { close(); return; }
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchor({ x: rect.right, y: rect.bottom + 4 });
        }}
        className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-elevated-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60", anchor && "bg-elevated-hover text-ink")}
      >
        <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {motion.shown && shown && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          data-branch-menu={branch.name}
          role="menu"
          aria-label={t("botPanel.branch.menu", { name: branch.name })}
          onKeyDown={navigateThreadMenu}
          style={{ top: shown.y, left: shown.x }}
          className={cn("fixed z-[60] flex max-h-[calc(100dvh-16px)] w-[260px] max-w-[calc(100vw-16px)] flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5 text-[13px] leading-[18px]", motion.className)}
          {...motion.exitProps}
        >
          {item("commit", <GitCommitHorizontal />, `${t("botPanel.branch.commit")}…`, { disabled: !can.commit, hint: commitHint })}
          {item("push", <Upload />, t("botPanel.branch.push"), { disabled: !can.push, hint: pushHint })}
          {can.prUrl
            ? item("openPr", <ExternalLink />, prNumber !== undefined ? t("botPanel.branch.viewPr", { number: prNumber }) : t("botPanel.branch.viewPrPlain"))
            : item("pr", <GitPullRequest />, t("botPanel.branch.openPr"), { disabled: !can.openPr, hint: prHint })}
          {item("diff", <FileDiff />, t("botPanel.branch.diff"), { disabled: !can.diff, hint: unavailable })}
          {divider("places")}
          {canReveal && item("reveal", <FolderOpen />, t("botPanel.branch.reveal"))}
          {item("computer", <Monitor />, t("botPanel.branch.openIn", { tab: t("botPanel.tab.computer") }))}
          {divider("list")}
          {archived
            ? item("unarchive", <ArchiveRestore />, t("botPanel.branch.unarchive"))
            : item("archive", <Archive />, t("botPanel.branch.archive"))}
          {item("delete", <Trash2 />, `${t("botPanel.branch.delete")}…`, { disabled: !can.remove, hint: unavailable ?? (state?.isDefault ? t("botPanel.branch.hint.default") : undefined), danger: true })}
        </div>,
        document.body,
      )}
    </>
  );
}

interface RowState {
  info?: BotBranchInfo;
  pull?: BotBranchPull | null;
  busy?: boolean;
  note?: { tone: "ok" | "error"; text: string };
}

/** The branches card: rows read live, the menus' actions, their dialogs,
 * and "Show archived". Without `actions` the rows draw without a menu. */
export function CodeBranchList({ branches, archivedBranches = [], now, actions, label }: {
  branches: CodingBranch[];
  archivedBranches?: CodingBranch[];
  now: number;
  actions?: BranchListActions;
  label: string;
}) {
  const { dispatch } = useStore();
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [showArchived, setShowArchived] = useState(false);
  const [committing, setCommitting] = useState<CodingBranch | null>(null);
  const [diffOf, setDiffOf] = useState<CodingBranch | null>(null);
  const [deleting, setDeleting] = useState<{ branch: CodingBranch; second: boolean } | null>(null);
  const [confirming, setConfirming] = useState<{ branch: CodingBranch; action: "push" | "pr" } | null>(null);
  const botId = actions?.botId;
  const patch = useCallback((key: string, next: Partial<RowState>) => setRows((current) => ({ ...current, [key]: { ...current[key], ...next } })), []);

  const read = useCallback(async (branch: CodingBranch) => {
    if (!botId || !branch.threadId) return;
    try {
      const info = await loadBranchInfo(botId, branch.threadId, branch.name);
      patch(codingBranchKey(branch), { info });
      // The pull request as GitHub has it now (one opened by hand too).
      if (info.state?.pushed && info.canPublish && (branch.repo ?? info.repo)) {
        const pull = await loadBranchPull(botId, branch.threadId, branch.name).catch(() => undefined);
        if (pull !== undefined) patch(codingBranchKey(branch), { pull });
      }
    } catch {
      // the row keeps what the bot's calls said
    }
  }, [botId, patch]);

  const listed = showArchived ? [...branches, ...archivedBranches] : branches;
  const readKeys = listed.map((branch) => `${codingBranchKey(branch)}@${branch.threadId ?? ""}:${branch.at}`).join("|");
  useEffect(() => {
    for (const branch of listed) void read(branch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readKeys, read]);

  const run = async (branch: CodingBranch, work: () => Promise<string | undefined>) => {
    const key = codingBranchKey(branch);
    patch(key, { busy: true, note: undefined });
    try {
      const text = await work();
      patch(key, { busy: false, ...(text ? { note: { tone: "ok", text } } : {}) });
      await read(branch);
      actions?.onChanged?.();
    } catch (error) {
      patch(key, { busy: false, note: { tone: "error", text: branchErrorText(error) } });
    }
  };

  const runPush = (branch: CodingBranch) => {
    if (!botId) return;
    void run(branch, async () => {
      const result = await branchAction(botId, "push", { threadId: branch.threadId ?? "", branch: branch.name });
      return t("botPanel.branch.done.push", { remote: result.remote ?? "origin" });
    });
  };
  const runPr = (branch: CodingBranch) => {
    if (!botId) return;
    const key = codingBranchKey(branch);
    void run(branch, async () => {
      const result = await branchAction(botId, "pr", { threadId: branch.threadId ?? "", branch: branch.name });
      if (result.pull) {
        patch(key, { pull: result.pull });
        void openExternalLink(result.pull.url);
        return t("botPanel.branch.done.pr", { number: result.pull.number });
      }
      // gh was not on the bot's computer: the branch is pushed, open GitHub's
      // compare page so the person creates the pull request by hand.
      if (result.compareUrl) {
        void openExternalLink(result.compareUrl);
        return t("botPanel.branch.done.prCompare");
      }
      return undefined;
    });
  };

  const act = (branch: CodingBranch) => (action: BranchMenuAction) => {
    if (!actions || !botId) return;
    const key = codingBranchKey(branch);
    const row = rows[key];
    switch (action) {
      case "commit": setCommitting(branch); return;
      case "diff": setDiffOf(branch); return;
      case "delete": setDeleting({ branch, second: false }); return;
      case "openPr": {
        const url = row?.pull?.url ?? branch.pull?.url;
        if (url) void openExternalLink(url);
        return;
      }
      case "reveal": {
        const path = row?.info?.state?.worktree;
        const reveal = revealBridge();
        if (path && reveal) void reveal(path).then((result) => { if (result !== "shown") patch(key, { note: { tone: "error", text: t("botPanel.branch.error.reveal") } }); });
        return;
      }
      case "computer":
        writeComputerPanelView(botId, "computer");
        dispatch({ type: "toggleComputer", open: true });
        return;
      case "push":
        // On the bot's own computer a push runs on a client's machine: confirm first.
        if (remoteActionNeedsConfirm(row?.info, "push")) { setConfirming({ branch, action: "push" }); return; }
        runPush(branch);
        return;
      case "pr":
        if (remoteActionNeedsConfirm(row?.info, "pr")) { setConfirming({ branch, action: "pr" }); return; }
        runPr(branch);
        return;
      case "archive":
      case "unarchive":
        void run(branch, async () => {
          await actions.onArchive(key, action === "archive");
          return action === "archive" ? undefined : t("botPanel.branch.done.unarchive");
        });
        return;
    }
  };

  const confirmDelete = (branch: CodingBranch, second: boolean) => {
    if (!botId) return;
    const state = rows[codingBranchKey(branch)]?.info?.state;
    if (!second && deleteNeedsSecondConfirm(state)) {
      setDeleting({ branch, second: true });
      return;
    }
    setDeleting(null);
    void run(branch, async () => {
      try {
        await branchAction(botId, "delete", { threadId: branch.threadId ?? "", branch: branch.name, confirmUnpushed: second });
      } catch (error) {
        // The server found work not on origin that this row did not know of:
        // the second confirmation, not an error.
        if (!second && error instanceof ApiError && error.body?.code === "unpushed") {
          setDeleting({ branch, second: true });
          return undefined;
        }
        throw error;
      }
      return t("botPanel.branch.done.delete");
    });
  };

  if (!branches.length && !archivedBranches.length) return null;
  const row = (branch: CodingBranch, archived: boolean) => {
    const state = rows[codingBranchKey(branch)];
    return (
      <BranchRow
        key={`${codingBranchKey(branch)}${archived ? ":archived" : ""}`}
        branch={branch}
        now={now}
        info={state?.info}
        pull={state?.pull}
        busy={state?.busy}
        note={state?.note}
        archived={archived}
        actions={actions}
        onAct={act(branch)}
      />
    );
  };
  return (
    <div className="flex flex-col gap-1.5">
      {listed.length > 0 && (
        <ul data-code-branches className={GROUPED_CARD} aria-label={label}>
          {branches.map((branch) => row(branch, false))}
          {showArchived && archivedBranches.map((branch) => row(branch, true))}
        </ul>
      )}
      {actions && archivedBranches.length > 0 && (
        <button
          type="button"
          data-show-archived-branches={showArchived ? "on" : "off"}
          aria-expanded={showArchived}
          onClick={() => setShowArchived((value) => !value)}
          className="self-start rounded-md px-1 text-[12px] leading-[17px] text-ink-tertiary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {showArchived ? t("botPanel.branch.hideArchived") : t("botPanel.branch.showArchived", { count: archivedBranches.length })}
        </button>
      )}
      {committing && botId && (
        <CommitDialog
          botId={botId}
          branch={committing}
          info={rows[codingBranchKey(committing)]?.info}
          onClose={() => setCommitting(null)}
          onCommitted={(sha) => {
            const branch = committing;
            setCommitting(null);
            patch(codingBranchKey(branch), { note: { tone: "ok", text: t("botPanel.branch.done.commit", { sha: sha.slice(0, 7) }) } });
            void read(branch);
            actions?.onChanged?.();
          }}
        />
      )}
      {diffOf && botId && <DiffDialog botId={botId} branch={diffOf} onClose={() => setDiffOf(null)} />}
      <ConfirmDialog
        open={confirming !== null}
        tone="neutral"
        title={confirming?.action === "push" ? t("botPanel.branch.confirmPush.title") : t("botPanel.branch.confirmPr.title")}
        body={confirming ? (confirming.action === "push" ? t("botPanel.branch.confirmPush.body", { branch: confirming.branch.name, host: rows[codingBranchKey(confirming.branch)]?.info?.host ?? "" }) : t("botPanel.branch.confirmPr.body", { branch: confirming.branch.name, host: rows[codingBranchKey(confirming.branch)]?.info?.host ?? "" })) : ""}
        confirmLabel={confirming?.action === "push" ? t("botPanel.branch.push") : t("botPanel.branch.openPr")}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (!confirming) return;
          const { branch, action } = confirming;
          setConfirming(null);
          if (action === "push") runPush(branch);
          else runPr(branch);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        title={deleting?.second ? t("botPanel.branch.delete.unpushedTitle") : t("botPanel.branch.delete.title", { branch: deleting?.branch.name ?? "" })}
        body={deleting?.second ? t("botPanel.branch.delete.unpushedBody", { branch: deleting.branch.name }) : t("botPanel.branch.delete.body")}
        confirmLabel={deleting?.second ? t("botPanel.branch.delete.confirmUnpushed") : t("botPanel.branch.delete.confirm")}
        onCancel={() => setDeleting(null)}
        onConfirm={() => { if (deleting) confirmDelete(deleting.branch, deleting.second); }}
      />
    </div>
  );
}

/** Commit the branch's changes: the proposed message (editable) and the
 * changed files, all chosen to start with. */
export function CommitDialog({ botId, branch, info, onClose, onCommitted }: {
  botId: string;
  branch: CodingBranch;
  info?: BotBranchInfo;
  onClose: () => void;
  onCommitted: (sha: string) => void;
}) {
  const changes = info?.state?.changes ?? [];
  const [message, setMessage] = useState(info?.proposedMessage ?? "");
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(changes.map((change) => change.path)));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  // The parent passes onClose inline: a ref, so a new render neither
  // re-selects the message nor re-binds Escape.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => {
    area.current?.focus();
    area.current?.select();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !pendingRef.current) { event.preventDefault(); event.stopPropagation(); closeRef.current(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const submit = async () => {
    if (!message.trim()) { setError(t("botPanel.branch.commit.empty")); return; }
    if (!chosen.size) { setError(t("botPanel.branch.commit.noFiles")); return; }
    setPending(true);
    setError("");
    try {
      const paths = chosen.size === changes.length ? undefined : [...chosen];
      const result = await branchAction(botId, "commit", { threadId: branch.threadId ?? "", branch: branch.name, message, ...(paths ? { paths } : {}) });
      onCommitted(result.sha ?? "");
    } catch (cause) {
      setError(branchErrorText(cause));
      setPending(false);
    }
  };
  const toggle = (path: string) => setChosen((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });
  return (
    <DialogLayer onBackdropMouseDown={() => { if (!pending) onClose(); }}>
      <DialogFrame
        titleId="branch-commit-title"
        title={t("botPanel.branch.commit.title", { branch: branch.name })}
        subtitle={branch.repo ?? info?.repo ?? info?.folderName}
        width="lg"
        closeLabel={t("common.close")}
        onClose={onClose}
        closeDisabled={pending}
        frameProps={{ "data-branch-commit": branch.name, "aria-busy": pending ? "true" : undefined }}
        footer={<>
          <button type="button" className={PILL} onClick={onClose} disabled={pending}>{t("common.cancel")}</button>
          <button type="button" data-branch-commit-confirm="" className={PRIMARY_PILL} onClick={() => void submit()} disabled={pending}>
            {pending && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}{t("botPanel.branch.commit.confirm")}
          </button>
        </>}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] leading-4 text-ink-secondary">{t("botPanel.branch.commit.message")}</span>
          <textarea ref={area} data-branch-commit-message="" rows={3} value={message} onChange={(event) => setMessage(event.target.value)} className={cn(FIELD, "resize-y font-mono text-[12.5px]")} />
        </label>
        <fieldset className="flex min-h-0 flex-col gap-1.5">
          <legend className="mb-1.5 text-[12px] leading-4 text-ink-secondary">{t("botPanel.branch.commit.files", { count: chosen.size })}</legend>
          <ul className={cn(GROUPED_CARD, "max-h-[240px] overflow-y-auto")}>
            {changes.map((change) => (
              <li key={change.path} className={cn("flex items-center gap-2.5 text-[12.5px] leading-[18px]", GROUPED_ROW, "py-1.5")}>
                <input type="checkbox" checked={chosen.has(change.path)} onChange={() => toggle(change.path)} aria-label={change.path} className="size-3.5 shrink-0 accent-accent" />
                <span className={cn("w-4 shrink-0 text-center font-mono text-[11px]", change.status === "deleted" ? "text-danger" : change.status === "untracked" || change.status === "added" ? "text-success" : "text-warning")} aria-hidden="true">
                  {change.status === "deleted" ? "D" : change.status === "untracked" ? "U" : change.status === "added" ? "A" : change.status === "renamed" ? "R" : "M"}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-ink" title={change.path}>{change.path}</span>
              </li>
            ))}
          </ul>
        </fieldset>
        {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
      </DialogFrame>
    </DialogLayer>
  );
}

/** The branch's diff against its base, with what is not committed yet, in
 * the Code section's DiffView. */
export function DiffDialog({ botId, branch, onClose }: { botId: string; branch: CodingBranch; onClose: () => void }) {
  const [diff, setDiff] = useState<BotBranchDiff | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"unified" | "split">("unified");
  // onClose comes inline from the parent: a ref, so each render does not
  // read the diff again.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    let live = true;
    loadBranchDiff(botId, branch.threadId ?? "", branch.name).then((next) => { if (live) setDiff(next); }).catch((cause) => { if (live) setError(branchErrorText(cause)); });
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRef.current(); } };
    window.addEventListener("keydown", onKey, true);
    return () => { live = false; window.removeEventListener("keydown", onKey, true); };
  }, [botId, branch.threadId, branch.name]);
  return (
    <DialogLayer onBackdropMouseDown={onClose}>
      <DialogFrame
        titleId="branch-diff-title"
        title={t("botPanel.branch.diff.title", { branch: branch.name })}
        subtitle={diff?.base ? t("botPanel.branch.diff.against", { base: diff.base }) : undefined}
        width="xl"
        closeLabel={t("common.close")}
        onClose={onClose}
        frameProps={{ "data-branch-diff": branch.name }}
      >
        {error ? <p role="alert" className="text-[12.5px] text-danger">{error}</p>
          : !diff ? <p role="status" className="flex items-center gap-2 text-[12.5px] text-ink-secondary"><Loader2 size={14} className="animate-spin" aria-hidden="true" />{t("botPanel.branch.diff.loading")}</p>
          : diff.files.length === 0 ? <p className="text-[12.5px] text-ink-secondary">{t("botPanel.branch.diff.empty")}</p>
          : <>
            {diff.truncated && <p role="status" className="text-[12px] text-warning">{t("botPanel.branch.diff.truncated")}</p>}
            <DiffView files={diff.files} mode={mode} onModeChange={setMode} testId="branch-diff" />
          </>}
      </DialogFrame>
    </DialogLayer>
  );
}
