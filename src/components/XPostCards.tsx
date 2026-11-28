// The two X (Twitter) cards of the chat (#4638, shared/x-post.ts has the rules):
//
//   XDraftCard  a post a bot drafted: the person's avatar, "Post" and @handle,
//               Copy, the text editable in place (X's counter, only near the
//               limit), Discard and Post. Post is the person's go: the server
//               hands the bot the exact text and the card follows the post,
//               then turns into the published post with its link. Discard
//               closes it. Nothing is posted by the fence itself.
//   XPostList   what a bot read from X: each post drawn the way x.com draws it
//               (name, badge, @handle, time, text with links, a quoted post as
//               an inner card, media, the row of counts), stacked like a
//               timeline. A click opens the post on x.com.
//               What the person's bot just published (#4640) is one card of its
//               own, as the account that posted it (picture, name, badge,
//               @handle), with a quiet Posted chip; several posts of one turn
//               are a fan of cards like photos in iMessage (XPostStack).
import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Copy } from "lucide-react";

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
  type XAccount,
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

/** A picture the card may draw: X's own CDN, or the copy Sagax kept of it. */
const drawable = (url: string | undefined): url is string => Boolean(url && (isXMediaHost(url) || /^data:image\/(jpeg|png|webp|gif);base64,/.test(url)));

/** The account picture: X's own CDN loads (then the copy Sagax kept), else the initials. */
function XAvatar({ url, fallbackUrl, name, size = 40 }: { url?: string; fallbackUrl?: string; name: string; size?: number }) {
  const [failed, setFailed] = useState(0);
  const sources = [url, fallbackUrl].filter(drawable);
  const shown = sources[failed];
  return (
    <span
      data-x-avatar=""
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--x-line)] text-[13px] font-semibold text-[var(--x-sub)]"
    >
      {shown ? <img src={shown} alt="" loading="lazy" onError={() => setFailed(failed + 1)} className="size-full object-cover" /> : size >= 32 ? (name ? initialsOf(name) : <XIcon name="logo" size={18} className="text-[var(--x-ink)]" />) : null}
    </span>
  );
}

// The account a bot posts as, asked once per conversation and bot (#4640).
const accountReads = new Map<string, Promise<XAccountView | null>>();
type XAccountView = XAccount & { avatarData?: string };
function useXAccount(threadId: string | undefined, botId: string | undefined, wanted = true): XAccountView | null {
  const [account, setAccount] = useState<XAccountView | null>(null);
  useEffect(() => {
    if (!threadId || !wanted) return;
    const key = `${threadId}:${botId ?? ""}`;
    let read = accountReads.get(key);
    if (!read) {
      read = api<{ account: XAccountView | null }>(`/api/threads/${encodeURIComponent(threadId)}/x-account${botId ? `?botId=${encodeURIComponent(botId)}` : ""}`).then((body) => body.account).catch(() => null);
      accountReads.set(key, read);
      // a missing account is asked again next time: the tool may tell it later
      void read.then((value) => { if (!value) accountReads.delete(key); });
    }
    let live = true;
    void read.then((value) => { if (live) setAccount(value); });
    return () => { live = false; };
  }, [threadId, botId, wanted]);
  return account;
}

/** A published post with the account that posted it: what the post lacks is filled in.
 * A URL-learned placeholder (name === handle, no avatar) yields to the connected account. */
export function withAccount(post: XPostView, account: XAccountView | null): XPostView {
  if (!account || !post.posted) return post;
  const placeholder = Boolean(post.handle) && post.name === post.handle && !post.avatarUrl;
  const handle = post.handle || account.handle;
  const name = placeholder && account.name ? account.name : (post.name || account.name);
  return {
    ...post,
    handle,
    name,
    verified: post.handle && !placeholder ? post.verified : account.verified,
    ...(post.avatarUrl || account.avatarUrl ? { avatarUrl: post.avatarUrl ?? account.avatarUrl } : {}),
  };
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

/** The time as X's timeline shows it: 5s, 12m, 3h, then the date. */
export function xTimeText(value: string | undefined, now = Date.now()): string {
  if (!value) return "";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  const fr = activeLocale().startsWith("fr");
  if (seconds < 60) return fr ? `${seconds} s` : `${seconds}s`;
  if (seconds < 3600) return fr ? `${Math.floor(seconds / 60)} min` : `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return fr ? `${Math.floor(seconds / 3600)} h` : `${Math.floor(seconds / 3600)}h`;
  return xDateText(value, now);
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
  const date = xTimeText(post.createdAt);
  const full = post.createdAt && Number.isFinite(Date.parse(post.createdAt)) ? new Date(post.createdAt).toLocaleString(activeLocale().startsWith("fr") ? "fr-CA" : "en-US") : undefined;
  return (
    <div className={cn("flex min-w-0 items-center gap-1 leading-5", compact ? "text-[15px]" : "text-[15px]")}>
      <span className="min-w-0 truncate font-bold text-[var(--x-ink)]">{post.name || (post.handle ? post.handle : t("rich.x.you"))}</span>
      {post.verified && <span title={t("rich.x.verified")} className="inline-flex shrink-0"><VerifiedBadge /></span>}
      {post.handle && <span className="min-w-0 truncate text-[var(--x-sub)]">@{post.handle}</span>}
      {date && (
        <>
          <span aria-hidden="true" className="shrink-0 text-[var(--x-sub)]">·</span>
          <time dateTime={post.createdAt} title={full} className="shrink-0 whitespace-nowrap text-[var(--x-sub)]">{date}</time>
        </>
      )}
    </div>
  );
}

function XQuote({ post, compact = false }: { post: XPostView; compact?: boolean }) {
  return (
    <div data-x-quote="" data-x-parent={compact ? "" : undefined} className="mt-3 overflow-hidden rounded-2xl border border-[var(--x-quote-line)] px-3 pb-3 pt-3">
      <div className="flex min-w-0 items-center gap-1.5">
        <XAvatar url={post.avatarUrl} name={post.name} size={20} />
        <XHeader post={post} compact />
      </div>
      <XText text={post.text} className={cn("mt-1 text-[15px] leading-5 text-[var(--x-ink)]", compact && "line-clamp-2")} />
      {!compact && <XMediaView media={post.media} />}
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

/** X's action row: reply, repost, like, views with their counts when known (muted icons otherwise), bookmark and share.
 * A post the person's bot just published carries the quiet Posted chip in place of bookmark and share. */
function XFooter({ post }: { post: XPostView }) {
  const language = activeLocale();
  const metrics = post.metrics ?? {};
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
      {post.posted ? (
        <span data-x-posted-chip="" role="status" className="ms-auto me-2 inline-flex shrink-0 items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--x-sub)_16%,transparent)] px-2 py-0.5 text-[12px] font-medium text-[var(--x-sub)]">
          <Check size={12} aria-hidden="true" className="text-[#00ba7c]" />
          {t("rich.x.status.posted")}
        </span>
      ) : (
        <span className="ms-auto flex shrink-0 items-center">
          <span data-x-metric="bookmark" title={t("rich.x.bookmark")} aria-label={t("rich.x.bookmark")} className="flex size-[34.75px] items-center justify-center rounded-full text-[var(--x-sub)]">
            <XIcon name="bookmark" />
          </span>
          <span data-x-metric="share" title={t("rich.x.share")} aria-label={t("rich.x.share")} className="flex size-[34.75px] items-center justify-center rounded-full text-[var(--x-sub)]">
            <XIcon name="share" />
          </span>
        </span>
      )}
    </div>
  );
}

/** "Replying to @handle", the handle in X's blue. */
function XReplying({ post }: { post: XPostView }) {
  const handle = post.replyTo?.handle ?? post.replyTo?.post?.handle;
  return (
    <div data-x-replying="" className="text-[15px] leading-5 text-[var(--x-sub)]">
      {handle ? (
        <>
          {t("rich.x.replyingTo")} <span className="text-[#1d9bf0]">@{handle}</span>
        </>
      ) : t("rich.x.replyingToPost")}
    </div>
  );
}

/** Open a post on x.com. In the desktop app window.open reaches the main
 * process' window-open handler, which validates the address. */
function openOnX(url: string, event: { preventDefault(): void }) {
  if (typeof window !== "undefined" && window.ogb) {
    event.preventDefault();
    window.open(url, "_blank", "noopener");
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** One post on X: the picture, the header, the text, the media, the reply's parent, the quote, the action row.
 * As a timeline row it has no frame of its own; with `card` it is a card with one border and X's logo in the corner. */
export function XPostItem({ post, divider = false, card = false, accountPicture, style, className }: {
  post: XPostView;
  divider?: boolean;
  card?: boolean;
  accountPicture?: string;
  style?: CSSProperties;
  className?: string;
}) {
  const inner = (
    <>
      <XAvatar url={post.avatarUrl} fallbackUrl={accountPicture} name={post.name || post.handle} />
      <div className="min-w-0 flex-1">
        <div className={cn(card && "pe-6")}><XHeader post={post} /></div>
        {post.replyTo && <XReplying post={post} />}
        <XText text={post.text} className="text-[15px] leading-5 text-[var(--x-ink)]" />
        <XMediaView media={post.media} />
        {post.quoted && <XQuote post={post.quoted} />}
        {post.replyTo?.post && <XQuote post={post.replyTo.post} compact />}
        <XFooter post={post} />
      </div>
      {card && <span data-x-logo="" aria-hidden="true" className="pointer-events-none absolute end-4 top-3 text-[var(--x-ink)]"><XIcon name="logo" size={18} /></span>}
    </>
  );
  const frame = cn(
    "flex min-w-0 gap-3 px-4 pb-1 pt-3",
    card ? "x-post relative rounded-2xl border border-[var(--x-quote-line)] bg-[var(--x-bg)] pb-1.5 text-left shadow-sm" : divider && "border-t border-[var(--x-line)]",
    className,
  );
  const label = t("rich.x.post.aria", { name: post.name || post.handle, handle: post.handle });
  const url = post.url;
  if (!url) return <article data-x-post="" data-x-posted={post.posted ? "" : undefined} aria-label={label} style={style} className={frame}>{inner}</article>;
  // the whole post opens on x.com; the links inside it keep their own target
  return (
    <article
      data-x-post=""
      data-x-posted={post.posted ? "" : undefined}
      role="link"
      tabIndex={0}
      aria-label={label}
      title={t("rich.x.open")}
      data-x-url={url}
      style={style}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a, button")) return;
        openOnX(url, event);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) openOnX(url, event);
      }}
      className={cn(frame, "cursor-pointer transition-colors hover:bg-[var(--x-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d9bf0]")}
    >
      {inner}
    </article>
  );
}

/** One post as a card of its own: a single border, X's logo in the corner. */
export function XPostCard({ post, accountPicture, style, className }: { post: XPostView; accountPicture?: string; style?: CSSProperties; className?: string }) {
  return <XPostItem post={post} card accountPicture={accountPicture} style={style} className={className} />;
}

// ---------------------------------------------------------------------------
// Several posts of one turn: a fan of cards, like photos in iMessage

const FAN_DEPTH = 3;
const SWIPE_PX = 56;
/** Room the cards behind need around the front one, so their turned edges show on every side. */
const DECK_PAD_X = 24;
const DECK_PAD_Y = 46;
/** How long the front card flies off before it goes to the back (ms). */
const FLY_MS = 200;

/** Where the card at `depth` behind the front one sits, like photos in an iMessage stack: it is
 * turned a few degrees, alternately right and left, shifted a little, and slightly smaller, so its
 * edges show at the sides and the top as well as the bottom. */
export function xFanStyle(depth: number, reduced: boolean): CSSProperties {
  if (depth === 0) return { transform: "none", zIndex: 10 };
  const side = depth % 2 === 1 ? 1 : -1;
  if (depth > FAN_DEPTH) return { transform: `translate(0px, ${-FAN_DEPTH * 6}px) scale(${1 - (FAN_DEPTH + 1) * 0.03})`, opacity: 0, zIndex: 0, pointerEvents: "none" };
  const turn = reduced ? 0 : side * (3.5 + depth * 2.2);
  return { transform: `translate(${side * depth * 10}px, ${-depth * 6 + (reduced ? depth * 10 : 0)}px) rotate(${turn}deg) scale(${1 - depth * 0.03})`, zIndex: 10 - depth, pointerEvents: "none" };
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const change = () => setReduced(query.matches);
    query.addEventListener?.("change", change);
    return () => query.removeEventListener?.("change", change);
  }, []);
  return reduced;
}

export function XPostStack({ posts, accountPicture }: { posts: XPostView[]; accountPicture?: string }) {
  const count = posts.length;
  const [front, setFront] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [drag, setDrag] = useState(0);
  const reduced = useReducedMotion();
  const gesture = useRef<{ x: number; moved: boolean } | null>(null);
  const swallow = useRef(false);
  const [leaving, setLeaving] = useState(0);
  const flying = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (flying.current) clearTimeout(flying.current); }, []);
  const move = useCallback((step: number) => setFront((current) => (current + step + count) % count), [count]);
  /** Next sends the front card off to the side, then to the back of the stack, as iMessage does. */
  const go = useCallback((step: number) => {
    if (flying.current) return;
    if (step < 0 || reduced) { move(step); return; }
    setLeaving(1);
    flying.current = setTimeout(() => { flying.current = null; setLeaving(0); move(step); }, FLY_MS);
  }, [move, reduced]);

  const begin = (event: React.PointerEvent) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    gesture.current = { x: event.clientX, moved: false };
    const move = (next: PointerEvent) => {
      const state = gesture.current;
      if (!state) return;
      const delta = next.clientX - state.x;
      if (Math.abs(delta) > 5) state.moved = true;
      if (state.moved) setDrag(delta);
    };
    const end = (next: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      const state = gesture.current;
      gesture.current = null;
      setDrag(0);
      if (!state?.moved) return;
      // a drag is not a click on the card under it
      swallow.current = true;
      setTimeout(() => { swallow.current = false; }, 0);
      const delta = next.clientX - state.x;
      if (Math.abs(delta) >= SWIPE_PX) go(delta < 0 ? 1 : -1);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  const keys = (event: ReactKeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
  };

  return (
    <section data-x-stack="" data-x-expanded={expanded ? "" : undefined} aria-label={t("rich.x.list.aria", { count: String(count) })} className="x-post my-2 min-w-0 max-w-[36rem] text-left">
      <div className="mb-2 flex items-center gap-1 text-[13px] text-ink-secondary">
        <button
          type="button"
          data-x-stack-label=""
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium text-ink-secondary hover:bg-ink/[0.07] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {t("rich.x.stack.label", { count: String(count) })}
          <ChevronDown size={14} aria-hidden="true" className={cn("transition-transform", expanded && "rotate-180")} />
        </button>
        {!expanded && (
          <span className="ms-auto flex items-center gap-0.5">
            <button type="button" data-x-stack-prev="" aria-label={t("rich.x.stack.prev")} onClick={() => go(-1)} className="flex size-7 items-center justify-center rounded-full hover:bg-ink/[0.07] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><ChevronLeft size={15} aria-hidden="true" /></button>
            <span className="min-w-8 text-center tabular-nums" aria-live="polite">{front + 1} / {count}</span>
            <button type="button" data-x-stack-next="" aria-label={t("rich.x.stack.next")} onClick={() => go(1)} className="flex size-7 items-center justify-center rounded-full hover:bg-ink/[0.07] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><ChevronRight size={15} aria-hidden="true" /></button>
          </span>
        )}
      </div>
      {expanded ? (
        <div className="flex flex-col gap-3">
          {posts.map((post, index) => <XPostCard key={post.id ?? `${post.handle}-${index}`} post={post} accountPicture={accountPicture} />)}
        </div>
      ) : (
        <div
          role="group"
          aria-roledescription={t("rich.x.stack.role")}
          tabIndex={0}
          onKeyDown={keys}
          onPointerDown={begin}
          onClickCapture={(event) => { if (swallow.current) { event.preventDefault(); event.stopPropagation(); } }}
          data-x-stack-deck=""
          style={{ padding: `${DECK_PAD_Y}px ${DECK_PAD_X}px`, touchAction: "pan-y" }}
          className="relative rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d9bf0]/60"
        >
          {posts.map((post, index) => {
            const depth = (index - front + count) % count;
            const top = depth === 0;
            const style: CSSProperties = top && leaving
              ? { transform: `translateX(-62%) rotate(${reduced ? 0 : -9}deg)`, opacity: 0.0, zIndex: 11, transition: `transform ${FLY_MS}ms ease-in, opacity ${FLY_MS}ms ease-in` }
              : top && drag
                ? { transform: `translateX(${drag}px) rotate(${reduced ? 0 : drag / 40}deg)`, zIndex: 11, transition: "none", userSelect: "none" }
                : { ...xFanStyle(depth, reduced), ...(top ? {} : { top: DECK_PAD_Y, bottom: DECK_PAD_Y, left: DECK_PAD_X, right: DECK_PAD_X }) };
            return (
              <div
                key={post.id ?? `${post.handle}-${index}`}
                data-x-stack-card={top ? "front" : String(depth)}
                aria-hidden={top ? undefined : true}
                {...(top ? {} : { inert: true })}
                style={style}
                className={cn("x-stack-card", top ? "relative" : "absolute overflow-hidden rounded-2xl [&>article>*]:invisible")}
              >
                <XPostCard post={post} accountPicture={accountPicture} className={top ? undefined : "h-full"} />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function XPostListComponent({ posts, threadId, botId }: { posts: XPostView[]; threadId?: string; botId?: string }) {
  const mine = posts.some((post) => post.posted);
  const account = useXAccount(threadId, botId, mine);
  const filled = mine ? posts.map((post) => withAccount(post, account)) : posts;
  const picture = account?.avatarData;
  if (mine && filled.length > 1 && filled.every((post) => post.posted)) return <XPostStack posts={filled} accountPicture={picture} />;
  if (filled.length === 1) {
    return <section data-x-posts="" aria-label={t("rich.x.list.aria", { count: "1" })} className="x-post my-2 min-w-0 max-w-[36rem] text-left"><XPostCard post={filled[0]!} accountPicture={picture} /></section>;
  }
  return (
    <section data-x-posts="" aria-label={t("rich.x.list.aria", { count: String(posts.length) })} className="x-post my-2 min-w-0 overflow-hidden rounded-2xl border border-[var(--x-quote-line)] bg-[var(--x-bg)] pb-2 text-left shadow-sm">
      {filled.map((post, index) => <XPostItem key={post.id ?? `${post.handle}-${index}`} post={post} divider={index > 0} accountPicture={picture} />)}
    </section>
  );
}
export const XPostList = memo(XPostListComponent, (previous, next) => previous.threadId === next.threadId && previous.botId === next.botId && JSON.stringify(previous.posts) === JSON.stringify(next.posts));

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
  const account = useXAccount(threadId, botId, !held);
  const postedAt = useRef(new Date().toISOString());
  const [edited, setEdited] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const text = edited ?? written.text;
  const name = written.name ?? account?.name ?? written.handle ?? account?.handle ?? "";
  const handle = written.handle ?? account?.handle;
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
      <XAvatar url={written.avatarUrl ?? account?.avatarUrl} fallbackUrl={account?.avatarData} name={name} />
      <div className="flex min-w-0 flex-1 flex-col justify-center self-center leading-5">
        <span className="text-[15px] font-bold text-ink">{t("rich.x.draft.title")}</span>
        {handle && <span className="truncate text-[13px] text-ink-secondary">@{handle}</span>}
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

  // the published post: the card turns into the post as the account that posted it, one card, opening on x.com
  if (state?.status === "posted") {
    const posted: XPostView = {
      name: written.name ?? account?.name ?? "",
      handle: handle ?? "",
      verified: written.name || written.handle ? false : account?.verified ?? false,
      ...(written.avatarUrl ?? account?.avatarUrl ? { avatarUrl: written.avatarUrl ?? account?.avatarUrl } : {}),
      createdAt: postedAt.current,
      text: state.text ?? text,
      media: [],
      posted: true,
      ...(state.url ? { url: state.url } : {}),
    };
    const merged = account && handle === account.handle ? { ...posted, verified: account.verified } : posted;
    return (
      <section data-x-draft="posted" className="x-post my-2 min-w-0 max-w-[36rem] text-left">
        <XPostCard post={merged} accountPicture={account?.avatarData} />
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
