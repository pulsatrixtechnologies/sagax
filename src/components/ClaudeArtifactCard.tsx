// A claude.ai artifact in a chat (#2018): the server reads it with the
// engine's own claude.ai session and this card shows what came back, as
// plain text only (no HTML, no iframe). An artifact of another account
// becomes the consent card; an owned one lists its open comment threads.
// Same family as ArtifactCard: hairline border, raised header, small Open.
import { memo, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Check, Copy, Globe, LogIn, MessageSquare, Reply, RotateCw, SquareArrowOutUpRight } from "lucide-react";

import { t } from "@/lib/i18n";
import { relativeTime } from "@/lib/memory";
import { openClaudeEngineSettings } from "@/lib/settings-link";
import { useStoreOptional } from "@/state/store";
import {
  bumpClaudeArtifact,
  noteClaudeArtifactPublish,
  openClaudeArtifact,
  replyClaudeArtifactComment,
  resolveClaudeArtifactComment,
  useClaudeArtifact,
  useClaudeArtifactComments,
  type ClaudeArtifactThread,
} from "@/lib/claude-artifacts";

const CARD = "my-2 min-w-0 overflow-hidden rounded-xl border border-hairline/40 bg-panel shadow-sm";
const HEADER = "flex items-center gap-2 border-b border-hairline/30 bg-raised/30 px-3 py-2 text-[12px] text-ink-secondary";
const BUTTON = "inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-hairline/40 bg-panel px-2.5 text-[12px] text-ink hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50";
const PILL = "rounded-full border border-hairline/40 px-2 py-0.5 text-[11px] text-ink-secondary";

function when(value: string | undefined): { label: string; full: string } | null {
  if (!value) return null;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  return { label: relativeTime(at), full: new Date(at).toLocaleString() };
}

function OpenButton({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        event.preventDefault();
        openClaudeArtifact(url);
      }}
      className={BUTTON}
    >
      <SquareArrowOutUpRight size={13} aria-hidden="true" />
      {t("rich.artifact.open")}
    </a>
  );
}

function Shell({ title, pending, children, label }: { title: string; pending?: boolean; children: ReactNode; label: string }) {
  return (
    <article dir="auto" aria-label={label} className={CARD} data-claude-artifact="">
      <header className={HEADER}>
        <Globe size={14} aria-hidden="true" />
        <span className="font-medium text-ink">{title}</span>
        {pending && <span className="ms-auto text-[11px]">{t("rich.pending")}</span>}
      </header>
      {children}
    </article>
  );
}

/** Another claude.ai account owns it: name the engine's account and offer a
 * copy published by the bot, or a switch of the engine's account. */
export function ClaudeArtifactConsentCard({ url, account, onSendToBot }: { url: string; account?: string; onSendToBot?: (text: string) => void }) {
  const store = useStoreOptional();
  const [sent, setSent] = useState(false);
  return (
    <Shell title={t("rich.claudeArtifact.consentTitle")} label={t("rich.claudeArtifact.consentAria")}>
      <div className="flex flex-col gap-3 px-3 py-3" data-claude-artifact-consent="">
        <p className="break-words text-[13px] text-ink">
          {account ? t("rich.claudeArtifact.consentBodyAccount", { account }) : t("rich.claudeArtifact.consentBody")}
        </p>
        <p className="break-all text-[11px] text-ink-secondary">{url}</p>
        <div className="flex flex-wrap items-center gap-2">
          {onSendToBot && (
            <button
              type="button"
              className={BUTTON}
              disabled={sent}
              onClick={() => {
                onSendToBot(t("rich.claudeArtifact.copyPrompt", { url }));
                setSent(true);
              }}
            >
              <Copy size={13} aria-hidden="true" />
              {sent ? t("rich.claudeArtifact.copySent") : t("rich.claudeArtifact.copy")}
            </button>
          )}
          <button
            type="button"
            className={BUTTON}
            disabled={!store}
            onClick={() => { if (store) openClaudeEngineSettings(store.dispatch); }}
          >
            <LogIn size={13} aria-hidden="true" />
            {t("rich.claudeArtifact.reconnect")}
          </button>
        </div>
      </div>
    </Shell>
  );
}

function CommentThreadCard({ url, title, thread }: { url: string; title: string; thread: ClaudeArtifactThread }) {
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const at = when(thread.createdAt);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setFailed(false);
    try {
      await work();
      setReplying(false);
      setDraft("");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    void run(() => replyClaudeArtifactComment(url, thread.id, body));
  };
  return (
    <article dir="auto" className={CARD} data-claude-artifact-comment={thread.id} aria-label={t("rich.claudeArtifact.commentOn", { title })}>
      <header className={HEADER}>
        <MessageSquare size={14} aria-hidden="true" />
        <span className="min-w-0 truncate font-medium text-ink">{t("rich.claudeArtifact.commentOn", { title })}</span>
      </header>
      <div className="flex flex-col gap-2 px-3 py-3">
        <div className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-ink-secondary">
          <span className="font-medium text-ink">{thread.author ?? t("rich.claudeArtifact.someone")}</span>
          {at && <time dateTime={thread.createdAt} title={at.full}>{at.label}</time>}
        </div>
        <p className="whitespace-pre-wrap break-words text-[13px] text-ink">{thread.text}</p>
        {thread.replies.length > 0 && (
          <ul className="flex flex-col gap-1.5 border-s-2 border-hairline/40 ps-3">
            {thread.replies.map((reply, index) => {
              const replyAt = when(reply.createdAt);
              return (
                <li key={index} className="text-[12px]">
                  <span className="font-medium text-ink">{reply.author ?? t("rich.claudeArtifact.someone")}</span>
                  {replyAt && <time className="ms-2 text-[11px] text-ink-secondary" dateTime={reply.createdAt} title={replyAt.full}>{replyAt.label}</time>}
                  <p className="whitespace-pre-wrap break-words text-ink">{reply.text}</p>
                </li>
              );
            })}
          </ul>
        )}
        {replying ? (
          <form className="flex flex-wrap items-center gap-2" onSubmit={submit}>
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label={t("rich.claudeArtifact.replyLabel")}
              placeholder={t("rich.claudeArtifact.replyPlaceholder")}
              className="min-h-8 min-w-0 flex-1 rounded-lg border border-hairline/40 bg-panel px-2.5 text-[12px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            />
            <button type="submit" className={BUTTON} disabled={busy || !draft.trim()}>{t("rich.claudeArtifact.send")}</button>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => { setReplying(false); setDraft(""); }}>{t("rich.claudeArtifact.cancel")}</button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BUTTON} disabled={busy} onClick={() => setReplying(true)}>
              <Reply size={13} aria-hidden="true" />
              {t("rich.claudeArtifact.reply")}
            </button>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => void run(() => resolveClaudeArtifactComment(url, thread.id))}>
              <Check size={13} aria-hidden="true" />
              {t("rich.claudeArtifact.resolve")}
            </button>
          </div>
        )}
        {failed && <p role="alert" className="text-[12px] text-danger">{t("rich.claudeArtifact.commentFailed")}</p>}
      </div>
    </article>
  );
}

function CommentThreads({ url, title }: { url: string; title: string }) {
  const threads = useClaudeArtifactComments(url, true);
  const open = (threads ?? []).filter((thread) => thread.status !== "resolved");
  if (!open.length) return null;
  return (
    <div className="flex flex-col" data-claude-artifact-comments="">
      {open.map((thread) => <CommentThreadCard key={thread.id} url={url} title={title} thread={thread} />)}
    </div>
  );
}

function ClaudeArtifactCardComponent({ url, title: hint, pending = false, publishKey, onSendToBot }: {
  url: string;
  title?: string;
  pending?: boolean;
  /** a publish fence's place (message and offset): a new one of a url already
   * shown refreshes every card of that url */
  publishKey?: string;
  onSendToBot?: (text: string) => void;
}) {
  useEffect(() => { if (publishKey) noteClaudeArtifactPublish(url, publishKey); }, [url, publishKey]);
  const state = useClaudeArtifact(url);
  const store = useStoreOptional();
  const header = t("rich.claudeArtifact.title");

  if (state.kind === "blocked") return <ClaudeArtifactConsentCard url={url} account={state.blocked.account} onSendToBot={onSendToBot} />;

  if (state.kind === "loading") {
    return (
      <Shell title={header} pending={pending} label={t("rich.artifact.aria", { title: hint || header })}>
        <div className="flex flex-wrap items-center gap-2 px-3 py-3" aria-busy="true">
          <p className="min-w-0 flex-1 break-words text-[13px] font-semibold text-ink">{hint || t("rich.claudeArtifact.loading")}</p>
          <OpenButton url={url} />
        </div>
      </Shell>
    );
  }

  if (state.kind === "signedOut" || state.kind === "error") {
    return (
      <Shell title={header} pending={pending} label={t("rich.artifact.aria", { title: hint || header })}>
        <div className="flex flex-col gap-2 px-3 py-3">
          {hint && <p className="min-w-0 break-words text-[13px] font-semibold text-ink">{hint}</p>}
          <p role="status" className="text-[12px] text-ink-secondary">
            {state.kind === "signedOut" ? t("rich.claudeArtifact.signedOut") : t("rich.claudeArtifact.error")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <OpenButton url={url} />
            {state.kind === "signedOut" ? (
              <button type="button" className={BUTTON} disabled={!store} onClick={() => { if (store) openClaudeEngineSettings(store.dispatch); }}>
                <LogIn size={13} aria-hidden="true" />
                {t("rich.claudeArtifact.reconnect")}
              </button>
            ) : (
              <button type="button" className={BUTTON} onClick={() => bumpClaudeArtifact(url)}>
                <RotateCw size={13} aria-hidden="true" />
                {t("rich.claudeArtifact.retry")}
              </button>
            )}
          </div>
        </div>
      </Shell>
    );
  }

  const { summary } = state;
  const title = summary.title || hint || header;
  const updated = when(summary.updatedAt);
  return (
    <>
      <Shell title={header} pending={pending} label={t("rich.artifact.aria", { title })}>
        <div className="flex flex-col gap-2 px-3 py-3" data-claude-artifact-owned={summary.owned ? "true" : "false"}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 break-words text-[13px] font-semibold text-ink">{title}</p>
            <OpenButton url={url} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-secondary">
            <span className={PILL}>{summary.owned ? t("rich.claudeArtifact.owned") : t("rich.claudeArtifact.shared")}</span>
            {updated && <time dateTime={summary.updatedAt} title={updated.full}>{t("rich.claudeArtifact.updated", { when: updated.label })}</time>}
          </div>
          {summary.summary && <p className="line-clamp-4 whitespace-pre-wrap break-words text-[12px] text-ink-secondary">{summary.summary}</p>}
        </div>
      </Shell>
      {summary.owned && <CommentThreads url={url} title={title} />}
    </>
  );
}

export const ClaudeArtifactCard = memo(ClaudeArtifactCardComponent);
