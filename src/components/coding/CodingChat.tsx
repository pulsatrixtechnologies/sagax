// A coding task opened as a chat where the chat is (JC, 2026-11-03): the bot
// panel's Coding list is the entry point, a row opens this sheet over the
// chat column (ExchangeSheet shell), drawn for development. A routine run
// no longer opens a sheet: it opens in the chat (#2098).
//
// Drawn like the Claude Code terminal (JC, 2026-11-05, #2099 + #2108):
// - Header (#2108 + #2149): compact, left-aligned. Back arrow (the chat is one
//   chat: no thread to close), small mascot + bot name, task title truncated
//   on one line (click or chevron expands it), Stop at the right of the title
//   line, the </> button of the dev pods, then a muted meta line: folder ·
//   branch · status glyph + human phrase · duration · tokens when known.
// - Transcript (#2099): the task's own thread (useSideTranscript: the newest
//   page, older pages on demand, then the live frames). A person's words are a
//   highlighted row with "›", the bot's plain text; every tool call is one
//   ToolLine (`● Bash(pnpm vitest run …)` then `⎿` the first lines of its
//   result and "… +N lines"; an edit `⎿ +2 -0` with its diff folded). A task
//   the viewer may not read the thread of shows its steps (the activity
//   entry's).
// - Changes band, above the composer: files changed with their counts (a
//   click jumps to the file's diff and opens it), the newest test run, the
//   commit and pull request its own calls made (the branch is in the header).
// - Footer: the chat's own composer ("Message <bot>", with +, the microphone
//   and voice), always there like Claude Code's prompt; a message goes to the
//   task's thread, joining the turn while it runs. No Continue, no Close
//   Chat, no Open thread.
// - The dev pods (</>: Environment, Connectors, Context, Changes) live here
//   only, never in the plain chat (#2149).
//
// The activity entry is polled every 3 s while the task runs (and a while
// after a follow-up, until the new turn shows); a reload keeps what is on
// screen, so a status change never blanks the sheet.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, ChevronDown, ChevronLeft, ChevronUp, GitCommitHorizontal, GitPullRequest, Loader2, Square } from "lucide-react";

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
  codingTokens,
  humanStep,
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
import { mausInk } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { formatTokens } from "@/lib/usage";
import { avatarBot, useExchangePortalHost } from "../BotExchangeChip";
import { Composer } from "../Composer";
import { DevPods, DevPodsToggle } from "../dev-pods/DevPods";
import { ChatMarkdown } from "../ChatMarkdown";
import { MessageBoundary } from "../MessageBoundary";
import { PartyAvatar } from "../PartyAvatar";
import { WaitingOnYou } from "../task/WaitingOnYou";
import { TestCounts, ToolLine } from "./ToolLine";

const POLL_MS = 3_000;
/** After a follow-up, keep reading the entry this long so the new turn shows. */
const FOLLOW_MS = 30_000;

export type { CodingChatTarget };

type Reveal = { rowId: string; path: string; nonce: number };

/** A person's words: a quietly highlighted row with "›" (the terminal's
 * prompt). The bot's words: plain text between the tool lines. */
function Line({ message, bot, bots }: { message: Message; bot: { name: string; color: string } & Partial<Bot>; bots: readonly Bot[] }) {
  const mine = message.role === "user";
  const speaker = mine ? null : message.from?.botId ? avatarBot({ id: message.from.botId, name: message.from.name ?? bot.name, color: message.from.color }, bots) : bot;
  const text = message.text ?? "";
  if (mine) {
    return (
      <div data-mid={message.id} data-coding-line="user" className="flex gap-2 rounded-lg bg-raised/60 px-3 py-1.5 text-[13px] leading-5 text-ink">
        <span aria-hidden="true" className="shrink-0 select-none font-mono text-ink-tertiary">›</span>
        <div className="min-w-0 flex-1">
          <MessageBoundary fallbackText={text}><ChatMarkdown text={text} /></MessageBoundary>
        </div>
      </div>
    );
  }
  return (
    <div data-mid={message.id} data-coding-line="bot" className="px-1 text-[13px] leading-5 text-ink">
      <MessageBoundary fallbackText={text}>
        <ChatMarkdown text={text} botId={speaker?.id} />
      </MessageBoundary>
    </div>
  );
}

function Row({ row, bot, bots, reveal }: { row: CodingRow; bot: { name: string; color: string } & Partial<Bot>; bots: readonly Bot[]; reveal?: Reveal }) {
  if (row.kind === "line") return <Line message={row.message} bot={bot} bots={bots} />;
  return <ToolLine row={row} reveal={reveal?.rowId === row.id ? { path: reveal.path, nonce: reveal.nonce } : undefined} />;
}

/** The band above the footer: what changed, the newest tests, and where it
 * went (commit, pull request; the branch is in the header). Drawn only when
 * there is something. */
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

/** The composer, always in the footer like Claude Code's prompt: Enter sends,
 * Shift+Enter a new line. */
function FollowUp({ botName, onSend }: { botName: string; onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const field = useRef<HTMLTextAreaElement>(null);
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
  /** The chat's composer aimed at the task's thread (CodingChat); the plain
   * follow-up field stands in without it (tests, galleries). */
  composer?: ReactNode;
  /** The dev pods' rail, anchored in the transcript pane. */
  pods?: ReactNode;
  /** Controls at the header's right end (the </> button). */
  headerTools?: ReactNode;
}

/** The sheet, without fetching: tests and galleries draw it with fixed data. */
export function CodingChatSheet({ item, detail, messages, loaded, failed, hasMore = false, loadingOlder = false, onLoadOlder, onRetry, now, bot, bots, onClose, onStop, stopping = false, onSend, waiting, composer, pods, headerTools }: CodingChatSheetProps) {
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
  const [reveal, setReveal] = useState<Reveal | undefined>();
  const [titleOpen, setTitleOpen] = useState(false);
  const tokens = useMemo(() => codingTokens(messages), [messages]);
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
  // A message the person just sent (from the composer) brings the end back.
  const mine = useMemo(() => messages.filter((message) => message.role === "user").length, [messages]);
  const mineSeen = useRef(mine);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (mine > mineSeen.current) pinned.current = true;
    mineSeen.current = mine;
    if (node && pinned.current) node.scrollTop = node.scrollHeight;
  }, [rows, mine]);
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
  const title = activityTitle(shown);
  const statusGlyph = live ? "○" : "●";
  // Prefer the humanized step from #2099; fall back to the raw step or Working.
  const statusLead = live
    ? (humanStep(shown.currentStep) || shown.currentStep?.trim() || t("codingChat.working"))
    : activityStatusLabel(shown.status);
  const tokensLabel = tokens !== undefined && tokens > 0 ? t("chat.usage.cardTokens", { tokens: formatTokens(tokens) }) : undefined;

  const sheet = (
    <div
      className="absolute inset-0 z-20 flex min-h-0 flex-col bg-app"
      role="dialog"
      aria-modal="false"
      aria-label={t("codingChat.aria", { title })}
      data-testid="coding-chat"
      data-coding-status={shown.status}
    >
      <header data-coding-header className="relative flex shrink-0 flex-col gap-0.5 border-b border-hairline/40 px-3 py-2">
        {headerTools && <div data-coding-tools className="absolute right-3 top-2 z-10 flex items-center gap-1">{headerTools}</div>}
        <div className="flex min-w-0 items-center gap-1.5 pe-10">
          <button
            type="button"
            data-testid="bot-exchange-close"
            data-coding-close
            data-coding-back
            onClick={onClose}
            aria-label={t("codingChat.back")}
            title={t("codingChat.back")}
            className="-ms-1 flex size-7 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <PartyAvatar id={party.id} bot={party} size={16} />
          <span data-coding-bot className="shrink-0 text-[13px] font-medium leading-5" style={{ color: mausInk(party.color) }}>{party.name}</span>
          <button
            type="button"
            data-coding-title-toggle
            aria-expanded={titleOpen}
            aria-label={titleOpen ? t("codingChat.title.collapse") : t("codingChat.title.expand")}
            title={title}
            onClick={() => setTitleOpen((value) => !value)}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-md px-1 py-0.5 text-start hover:bg-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
              titleOpen && "items-start",
            )}
          >
            <h2
              data-coding-title
              dir="auto"
              className={cn(
                "min-w-0 flex-1 text-[13px] font-medium leading-5 text-ink",
                titleOpen ? "whitespace-normal break-words" : "truncate",
              )}
            >{title}</h2>
            <ChevronDown size={13} aria-hidden="true" className={cn("mt-0.5 shrink-0 text-ink-tertiary transition-transform", titleOpen && "rotate-180")} />
          </button>
          {canStop && (
            <button
              type="button"
              data-coding-stop
              data-coding-stop-header
              onClick={onStop}
              disabled={stopping}
              aria-label={t("routineRun.stop")}
              title={t("routineRun.stop")}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-ink-secondary hover:bg-hover hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {stopping ? <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Square size={11} fill="currentColor" aria-hidden="true" />}
              <span className="hidden sm:inline">{t("routineRun.stop")}</span>
            </button>
          )}
        </div>
        <div data-coding-meta className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 ps-8 text-[12px] leading-4 text-ink-secondary">
          {folderText && <span data-coding-folder className="min-w-0 truncate" title={place.repo ?? place.folder}>{folderText}</span>}
          {folderText && place.branch && <span aria-hidden="true">·</span>}
          {place.branch && <span data-coding-branch className="min-w-0 truncate font-mono text-[11.5px]" title={place.branch}>{place.branch}</span>}
          {(folderText || place.branch) && <span aria-hidden="true">·</span>}
          <span data-coding-state={shown.status} className="inline-flex min-w-0 items-center gap-1.5">
            <span data-coding-glyph aria-hidden="true">{statusGlyph}</span>
            <span className={cn("min-w-0 truncate", live && "thinking-shimmer animate-shimmer motion-reduce:animate-none")}>{statusLead}</span>
            <span aria-hidden="true">·</span>
            <span data-coding-elapsed className="tabular-nums">{elapsed}</span>
            {tokensLabel && (
              <>
                <span aria-hidden="true">·</span>
                <span data-coding-tokens className="tabular-nums">{tokensLabel}</span>
              </>
            )}
          </span>
        </div>
      </header>

      <div data-coding-pane className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-5" data-testid="coding-chat-scroll">
        <div className={cn(chatColumnClassName, "flex flex-col gap-2 py-6")} role="log" aria-live="off">
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
          {rows.map((row) => <Row key={row.id} row={row} bot={party} bots={bots} reveal={reveal} />)}
        </div>
      </div>
      {pods}
      </div>

      {waiting && <div className="max-h-[40%] shrink-0 overflow-y-auto overscroll-contain px-5 pb-2"><div className={chatColumnClassName}>{waiting}</div></div>}

      <ChangesBand files={files} tests={tests} place={place} onJump={jump} />

      {composer ? (
        <div data-exchange-footer="" data-coding-actions data-coding-composer className="relative shrink-0 bg-app">
          {composer}
        </div>
      ) : onSend && (
        <div data-exchange-footer="" data-coding-actions className="flex shrink-0 justify-center bg-app px-4 py-3">
          <FollowUp
            botName={party.name}
            onSend={async (text) => {
              await onSend(text);
              pinned.current = true;
            }}
          />
        </div>
      )}
    </div>
  );
  return column ? createPortal(sheet, column) : sheet;
}

/** The task's thread, read and followed (a child so the hook runs only with a thread). */
function ThreadTranscript({ threadId, onGrow, children }: { threadId: string; onGrow: () => void; children: (transcript: ReturnType<typeof useSideTranscript>) => ReactNode }) {
  const transcript = useSideTranscript(threadId);
  // A message sent from the composer: keep reading the entry so the new turn shows.
  const count = transcript.messages.length;
  const seen = useRef(count);
  useEffect(() => {
    if (count > seen.current) onGrow();
    seen.current = count;
  }, [count, onGrow]);
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

  const follow = useCallback(() => setFollowUntil(Date.now() + FOLLOW_MS), []);
  const computerStart = state.computerStarts[target.botId];
  const taskBot = bot && threadId ? { ...bot, threadId } : undefined;
  const headerTools = taskBot ? <DevPodsToggle bot={taskBot} /> : undefined;
  const pods = (messages: readonly Message[]) => taskBot
    ? <DevPods bot={taskBot} messages={messages} composerHeight={0} headerHeight={0} computerStart={computerStart} dispatch={dispatch} forced />
    : undefined;
  // The chat's own composer ("Message <bot>", +, microphone, voice) aimed at
  // the task's thread; a person who may not write there keeps the plain field.
  const composer = taskBot ? <Composer key={threadId} bot={{ ...taskBot, busy: live }} /> : undefined;

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
    headerTools,
  };
  if (!threadId) {
    const messages = detail ? stepMessages(detail.steps, item.botId, bot?.name ?? item.botName ?? "") : [];
    return <CodingChatSheet {...common} messages={messages} loaded={detail !== null} failed={error} onRetry={() => void load()} />;
  }
  return (
    <ThreadTranscript threadId={threadId} onGrow={follow}>{(transcript) => (
      <CodingChatSheet
        {...common}
        composer={composer}
        pods={pods(transcript.messages)}
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
