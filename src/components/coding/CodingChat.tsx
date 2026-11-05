// A coding task opened as a chat where the chat is (JC, 2026-11-03): the bot
// panel's Coding list is the entry point, a row opens this sheet over the
// chat column, the way a routine run opens (RoutineRunExchange in the
// ExchangeSheet shell), but drawn for development.
//
// - Header: the bot's pill, the task's title, its folder (name only) and
//   branch, its state with the elapsed time, Stop while it runs.
// - Transcript: the task's own thread (useSideTranscript: the newest page,
//   older pages on demand, then the live frames), words as bubbles, tool
//   calls as coding steps (src/lib/coding-chat.ts): a command is a terminal
//   block, an edit a diff per file, reads a line of file chips, anything else
//   the transcript's tool chip. A task the viewer may not read the thread of
//   shows its steps (the activity entry's).
// - Changes band, above the footer: files changed with their counts (a click
//   jumps to the file's newest diff), the newest test run, and the branch,
//   commit and pull request its own calls made.
// - Footer, like the routine sheet's: Continue (an inline composer: the
//   follow-up goes to the task's thread, joining the turn while it runs),
//   Stop while it runs, then Close Chat.
//
// The activity entry is polled every 3 s while the task runs (and a while
// after a follow-up, until the new turn shows); a reload keeps what is on
// screen, so a status change never blanks the sheet.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, ChevronDown, ChevronUp, FileText, Folder, GitBranch, GitCommitHorizontal, GitPullRequest, Loader2, MessageSquareText, Square } from "lucide-react";

import { api, useStore, type Bot, type Message } from "@/state/store";
import {
  activityStatusActive,
  activityStatusLabel,
  activityTitle,
  formatActivityDuration,
  loadBotActivityDetail,
  type BotActivityDetail,
  type BotActivityItem,
} from "@/lib/bot-activity";
import {
  changedFiles,
  codingPlace,
  codingRoot,
  codingRows,
  latestTests,
  stepMessages,
  type ChangedFile,
  type CodingChatTarget,
  type CodingRow,
} from "@/lib/coding-chat";
import { useSideTranscript } from "@/lib/use-side-transcript";
import { useWaitingCards } from "@/lib/use-waiting-cards";
import { waitingSources } from "@/lib/activity-waiting-sources";
import { openExternalLink } from "@/lib/app-links";
import { useChatColumnClass } from "@/lib/chat-bubble-width";
import { MAUS_COLORS, mausInk } from "@/lib/mascot";
import { botBubbleVars } from "@/lib/bubble-colors";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { avatarBot, useExchangePortalHost } from "../BotExchangeChip";
import { ChatMarkdown } from "../ChatMarkdown";
import { ClusterLabel } from "../ClusterLabel";
import { MessageBoundary } from "../MessageBoundary";
import { PartyAvatar } from "../PartyAvatar";
import { PILL, PRIMARY_PILL } from "../SettingsPrimitives";
import { ToolActivity, botNames } from "../ToolActivity";
import { WaitingOnYou } from "../task/WaitingOnYou";
import { ActivityStatusIcon } from "../bot-settings/ActivityCard";
import { CodingDiff } from "./CodingDiff";
import { CodingTerminal, TestCounts } from "./CodingTerminal";

const POLL_MS = 3_000;
/** After a follow-up, keep reading the entry this long so the new turn shows. */
const FOLLOW_MS = 30_000;

export type { CodingChatTarget };

type Reveal = { rowId: string; path: string; nonce: number };

function FileChips({ paths, running }: { paths: readonly string[]; running: boolean }) {
  return (
    <div data-coding-reads className="flex min-w-0 flex-wrap items-center gap-1.5 ps-1 text-[12px] text-ink-secondary">
      <span className="inline-flex items-center gap-1.5">
        {running ? <Loader2 size={13} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <FileText size={13} aria-hidden="true" />}
        {t("codingChat.read")}
      </span>
      {paths.map((path) => (
        <span key={path} data-coding-file-chip title={path} className="inline-flex max-w-[16rem] items-center rounded-md bg-control px-1.5 py-0.5 font-mono text-[11.5px] text-ink-secondary">
          <span className="truncate">{path.split("/").at(-1)}</span>
        </span>
      ))}
    </div>
  );
}

function Line({ message, bot, bots, joinsAbove }: { message: Message; bot: { name: string; color: string } & Partial<Bot>; bots: readonly Bot[]; joinsAbove: boolean }) {
  const mine = message.role === "user";
  const speaker = mine ? null : message.from?.botId ? avatarBot({ id: message.from.botId, name: message.from.name ?? bot.name, color: message.from.color }, bots) : bot;
  const text = message.text ?? "";
  return (
    <div className="contents">
      {!mine && !joinsAbove && speaker && <ClusterLabel bot={speaker as Bot} name={speaker.name} color={speaker.color} />}
      <div data-mid={message.id} data-side={mine ? "end" : "start"} className={cn("flex w-full", mine ? "justify-end" : "justify-start", joinsAbove && "-mt-1")}>
        <div
          data-chat-bubble
          className={cn("max-w-[min(100%,42rem)] rounded-[18px] px-3 py-[7px] text-[13px] leading-5", mine ? "bg-bubble-user" : "bg-bubble-bot text-ink")}
          style={mine ? undefined : (botBubbleVars(MAUS_COLORS[(speaker?.color ?? "blue") as keyof typeof MAUS_COLORS]) as CSSProperties)}
        >
          <MessageBoundary fallbackText={text}>
            <ChatMarkdown text={text} botId={mine ? undefined : speaker?.id} />
          </MessageBoundary>
        </div>
      </div>
    </div>
  );
}

function Row({ row, previous, bot, bots, reveal }: { row: CodingRow; previous?: CodingRow; bot: { name: string; color: string } & Partial<Bot>; bots: readonly Bot[]; reveal?: Reveal }) {
  if (row.kind === "line") {
    const joinsAbove = previous?.kind === "line" && previous.message.role === row.message.role && row.message.role === "bot";
    return <Line message={row.message} bot={bot} bots={bots} joinsAbove={joinsAbove} />;
  }
  if (row.kind === "reads") return <div data-coding-row={row.id}><FileChips paths={row.paths} running={row.running} /></div>;
  const step = row.step;
  return (
    <div data-coding-row={row.id} data-coding-step={step.kind}>
      {step.kind === "command" && <CodingTerminal step={step} />}
      {step.kind === "edit" && (
        <div className="flex flex-col gap-1.5">
          <CodingDiff files={step.files} reveal={reveal?.rowId === row.id ? { path: reveal.path, nonce: reveal.nonce } : undefined} />
          {step.ok === false && <p data-coding-edit-failed className="ps-1 text-[12px] text-danger">{step.error ? t("codingChat.edit.failedWhy", { why: step.error.split("\n")[0]!.slice(0, 200) }) : t("codingChat.edit.failed")}</p>}
        </div>
      )}
      {step.kind === "tool" && (
        <div className={cn("ps-1", step.tool.ok === false && "rounded-lg bg-danger/10 py-1")}>
          <ToolActivity tool={step.tool} nameOf={botNames(bots)} defaultOpen={step.tool.ok === false} />
        </div>
      )}
    </div>
  );
}

/** The band above the footer: what changed, the newest tests, and where it
 * went (branch, commit, pull request). Drawn only when there is something. */
export function ChangesBand({ files, tests, place, onJump }: {
  files: readonly ChangedFile[];
  tests?: ReturnType<typeof latestTests>;
  place: ReturnType<typeof codingPlace>;
  onJump: (file: ChangedFile) => void;
}) {
  const chatColumnClassName = useChatColumnClass();
  const [open, setOpen] = useState(false);
  const added = files.reduce((sum, file) => sum + file.added, 0);
  const removed = files.reduce((sum, file) => sum + file.removed, 0);
  const pull = place.pull;
  const commit = place.commit;
  if (files.length === 0 && !tests && !pull && !commit) return null;
  const chip = "inline-flex min-w-0 max-w-[14rem] items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-ink-secondary";
  return (
    <div data-coding-changes className="shrink-0 border-t border-hairline/40 bg-app px-5 pt-2">
      <div className={cn(chatColumnClassName, "flex flex-col gap-1.5")}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {files.length > 0 ? (
            <button
              type="button"
              data-coding-changes-toggle
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
              className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[12.5px] text-ink hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronUp size={13} aria-hidden="true" />}
              {t(files.length === 1 ? "codingChat.changes.files.one" : "codingChat.changes.files", { count: files.length })}
              <span className="font-mono text-[11.5px] tabular-nums"><span className="text-success">+{added}</span> <span className="text-danger">-{removed}</span></span>
            </button>
          ) : <span className="px-1 text-[12.5px] text-ink-secondary">{t("codingChat.changes.none")}</span>}
          {tests && <TestCounts tests={tests} />}
          <span className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
            {place.branch && <span data-coding-branch className={chip} title={place.branch}><GitBranch size={12} aria-hidden="true" className="shrink-0" /><span className="truncate font-mono">{place.branch}</span></span>}
            {commit && (
              commit.url
                ? <button type="button" data-coding-commit onClick={() => void openExternalLink(commit.url!)} title={commit.message ?? commit.sha.slice(0, 7)} className={cn(chip, "hover:bg-hover hover:text-ink")}><GitCommitHorizontal size={12} aria-hidden="true" className="shrink-0" /><span className="font-mono">{commit.sha.slice(0, 7)}</span></button>
                : <span data-coding-commit className={chip} title={commit.message}><GitCommitHorizontal size={12} aria-hidden="true" className="shrink-0" /><span className="font-mono">{commit.sha.slice(0, 7)}</span></span>
            )}
            {pull && (
              pull.url
                ? <button type="button" data-coding-pull onClick={() => void openExternalLink(pull.url!)} title={pull.title ?? pull.url} className={cn(chip, "text-accent-text hover:bg-hover")}><GitPullRequest size={12} aria-hidden="true" className="shrink-0" /><span className="truncate">{pull.number !== undefined ? t("botPanel.code.pr.numbered", { number: pull.number }) : t("botPanel.code.pr.new")}</span></button>
                : <span data-coding-pull className={chip}><GitPullRequest size={12} aria-hidden="true" className="shrink-0" /><span className="truncate">{pull.number !== undefined ? t("botPanel.code.pr.numbered", { number: pull.number }) : t("botPanel.code.pr.new")}</span></span>
            )}
          </span>
        </div>
        {open && files.length > 0 && (
          <ul data-coding-changes-list className="flex max-h-44 flex-col overflow-y-auto rounded-xl border border-hairline-weak bg-card py-1">
            {files.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  data-coding-changed-file={file.path}
                  onClick={() => onJump(file)}
                  title={file.path}
                  className="flex w-full min-w-0 items-center gap-2 px-3 py-1 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{file.path}</span>
                  <span className="shrink-0 font-mono text-[11.5px] tabular-nums"><span className="text-success">+{file.added}</span> <span className="text-danger">-{file.removed}</span></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The follow-up composer, inline in the footer: Enter sends, Shift+Enter a
 * new line, Escape folds it (and does not close the sheet). */
function FollowUp({ botName, onSend, onCancel }: { botName: string; onSend: (text: string) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { field.current?.focus(); }, []);
  const submit = async () => {
    const words = text.trim();
    if (!words || state === "sending") return;
    setState("sending");
    try {
      await onSend(words);
      setText("");
      setState("idle");
    } catch {
      setState("error");
    }
  };
  return (
    <div data-coding-followup className="flex w-full max-w-[42rem] flex-col gap-1">
      <div className="flex items-end gap-2 rounded-[22px] border-[0.5px] border-border bg-composer py-1.5 pl-4 pr-1.5 transition-colors focus-within:border-border-strong hover:border-border-strong motion-reduce:transition-none">
        <textarea
          ref={field}
          rows={1}
          value={text}
          onChange={(event) => { setText(event.target.value); if (state === "error") setState("idle"); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); return; }
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
          }}
          placeholder={t("codingChat.followUp.placeholder", { name: botName })}
          aria-label={t("codingChat.followUp.placeholder", { name: botName })}
          className="max-h-40 min-h-8 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[13.5px] leading-5 text-ink placeholder:text-ink-secondary focus:outline-none"
        />
        <button
          type="button"
          data-coding-send
          onClick={() => void submit()}
          disabled={!text.trim() || state === "sending"}
          aria-label={t("codingChat.followUp.send")}
          title={t("codingChat.followUp.send")}
          className="ui-button-primary flex size-8 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
        >
          {state === "sending" ? <Loader2 size={15} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <ArrowUp size={16} aria-hidden="true" />}
        </button>
      </div>
      {state === "error" && <p role="alert" className="px-4 text-[11.5px] text-danger">{t("codingChat.followUp.error")}</p>}
    </div>
  );
}

export interface CodingChatSheetProps {
  item: BotActivityItem;
  detail: BotActivityDetail | null;
  /** The thread's messages (or, without one, its steps as messages). */
  messages: readonly Message[];
  loaded: boolean;
  failed: boolean;
  hasMore?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  onRetry?: () => void;
  now: number;
  bot?: Bot;
  bots: readonly Bot[];
  onClose: () => void;
  onStop?: () => void;
  stopping?: boolean;
  /** Send a follow-up to the task's thread; absent when it has none. */
  onSend?: (text: string) => Promise<void>;
  /** What the task waits on from the person, drawn above the footer. */
  waiting?: ReactNode;
  /** Start with the follow-up composer open (tests, galleries). */
  composing?: boolean;
}

/** The sheet, without fetching: tests and galleries draw it with fixed data. */
export function CodingChatSheet({ item, detail, messages, loaded, failed, hasMore = false, loadingOlder = false, onLoadOlder, onRetry, now, bot, bots, onClose, onStop, stopping = false, onSend, waiting, composing = false }: CodingChatSheetProps) {
  const chatColumnClassName = useChatColumnClass();
  const column = useExchangePortalHost();
  const shown = detail ?? item;
  const live = activityStatusActive(shown.status);
  const canStop = live && Boolean(onStop) && (detail?.canStop ?? item.canStop ?? false);
  const root = useMemo(() => codingRoot(messages, detail?.code ?? item.code), [messages, detail?.code, item.code]);
  const rows = useMemo(() => codingRows(messages, root), [messages, root]);
  const files = useMemo(() => changedFiles(rows), [rows]);
  const tests = useMemo(() => latestTests(rows), [rows]);
  const place = codingPlace(detail ?? item, root);
  const party = avatarBot({ id: bot?.id ?? shown.botId, name: bot?.name ?? shown.botName ?? t("codingChat.bot"), color: bot?.color }, bots);
  const [compose, setCompose] = useState(composing);
  const [reveal, setReveal] = useState<Reveal | undefined>();
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (document.querySelector("[data-anchored-popover]")) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Follow the bottom while the person is there; a scroll up holds.
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && pinned.current) node.scrollTop = node.scrollHeight;
  }, [rows]);
  const onScroll = () => {
    const node = scroller.current;
    if (node) pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
  };

  const jump = useCallback((file: ChangedFile) => {
    setReveal((current) => ({ rowId: file.rowId, path: file.path, nonce: (current?.nonce ?? 0) + 1 }));
    pinned.current = false;
    window.requestAnimationFrame(() => {
      const row = scroller.current?.querySelector(`[data-coding-row="${CSS.escape(file.rowId)}"] [data-coding-diff="${CSS.escape(file.path)}"]`);
      row?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    });
  }, []);

  const elapsed = formatActivityDuration((shown.endedAt ?? now) - shown.startedAt);
  const folderText = place.folder ?? place.repo;
  const quietStop = "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[12.5px] text-danger hover:bg-danger/10 disabled:opacity-50";

  const sheet = (
    <div
      className="absolute inset-0 z-20 flex min-h-0 flex-col bg-app"
      role="dialog"
      aria-modal="false"
      aria-label={t("codingChat.aria", { title: activityTitle(shown) })}
      data-testid="coding-chat"
      data-coding-status={shown.status}
    >
      <header className="relative flex shrink-0 flex-col items-center gap-1.5 px-12 pb-2 pt-6">
        <div className="flex items-center gap-1.5 rounded-full bg-elevated px-3 py-1.5">
          <PartyAvatar id={party.id} bot={party} size={18} />
          <span className="text-[13px] font-medium" style={{ color: mausInk(party.color) }}>{party.name}</span>
        </div>
        <h2 data-coding-title dir="auto" className="line-clamp-2 max-w-[min(92%,40rem)] text-center text-[14px] font-medium leading-5 text-ink">{activityTitle(shown)}</h2>
        <div data-coding-meta className="flex max-w-[min(92%,40rem)] flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[12px] text-ink-secondary">
          {folderText && (
            <span data-coding-folder className="inline-flex min-w-0 items-center gap-1" title={place.repo ?? place.folder}>
              <Folder size={12} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{folderText}</span>
            </span>
          )}
          {place.branch && (
            <span className="inline-flex min-w-0 items-center gap-1" title={place.branch}>
              <GitBranch size={12} aria-hidden="true" className="shrink-0" />
              <span className="truncate font-mono text-[11.5px]">{place.branch}</span>
            </span>
          )}
          <span data-coding-state={shown.status} className="inline-flex items-center gap-1.5">
            <ActivityStatusIcon status={shown.status} size={13} />
            <span>{activityStatusLabel(shown.status)}</span>
            <span aria-hidden="true">·</span>
            <span data-coding-elapsed className="tabular-nums">{elapsed}</span>
          </span>
        </div>
      </header>

      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-5" data-testid="coding-chat-scroll">
        <div className={cn(chatColumnClassName, "flex flex-col gap-3 py-6")} role="log" aria-live="off">
          {hasMore && onLoadOlder && (
            <button type="button" data-coding-older onClick={onLoadOlder} disabled={loadingOlder} className="self-center rounded-full bg-raised px-3 py-1 text-[12.5px] text-ink-secondary hover:bg-raised-hover disabled:opacity-60">
              {loadingOlder ? t("codingChat.loadingOlder") : t("codingChat.loadOlder")}
            </button>
          )}
          {failed && rows.length === 0 ? (
            <div role="alert" data-coding-error className="flex flex-col items-center gap-2 py-8 text-center text-[13px] text-ink-secondary">
              <p>{t("chat.exchange.loadError")}</p>
              {onRetry && <button type="button" onClick={onRetry} className="rounded-full bg-raised px-3 py-1 text-[12.5px] text-ink hover:bg-raised-hover">{t("chat.retry")}</button>}
            </div>
          ) : !loaded && rows.length === 0 ? (
            <div role="status" data-coding-loading className="flex justify-center py-8 text-ink-secondary">
              <Loader2 size={18} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              <span className="sr-only">{t("sideThread.loading")}</span>
            </div>
          ) : rows.length === 0 ? (
            <p role="status" data-coding-empty className="py-8 text-center text-[13px] text-ink-secondary">{live ? t("codingChat.starting") : t("codingChat.empty")}</p>
          ) : null}
          {rows.map((row, index) => <Row key={row.id} row={row} previous={rows[index - 1]} bot={party} bots={bots} reveal={reveal} />)}
          {live && rows.length > 0 && (
            <p data-coding-working className="flex items-center gap-1.5 ps-1 text-[12px] text-ink-secondary">
              <Loader2 size={13} aria-hidden="true" className="animate-spin text-accent-text motion-reduce:animate-none" />
              {shown.currentStep ? t("codingChat.workingOn", { step: shown.currentStep.length > 80 ? `${shown.currentStep.slice(0, 80)}…` : shown.currentStep }) : t("codingChat.working")}
            </p>
          )}
        </div>
      </div>

      {waiting && <div className="max-h-[40%] shrink-0 overflow-y-auto overscroll-contain px-5 pb-2"><div className={chatColumnClassName}>{waiting}</div></div>}

      <ChangesBand files={files} tests={tests} place={place} onJump={jump} />

      <div data-exchange-footer="" data-coding-actions className="flex shrink-0 flex-wrap items-center justify-center gap-2 bg-app px-4 py-3">
        {compose && onSend ? (
          <FollowUp
            botName={party.name}
            onCancel={() => setCompose(false)}
            onSend={async (text) => {
              await onSend(text);
              pinned.current = true;
              setCompose(false);
            }}
          />
        ) : onSend && (
          <button type="button" data-coding-continue onClick={() => setCompose(true)} className={cn(PRIMARY_PILL, "gap-1.5")}>
            <MessageSquareText size={13} aria-hidden="true" />
            {t("codingChat.continue")}
          </button>
        )}
        {canStop && (
          <button type="button" data-coding-stop onClick={onStop} disabled={stopping} className={quietStop}>
            {stopping ? <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Square size={12} fill="currentColor" aria-hidden="true" />}
            {t("routineRun.stop")}
          </button>
        )}
        <button type="button" data-testid="bot-exchange-close" data-coding-close onClick={onClose} className={PILL}>
          {t("chat.exchange.closeChat")}
        </button>
      </div>
    </div>
  );
  return column ? createPortal(sheet, column) : sheet;
}

/** The task's thread, read and followed (a child so the hook runs only with a thread). */
function ThreadTranscript({ threadId, children }: { threadId: string; children: (transcript: ReturnType<typeof useSideTranscript>) => ReactNode }) {
  const transcript = useSideTranscript(threadId);
  return <>{children(transcript)}</>;
}

/** Fetching, polling, Stop and the follow-up around the sheet. */
export function CodingChat({ target, onClose }: { target: CodingChatTarget; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [detail, setDetail] = useState<BotActivityDetail | null>(null);
  const [error, setError] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [followUntil, setFollowUntil] = useState(0);

  const load = useCallback(() => loadBotActivityDetail(api, target.botId, target.itemId)
    .then((next) => { setDetail(next); setError(false); })
    .catch(() => setError(true)), [target.botId, target.itemId]);
  // A new task starts blank; a reload of the same one keeps what is shown.
  useEffect(() => { setDetail(null); setError(false); void load(); }, [load]);

  const item: BotActivityItem = detail ?? target.seed ?? { id: target.itemId, kind: "session", botId: target.botId, title: "", status: "running", startedAt: now, updatedAt: now, ...(target.threadId ? { threadId: target.threadId } : {}) };
  const live = activityStatusActive(item.status);
  const following = live || followUntil > now;
  useEffect(() => {
    if (!following) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    const poll = window.setInterval(() => void load(), POLL_MS);
    return () => { window.clearInterval(tick); window.clearInterval(poll); };
  }, [following, load]);

  const sources = useMemo(() => waitingSources(detail), [detail]);
  const waitingCards = useWaitingCards(item.status === "waiting" ? sources : [], `${detail?.updatedAt ?? ""}:${item.status}`);
  const botFor = (botId: string) => state.bots.find((candidate) => candidate.id === botId);
  const bot = botFor(target.botId);
  const threadId = target.threadId ?? detail?.threadId ?? item.threadId;

  const stop = () => {
    setStopping(true);
    const finish = () => { setStopping(false); void load(); };
    if (target.itemId.startsWith("cloud:")) {
      void api(`/api/bots/${encodeURIComponent(target.botId)}/cloud-agents/${encodeURIComponent(target.itemId.slice("cloud:".length))}/cancel`, { method: "POST" })
        .catch(() => {})
        .finally(finish);
      return;
    }
    if (!threadId) { setStopping(false); return; }
    if (item.parallel) dispatch({ type: "stopParallelTask", botId: target.botId, threadId });
    else dispatch({ type: "interrupt", botId: target.botId, threadId, onError: () => setStopping(false) });
    window.setTimeout(finish, 1_500);
  };

  const send = threadId ? async (text: string) => {
    await api(`/api/bots/${encodeURIComponent(target.botId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ text, threadId, sendId: crypto.randomUUID(), ...(live ? { busyMode: "steer" } : {}) }),
    });
    setFollowUntil(Date.now() + FOLLOW_MS);
    void load();
  } : undefined;

  const waiting = waitingCards.length > 0 && threadId
    ? <WaitingOnYou items={waitingCards} threadId={threadId} botFor={botFor} onCancel={stop} />
    : undefined;

  const common = {
    item,
    detail,
    now,
    bot,
    bots: state.bots,
    onClose,
    onStop: stop,
    stopping,
    onSend: send,
    waiting,
  };
  if (!threadId) {
    const messages = detail ? stepMessages(detail.steps, item.botId, bot?.name ?? item.botName ?? "") : [];
    return <CodingChatSheet {...common} messages={messages} loaded={detail !== null} failed={error} onRetry={() => void load()} />;
  }
  return (
    <ThreadTranscript threadId={threadId}>{(transcript) => (
      <CodingChatSheet
        {...common}
        messages={transcript.messages}
        loaded={transcript.loaded}
        failed={transcript.failed}
        hasMore={transcript.hasMore}
        loadingOlder={transcript.loadingOlder}
        onLoadOlder={transcript.loadOlder}
      />
    )}</ThreadTranscript>
  );
}
