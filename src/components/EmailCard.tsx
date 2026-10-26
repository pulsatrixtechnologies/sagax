// An email the bot drafted, shown the way a mail client would: header rows,
// a formatted body, and what a person does with a draft here: edit it
// (To, Cc, Subject, body), copy it, copy it with formatting for a rich
// editor, open it in their mail app, or send it.
//
// "Envoyer" never sends from here (2026-10-16, shared/email-draft-send.ts):
// it asks the server for an approval card in the conversation, and only the
// person's Allow on that card sends it, once, through a connector that can
// send (the bot's Microsoft 365, Outlook or Gmail connector, or the
// server's mail). The card follows the send: waiting, sending, sent, or the
// error with Retry, which asks again.
import { memo, useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertCircle, Check, ClipboardCopy, Copy, Mail, Pencil, Send, ShieldCheck, SquareArrowOutUpRight } from "lucide-react";

import { t } from "@/lib/i18n";
import { emailMailtoUrl, emailPlainBody, emailPlainText, type EmailDraft } from "@/lib/rich-blocks";
import { api, ApiError } from "@/state/store";
import { emailDraftKey, type EmailSendStatus } from "../../shared/email-draft-send";
import { useCopyFeedback } from "./rich-ui";

interface SendState {
  status: EmailSendStatus | "asking";
  error?: string;
  connector?: { label: string };
}

const POLL_MS = 2_000;
const HANDOFF_POLL_MS = 15_000;

function splitAddresses(text: string): string[] {
  return text.split(/[,;\n]/).map((address) => address.trim()).filter(Boolean);
}

/** A send refusal in the person's words. */
export function emailSendErrorText(failure: unknown): string {
  if (failure instanceof ApiError) {
    if (failure.body?.code === "no_mail_connector") return t("rich.email.noConnector");
    if (failure.body?.code === "invalid_draft") return t("rich.email.invalid", { detail: failure.message });
    if (failure.body?.code === "email_draft_owner_only") return t("rich.email.ownerOnly");
    if (failure.body?.code === "email_drafts_off") return t("rich.email.draftsOff");
  }
  return failure instanceof Error ? failure.message : String(failure);
}

/** The send of this draft in this conversation: its last state on the
 * server, a way to ask for it, and polling while it moves. */
function useDraftSend(threadId: string | undefined, botId: string | undefined, draftKey: string) {
  const [state, setState] = useState<SendState | null>(null);
  const read = useCallback(async () => {
    if (!threadId) return;
    try {
      const body = await api<{ send: { status: EmailSendStatus; error?: string; connector?: { label: string } } | null }>(
        `/api/threads/${encodeURIComponent(threadId)}/email-drafts/${encodeURIComponent(draftKey)}`,
      );
      if (body.send) setState({ status: body.send.status, ...(body.send.error ? { error: body.send.error } : {}), ...(body.send.connector ? { connector: body.send.connector } : {}) });
    } catch {
      // a read that fails keeps what the card shows
    }
  }, [threadId, draftKey]);
  useEffect(() => {
    void read();
  }, [read]);
  const moving = state?.status === "pending" || state?.status === "sending" || state?.status === "handed-off";
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => void read(), state?.status === "handed-off" ? HANDOFF_POLL_MS : POLL_MS);
    return () => clearInterval(timer);
  }, [moving, state?.status, read]);
  const ask = useCallback(async (draft: EmailDraft) => {
    if (!threadId) return;
    setState({ status: "asking" });
    try {
      const body = await api<{ status: EmailSendStatus; connector?: { label: string } }>(`/api/threads/${encodeURIComponent(threadId)}/email-drafts`, {
        method: "POST",
        body: JSON.stringify({ botId, draftKey, draft: { to: draft.to, cc: draft.cc, bcc: draft.bcc, subject: draft.subject, body: draft.body } }),
      });
      setState({ status: body.status, ...(body.connector ? { connector: body.connector } : {}) });
    } catch (failure) {
      setState({ status: "failed", error: emailSendErrorText(failure) });
    }
  }, [threadId, botId, draftKey]);
  return { state, ask };
}

function SendStatusLine({ state }: { state: SendState }) {
  if (state.status === "failed") return null;
  const text = state.status === "asking" || state.status === "pending" ? t("rich.email.status.pending")
    : state.status === "sending" ? t("rich.email.status.sending")
      : state.status === "handed-off" ? t("rich.email.status.handedOff", { connector: state.connector?.label ?? "" })
        : state.status === "sent" ? t("rich.email.status.sent")
          : t("rich.email.status.denied");
  const Icon = state.status === "sent" ? Check : ShieldCheck;
  return (
    <span role="status" data-email-send-status={state.status} className="inline-flex items-center gap-1 text-[11.5px] text-ink-secondary">
      <Icon size={12} aria-hidden="true" className={state.status === "sent" ? "text-success" : "text-accent"} />
      {text}
    </span>
  );
}

/** Open a mailto: URL. In the desktop app window.open reaches the main
 * process' window-open handler, which validates the scheme and hands it to
 * the OS; in a browser the anchor's own navigation does the job. */
function openMailto(url: string, event: { preventDefault(): void }) {
  if (typeof window !== "undefined" && window.ogb) {
    event.preventDefault();
    window.open(url, "_blank", "noopener");
  }
}

function HeaderRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 gap-3 py-1">
      <dt className="w-16 shrink-0 text-[12px] text-ink-secondary">{label}</dt>
      <dd className="min-w-0 break-words text-[12.5px] text-ink">{value}</dd>
    </div>
  );
}

function EmailCardComponent({ draft: written, pending = false, threadId, botId, draftsEnabled = true }: {
  draft: EmailDraft;
  pending?: boolean;
  /** The conversation and bot the draft is in: without them there is no send. */
  threadId?: string;
  botId?: string;
  /** False: this bot's drafts are off. The card stays, Send does not. */
  draftsEnabled?: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const { copied, copy } = useCopyFeedback();
  const [notice, setNotice] = useState("");
  const [edited, setEdited] = useState<EmailDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const draft = edited ?? written;
  const mailto = emailMailtoUrl(draft);
  // the key is the draft as the bot wrote it: the send is found again after
  // a reload even when the person edited it before sending
  const { state: send, ask } = useDraftSend(threadId, botId, emailDraftKey(written));
  const locked = send !== null && send.status !== "failed" && send.status !== "denied";
  const canSend = draftsEnabled && Boolean(threadId) && !pending && draft.to.length > 0;
  const field = (key: "to" | "cc" | "bcc", value: string) => setEdited({ ...draft, [key]: splitAddresses(value) });

  const copyRich = () => {
    // The body was rendered by react-markdown without raw HTML, so its markup
    // is our own elements and escaped text: safe to hand to a rich editor.
    const html = bodyRef.current?.innerHTML ?? "";
    const subject = draft.subject ? `<p><strong>${escapeHtml(draft.subject)}</strong></p>` : "";
    void copy("rich", emailPlainBody(draft.body), `<meta charset="utf-8">${subject}${html}`);
  };

  return (
    <article dir="auto" aria-label={t("rich.email.aria", { subject: draft.subject || t("rich.email.noSubject") })} className="my-2 min-w-0 overflow-hidden rounded-xl border border-hairline/40 bg-panel shadow-sm">
      <header className="flex items-center gap-2 border-b border-hairline/30 bg-raised/30 px-3 py-2 text-[12px] text-ink-secondary">
        <Mail size={14} aria-hidden="true" />
        <span className="font-medium text-ink">{t("rich.email.title")}</span>
        {draft.to.length > 0 && <span data-email-created-for className="min-w-0 truncate">{t("rich.email.createdFor", { who: draft.to.join(", ") })}</span>}
        {pending && <span className="ms-auto text-[11px]">{t("rich.pending")}</span>}
      </header>
      {!draftsEnabled && <p role="status" data-email-drafts-off className="border-b border-hairline/30 px-3 py-2 text-[12px] text-ink-secondary">{t("rich.email.draftsOff")}</p>}
      {editing ? (
        <div className="flex flex-col gap-1.5 border-b border-hairline/30 px-3 py-2" data-email-editor>
          {(["to", "cc", "bcc"] as const).map((key) => (
            <label key={key} className="flex min-w-0 items-center gap-3">
              <span className="w-16 shrink-0 text-[12px] text-ink-secondary">{t(`rich.email.${key}`)}</span>
              <input
                type="text"
                inputMode="email"
                defaultValue={draft[key].join(", ")}
                placeholder={key === "to" ? t("rich.email.addressesHint") : undefined}
                onChange={(event) => field(key, event.target.value)}
                className="min-w-0 flex-1 rounded-md bg-raised px-2 py-1 text-[12.5px] text-ink outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
          ))}
          <label className="flex min-w-0 items-center gap-3">
            <span className="w-16 shrink-0 text-[12px] text-ink-secondary">{t("rich.email.subject")}</span>
            <input
              type="text"
              value={draft.subject}
              onChange={(event) => setEdited({ ...draft, subject: event.target.value })}
              className="min-w-0 flex-1 rounded-md bg-raised px-2 py-1 text-[13px] font-semibold text-ink outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
          <textarea
            value={draft.body}
            rows={Math.min(16, Math.max(5, draft.body.split("\n").length + 1))}
            aria-label={t("rich.email.bodyLabel")}
            onChange={(event) => setEdited({ ...draft, body: event.target.value })}
            className="mt-1 rounded-md bg-raised px-2 py-1.5 text-[13px] leading-5 text-ink outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      ) : (
        <>
        <dl className="divide-y divide-hairline/20 border-b border-hairline/30 px-3 py-1">
          {draft.from && <HeaderRow label={t("rich.email.from")} value={draft.from} />}
          {draft.to.length > 0 && <HeaderRow label={t("rich.email.to")} value={draft.to.join(", ")} />}
          {draft.cc.length > 0 && <HeaderRow label={t("rich.email.cc")} value={draft.cc.join(", ")} />}
          {draft.bcc.length > 0 && <HeaderRow label={t("rich.email.bcc")} value={draft.bcc.join(", ")} />}
          <div className="flex min-w-0 gap-3 py-1">
            <dt className="w-16 shrink-0 text-[12px] text-ink-secondary">{t("rich.email.subject")}</dt>
            <dd className="min-w-0 break-words text-[13px] font-semibold text-ink">{draft.subject || <span className="font-normal text-ink-secondary">{t("rich.email.noSubject")}</span>}</dd>
          </div>
        </dl>
        <div ref={bodyRef} className="space-y-2 px-4 py-3 text-[13px] leading-5 text-ink [&_p]:whitespace-pre-line [&_a]:text-accent [&_a]:underline [&_li]:ms-5 [&_ol]:list-decimal [&_ul]:list-disc">
          <Markdown remarkPlugins={[remarkGfm]} components={{
            a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
            img: ({ alt }) => <span>{alt}</span>,
          }}>
            {draft.body}
          </Markdown>
        </div>
        </>
      )}
      <footer className="flex flex-wrap items-center gap-1.5 border-t border-hairline/30 bg-raised/20 px-3 py-2">
        <button
          type="button"
          onClick={() => void copy("plain", emailPlainText(draft))}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-hairline/40 bg-panel px-2.5 text-[12px] text-ink hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {copied === "plain" ? <Check size={13} className="text-success" aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          {copied === "plain" ? t("rich.copied") : t("rich.email.copy")}
        </button>
        <button
          type="button"
          onClick={copyRich}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-hairline/40 bg-panel px-2.5 text-[12px] text-ink hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {copied === "rich" ? <Check size={13} className="text-success" aria-hidden="true" /> : <ClipboardCopy size={13} aria-hidden="true" />}
          {copied === "rich" ? t("rich.copied") : t("rich.email.copyRich")}
        </button>
        <a
          href={mailto.url}
          onClick={(event) => {
            if (!mailto.bodyIncluded && draft.body) {
              void copy("rich-body", emailPlainBody(draft.body));
              setNotice(t("rich.email.bodyCopied"));
            }
            openMailto(mailto.url, event);
          }}
          className={threadId
            ? "inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-hairline/40 bg-panel px-2.5 text-[12px] text-ink hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            : "inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-[12px] font-medium text-accent-ink hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"}
        >
          <SquareArrowOutUpRight size={13} aria-hidden="true" />
          {t("rich.email.open")}
        </a>
        {notice && <span role="status" className="text-[11.5px] text-ink-secondary">{notice}</span>}
        {threadId && !pending && !locked && (
          <button
            type="button"
            onClick={() => setEditing((value) => !value)}
            aria-pressed={editing}
            data-email-edit
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-hairline/40 bg-panel px-2.5 text-[12px] text-ink hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <Pencil size={13} aria-hidden="true" />
            {editing ? t("rich.email.done") : t("rich.email.edit")}
          </button>
        )}
        {edited && !editing && <span className="text-[11px] text-ink-tertiary">{t("rich.email.edited")}</span>}
        {canSend && !locked && (
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              void ask(draft);
            }}
            title={t("rich.email.sendHint")}
            data-email-send
            className="ms-auto inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-[12px] font-medium text-accent-ink hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <Send size={13} aria-hidden="true" />
            {send?.status === "failed" ? t("rich.email.retry") : t("rich.email.send")}
          </button>
        )}
        {send && <span className="ms-auto"><SendStatusLine state={send} /></span>}
      </footer>
      {send?.status === "failed" && (
        <div role="alert" data-email-send-error className="flex items-start gap-1.5 border-t border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{send.error ? t("rich.email.sendErrorDetail", { error: send.error }) : t("rich.email.sendError")}</span>
        </div>
      )}
    </article>
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export const EmailCard = memo(EmailCardComponent, (previous, next) =>
  previous.pending === next.pending && previous.threadId === next.threadId && previous.botId === next.botId && previous.draftsEnabled === next.draftsEnabled
  && JSON.stringify(previous.draft) === JSON.stringify(next.draft));
