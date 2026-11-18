// The two X (Twitter) cards of the chat (#4638, shared/x-post.ts has the rules):
//
//   XDraftCard  a post a bot drafted: the person's avatar, "Post" and @handle,
//               Copy, the text editable in place (X's counter, only near the
//               limit), Discard and Post. Post is the person's go: the server
//               hands the bot the exact text and the card follows the post,
//               then turns into the published post with its link. Discard
//               closes it. Nothing is posted by the fence itself.
//   XPostList   what a bot read from X: each post drawn the way x.com draws it
//               (name, badge, @handle, date, text with links, a quoted post as
//               an inner card, media, the row of counts), stacked like a
//               timeline. A click opens the post on x.com.
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/cn";
import { t, activeLocale } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { api } from "@/state/store";
import {
  X_POST_LIMIT,
  isXMediaHost,
  xCount,
  xCounter,
  xDraftKey,
  xPostText,
  type XDraft,
  type XMedia,
  type XPostStatus,
  type XPostView,
} from "../../shared/x-post";
import { useCopyFeedback } from "./rich-ui";

const POLL_MS = 2_000;

// X's own icons (24 px grid), so a post reads like x.com.
const PATHS = {
  reply: "M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z",
  repost: "M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z",
  like: "M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z",
  views: "M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z",
  bookmark: "M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z",
  share: "M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z",
  verified: "M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z",
  logo: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
} as const;

function XIcon({ name, size = 18.75, className }: { name: keyof typeof PATHS; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className={cn("shrink-0 fill-current", className)}>
      <path d={PATHS[name]} />
    </svg>
  );
}

function initialsOf(name: string): string {
  const letters = name.replace(/^@/, "").split(/\s+/).filter(Boolean).slice(0, 2).map((word) => [...word][0]!.toUpperCase());
  return letters.join("") || "X";
}

/** The account picture: X's own CDN loads, anything else shows the initials. */
function XAvatar({ url, name, size = 40 }: { url?: string; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const show = url && isXMediaHost(url) && !failed;
  return (
    <span
      data-x-avatar=""
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-raised text-[13px] font-semibold text-ink-secondary"
    >
      {show ? <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className="size-full object-cover" /> : size >= 32 ? (name ? initialsOf(name) : <XIcon name="logo" size={18} className="text-ink" />) : null}
    </span>
  );
}

function VerifiedBadge() {
  return <XIcon name="verified" size={18} className="text-[#1d9bf0]" />;
}

/** The date as x.com shows it: a short date, with the year only when it is another one. */
export function xDateText(value: string | undefined, now = Date.now()): string {
  if (!value) return "";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(activeLocale().startsWith("fr") ? "fr-CA" : "en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" }).format(date);
}

const LINK = /(https?:\/\/[^\s]+|(?<![\w@])[@#][A-Za-z0-9_]+)/g;

/** The post's text: links, @mentions and #hashtags in X's blue, line breaks kept. Never raw HTML. */
function XText({ text, className }: { text: string; className?: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    const token = match[0];
    if (/^https?:/i.test(token)) {
      const trailing = /[).,;:!?]+$/.exec(token)?.[0] ?? "";
      const address = trailing ? token.slice(0, -trailing.length) : token;
      let shown = address.replace(/^https?:\/\/(www\.)?/i, "");
      if (shown.length > 30) shown = `${shown.slice(0, 29)}…`;
      let safe = false;
      try {
        safe = new URL(address).protocol === "https:" || new URL(address).protocol === "http:";
      } catch {
        safe = false;
      }
      parts.push(safe
        ? <a key={at} href={address} target="_blank" rel="noreferrer noopener" onClick={(event) => event.stopPropagation()} className="text-[#1d9bf0] hover:underline">{shown}</a>
        : address);
      if (trailing) parts.push(trailing);
    } else {
      parts.push(<span key={at} className="text-[#1d9bf0]">{token}</span>);
    }
    last = at + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <div dir="auto" className={cn("whitespace-pre-wrap break-words", className)}>{parts}</div>;
}

// ---------------------------------------------------------------------------
// Published posts

function XMediaView({ media }: { media: XMedia[] }) {
  const [allowed, setAllowed] = useState(false);
  if (!media.length) return null;
  const grid = media.length === 1 ? "grid-cols-1" : "grid-cols-2";
  return (
    <div data-x-media="" className={cn("mt-3 grid gap-0.5 overflow-hidden rounded-2xl border border-[var(--x-quote-line)]", grid)}>
      {media.map((item, index) => {
        const shown = item.previewUrl ?? item.url;
        const direct = isXMediaHost(shown) || allowed;
        const tall = media.length === 3 && index === 0;
        return (
          <div key={`${item.url}-${index}`} className={cn("relative bg-[var(--x-line)]", media.length === 1 ? "aspect-[16/9]" : tall ? "row-span-2 aspect-[4/5]" : "aspect-[16/9]")}>
            {direct ? (
              <img src={shown} alt={item.alt ?? (item.type === "photo" ? t("rich.x.photo") : t("rich.x.video"))} loading="lazy" className="size-full object-cover" />
            ) : (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setAllowed(true);
                }}
                className="flex size-full flex-col items-center justify-center gap-1 px-3 text-center text-[13px] text-[var(--x-sub)] hover:text-[var(--x-ink)]"
              >
                <span>{t("attach.externalHidden")}</span>
                <span className="font-medium underline">{t("attach.loadImage")}</span>
              </button>
            )}
            {item.type !== "photo" && direct && (
              <span className="absolute bottom-2 start-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">{item.type === "gif" ? "GIF" : t("rich.x.video")}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function XHeader({ post, compact = false }: { post: XPostView; compact?: boolean }) {
  const date = xDateText(post.createdAt);
  return (
    <div className={cn("flex min-w-0 items-center gap-1 leading-5", compact ? "text-[15px]" : "text-[15px]")}>
      <span className="min-w-0 truncate font-bold text-[var(--x-ink)]">{post.name}</span>
      {post.verified && <span title={t("rich.x.verified")} className="inline-flex shrink-0"><VerifiedBadge /></span>}
      <span className="min-w-0 truncate text-[var(--x-sub)]">@{post.handle}</span>
      {date && (
        <>
          <span aria-hidden="true" className="shrink-0 text-[var(--x-sub)]">·</span>
          <time dateTime={post.createdAt} className="shrink-0 whitespace-nowrap text-[var(--x-sub)]">{date}</time>
        </>
      )}
    </div>
  );
}

function XQuote({ post }: { post: XPostView }) {
  return (
    <div data-x-quote="" className="mt-3 overflow-hidden rounded-2xl border border-[var(--x-quote-line)] px-3 pb-3 pt-3">
      <div className="flex min-w-0 items-center gap-1.5">
        <XAvatar url={post.avatarUrl} name={post.name} size={20} />
        <XHeader post={post} compact />
      </div>
      <XText text={post.text} className="mt-1 text-[15px] leading-5 text-[var(--x-ink)]" />
      <XMediaView media={post.media} />
    </div>
  );
}

type MetricLabel = "rich.x.replies" | "rich.x.reposts" | "rich.x.likes" | "rich.x.views";
const METRICS: { key: "replies" | "reposts" | "likes" | "views"; icon: keyof typeof PATHS; hover: string; label: MetricLabel }[] = [
  { key: "replies", icon: "reply", hover: "group-hover/m:text-[#1d9bf0]", label: "rich.x.replies" },
  { key: "reposts", icon: "repost", hover: "group-hover/m:text-[#00ba7c]", label: "rich.x.reposts" },
  { key: "likes", icon: "like", hover: "group-hover/m:text-[#f91880]", label: "rich.x.likes" },
  { key: "views", icon: "views", hover: "group-hover/m:text-[#1d9bf0]", label: "rich.x.views" },
];

function XFooter({ post }: { post: XPostView }) {
  const language = activeLocale();
  if (!post.metrics) return null;
  const metrics = post.metrics;
  const label = (key: (typeof METRICS)[number]) => {
    const value = metrics[key.key];
    return value === undefined ? t(key.label, { count: "0" }) : t(key.label, { count: xCount(value, language) });
  };
  const item = "group/m flex min-w-0 flex-1 items-center gap-1 text-[13px] text-[var(--x-sub)]";
  return (
    <div data-x-metrics="" className="-ms-2 mt-3 flex w-[calc(100%+0.5rem)] items-center">
      {METRICS.map((metric) => (
        <span key={metric.key} data-x-metric={metric.key} title={label(metric)} aria-label={label(metric)} className={item}>
          <span className="flex size-[30px] items-center justify-center rounded-full transition-colors group-hover/m:bg-[#1d9bf0]/10 sm:size-[34.75px]">
            <XIcon name={metric.icon} className={metric.hover} />
          </span>
          <span className="-ms-1 min-w-4 whitespace-nowrap tabular-nums">{metrics[metric.key] === undefined ? "" : xCount(metrics[metric.key]!, language)}</span>
        </span>
      ))}
      <span className="ms-auto flex shrink-0 items-center">
        <span data-x-metric="bookmark" title={t("rich.x.bookmark")} aria-label={t("rich.x.bookmark")} className="flex size-[34.75px] items-center justify-center rounded-full text-[var(--x-sub)]">
          <XIcon name="bookmark" />
        </span>
        <span data-x-metric="share" title={t("rich.x.share")} aria-label={t("rich.x.share")} className="flex size-[34.75px] items-center justify-center rounded-full text-[var(--x-sub)]">
          <XIcon name="share" />
        </span>
      </span>
    </div>
  );
}

/** Open a post on x.com. In the desktop app window.open reaches the main
 * process' window-open handler, which validates the address. */
function openOnX(url: string, event: { preventDefault(): void }) {
  if (typeof window !== "undefined" && window.ogb) {
    event.preventDefault();
    window.open(url, "_blank", "noopener");
  }
}

export function XPostItem({ post, divider = false }: { post: XPostView; divider?: boolean }) {
  const inner = (
    <>
      <XAvatar url={post.avatarUrl} name={post.name} />
      <div className="min-w-0 flex-1">
        <XHeader post={post} />
        <XText text={post.text} className="text-[15px] leading-5 text-[var(--x-ink)]" />
        <XMediaView media={post.media} />
        {post.quoted && <XQuote post={post.quoted} />}
        <XFooter post={post} />
      </div>
    </>
  );
  const frame = cn("flex min-w-0 gap-3 px-4 pb-1 pt-3", divider && "border-t border-[var(--x-line)]");
  const label = t("rich.x.post.aria", { name: post.name, handle: post.handle });
  const url = post.url;
  if (!url) return <article data-x-post="" aria-label={label} className={frame}>{inner}</article>;
  // the whole post opens on x.com; the links inside it keep their own target
  const open = (event: { preventDefault(): void }) => {
    if (typeof window !== "undefined" && window.ogb) {
      event.preventDefault();
      window.open(url, "_blank", "noopener");
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };
  return (
    <article
      data-x-post=""
      role="link"
      tabIndex={0}
      aria-label={label}
      title={t("rich.x.open")}
      data-x-url={url}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a")) return;
        open(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) open(event);
      }}
      className={cn(frame, "cursor-pointer transition-colors hover:bg-[var(--x-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d9bf0]")}
    >
      {inner}
    </article>
  );
}

function XPostListComponent({ posts }: { posts: XPostView[] }) {
  return (
    <section data-x-posts="" aria-label={t("rich.x.list.aria", { count: String(posts.length) })} className="x-post my-2 min-w-0 overflow-hidden rounded-2xl border border-[var(--x-line)] bg-[var(--x-bg)] pb-2 text-left shadow-sm">
      {posts.map((post, index) => <XPostItem key={post.id ?? `${post.handle}-${index}`} post={post} divider={index > 0} />)}
    </section>
  );
}
export const XPostList = memo(XPostListComponent, (previous, next) => JSON.stringify(previous.posts) === JSON.stringify(next.posts));

// ---------------------------------------------------------------------------
// The draft

interface PostState {
  status: XPostStatus | "asking";
  text?: string;
  url?: string;
  error?: string;
}

function useDraftPost(threadId: string | undefined, messageId: string | undefined, draftKey: string) {
  const [state, setState] = useState<PostState | null>(null);
  const read = useCallback(async () => {
    if (!threadId || !messageId) return;
    try {
      const body = await api<{ post: { status: XPostStatus; text?: string; url?: string; error?: string } | null }>(
        `/api/threads/${encodeURIComponent(threadId)}/x-posts/${encodeURIComponent(messageId)}/${encodeURIComponent(draftKey)}`,
      );
      if (body.post) setState({ status: body.post.status, ...(body.post.text ? { text: body.post.text } : {}), ...(body.post.url ? { url: body.post.url } : {}), ...(body.post.error ? { error: body.post.error } : {}) });
    } catch {
      // a read that fails keeps what the card shows
    }
  }, [threadId, messageId, draftKey]);
  useEffect(() => {
    void read();
  }, [read]);
  const moving = state?.status === "sending";
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => void read(), POLL_MS);
    return () => clearInterval(timer);
  }, [moving, read]);
  const act = useCallback(async (kind: "post" | "discard", draft: XDraft, text: string, botId: string | undefined) => {
    if (!threadId || !messageId) return;
    setState({ status: kind === "post" ? "asking" : "discarded", text });
    try {
      await api(`/api/threads/${encodeURIComponent(threadId)}/x-posts/${kind}`, {
        method: "POST",
        body: JSON.stringify({ botId, messageId, draftKey, ...(draft.handle ? { handle: draft.handle } : {}), ...(kind === "post" ? { draft: { text } } : { text }) }),
      });
      setState({ status: kind === "post" ? "sending" : "discarded", text });
    } catch (failure) {
      setState({ status: "failed", text, error: readableError(failure) });
    }
  }, [threadId, messageId, draftKey]);
  return { state, act };
}

/** X's counter: a ring that fills as the limit nears, and the characters left. */
function Counter({ text }: { text: string }) {
  const { used, remaining, over, show } = xCounter(text);
  if (!show) return null;
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.min(1, used / X_POST_LIMIT);
  return (
    <span data-x-counter={over ? "over" : "near"} role="status" aria-label={t("rich.x.counter", { count: String(remaining) })} className="flex items-center gap-1.5">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="-rotate-90">
        <circle cx="12" cy="12" r={radius} fill="none" strokeWidth="2" className="stroke-[var(--x-line)]" />
        <circle cx="12" cy="12" r={radius} fill="none" strokeWidth="2" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - filled)} className={over ? "stroke-danger" : remaining <= 10 ? "stroke-[#ffd400]" : "stroke-[#1d9bf0]"} />
      </svg>
      <span className={cn("text-[13px] tabular-nums", over ? "text-danger" : "text-[var(--x-sub)]")}>{remaining}</span>
    </span>
  );
}

/** A bot's own X post call, held for the person's answer (PinnedWaitingCard): the
 * same card, with Post answering that call (or, edited, posting the new text) and Discard refusing it. */
export interface HeldXDraft {
  busy?: boolean;
  onPost: (text: string, edited: boolean) => void;
  onDiscard: () => void;
}

function XDraftCardComponent({ draft: written, pending = false, threadId, botId, messageId, held }: {
  draft: XDraft;
  held?: HeldXDraft;
  pending?: boolean;
  threadId?: string;
  botId?: string;
  /** The bot message that holds the fence: the draft's state is kept on it. */
  messageId?: string;
}) {
  const { copied, copy } = useCopyFeedback();
  const key = xDraftKey(written.text);
  const { state, act } = useDraftPost(threadId, messageId, key);
  const [edited, setEdited] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const text = edited ?? written.text;
  const name = written.name ?? written.handle ?? "";
  const counter = xCounter(text);
  const busy = held ? held.busy === true : state?.status === "asking" || state?.status === "sending";
  const settled = !held && (state?.status === "posted" || state?.status === "discarded");
  const canAct = (held ? true : Boolean(threadId && messageId)) && !pending && !busy && !settled;
  const canPost = canAct && xPostText(text).length > 0 && !counter.over;

  useEffect(() => {
    const element = field.current;
    if (!element) return;
    const fit = () => {
      element.style.height = "auto";
      if (element.scrollHeight > 0) element.style.height = `${element.scrollHeight}px`;
    };
    fit();
    // a card mounted while hidden (a narrow inbox shows its list first) is fitted when it shows
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, state?.status]);

  const header = (
    <header className="flex items-start gap-3">
      <XAvatar url={written.avatarUrl} name={name} />
      <div className="flex min-w-0 flex-1 flex-col justify-center self-center leading-5">
        <span className="text-[15px] font-bold text-ink">{t("rich.x.draft.title")}</span>
        {written.handle && <span className="truncate text-[13px] text-ink-secondary">@{written.handle}</span>}
      </div>
      <button
        type="button"
        onClick={() => void copy("text", xPostText(text))}
        aria-label={copied === "text" ? t("rich.copied") : t("rich.x.copy")}
        title={copied === "text" ? t("rich.copied") : t("rich.x.copy")}
        data-x-copy=""
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-ink/[0.07] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        {copied === "text" ? <Check size={15} className="text-success" aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      </button>
    </header>
  );

  // the published post: the card turns into the post, with a link to it
  if (state?.status === "posted") {
    const posted: XPostView = {
      name: written.name ?? written.handle ?? t("rich.x.you"),
      handle: written.handle ?? "x",
      verified: false,
      ...(written.avatarUrl ? { avatarUrl: written.avatarUrl } : {}),
      createdAt: new Date().toISOString(),
      text: state.text ?? text,
      media: [],
      ...(state.url ? { url: state.url } : {}),
    };
    return (
      <section data-x-draft="posted" className="x-post my-2 min-w-0 overflow-hidden rounded-2xl border border-[var(--x-line)] bg-[var(--x-bg)] pb-2 text-left shadow-sm">
        <div className="flex items-center gap-1.5 px-4 pt-3 text-[13px] text-[var(--x-sub)]" role="status">
          <Check size={13} aria-hidden="true" className="text-success" />
          {t("rich.x.status.posted")}
        </div>
        <XPostItem post={{ ...posted, handle: written.handle ?? "x" }} />
        {state.url && (
          <a href={state.url} target="_blank" rel="noreferrer noopener" onClick={(event) => openOnX(state.url!, event)} data-x-view-link="" className="mx-4 mb-2 inline-block text-[13px] font-medium text-[#1d9bf0] hover:underline">
            {t("rich.x.viewOnX")}
          </a>
        )}
      </section>
    );
  }

  return (
    <article dir="auto" data-x-draft={state?.status ?? "draft"} aria-label={t("rich.x.draft.aria")} className="x-post my-2 min-w-0 overflow-hidden rounded-xl border border-hairline/40 bg-panel p-4 shadow-sm">
      {header}
      {pending && <p className="mt-2 text-[11px] text-ink-secondary">{t("rich.pending")}</p>}
      <div className="mt-3">
        {settled || busy ? (
          <XText text={state?.text ?? text} className={cn("text-[15px] leading-5 text-ink", state?.status === "discarded" && "text-ink-secondary line-through decoration-ink-tertiary/60")} />
        ) : (
          <textarea
            ref={field}
            value={text}
            rows={2}
            readOnly={!canAct}
            dir="auto"
            data-x-editor=""
            aria-label={t("rich.x.editor")}
            onChange={(event) => setEdited(event.target.value)}
            className="block min-h-10 w-full resize-none overflow-hidden whitespace-pre-wrap bg-transparent text-[15px] leading-5 text-ink outline-none placeholder:text-ink-tertiary"
          />
        )}
      </div>
      <div className="mt-1 flex min-h-6 items-center justify-end gap-3">
        {edited !== null && edited !== written.text && !busy && !settled && <span className="me-auto text-[11px] text-ink-tertiary">{t("rich.email.edited")}</span>}
        {!busy && !settled && <Counter text={text} />}
      </div>
      {state?.status === "failed" && (
        <p role="alert" data-x-error="" className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          {state.error ? t("rich.x.status.failedDetail", { error: state.error }) : t("rich.x.status.failed")}
        </p>
      )}
      {(busy || settled) && (
        <p role="status" data-x-status={state?.status} className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-secondary">
          {state?.status === "discarded" ? t("rich.x.status.discarded") : t("rich.x.status.sending")}
        </p>
      )}
      {!settled && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={!canAct && !(state?.status === "failed")}
            onClick={() => (held ? held.onDiscard() : void act("discard", written, text, botId))}
            data-x-discard=""
            className="inline-flex h-10 items-center justify-center rounded-full border border-hairline/60 bg-raised text-[14px] font-semibold text-ink transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-default disabled:opacity-50"
          >
            {t("rich.x.discard")}
          </button>
          <button
            type="button"
            disabled={!canPost && !(state?.status === "failed" && xPostText(text).length > 0 && !counter.over)}
            onClick={() => (held ? held.onPost(xPostText(text), xPostText(text) !== xPostText(written.text)) : void act("post", written, text, botId))}
            data-x-post-button=""
            className="inline-flex h-10 items-center justify-center rounded-full bg-ink text-[14px] font-semibold text-panel transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-default disabled:opacity-50"
          >
            {state?.status === "failed" ? t("rich.x.retry") : t("rich.x.post")}
          </button>
        </div>
      )}
    </article>
  );
}

export const XDraftCard = memo(XDraftCardComponent, (previous, next) =>
  previous.pending === next.pending && previous.threadId === next.threadId && previous.botId === next.botId && previous.messageId === next.messageId && previous.held?.busy === next.held?.busy
  && JSON.stringify(previous.draft) === JSON.stringify(next.draft));
