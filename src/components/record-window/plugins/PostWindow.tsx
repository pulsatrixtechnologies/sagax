// An X post in the record window (M-20261127-146), drawn the way X shows it:
// the avatar, the name, the badge, the handle, the text, the media, the bar
// of replies, reposts, likes and views, the bookmark and the share; then its
// replies and its statistics. Beside it, the post's tiles and its actions
// (Write a follow-up through a bot, Pin to the profile, Delete). X's own
// look is the one exception to the app's look: its inks are the `--x-*`
// tokens of the stylesheet, never written here.
//
// The console's sections: `view` (author, when, text, media, counts, tiles,
// pinned), `replies`, `stats` (a view: hourly, sources). No plugin serves X
// posts yet: the window waits for one.
import { useState, type ReactNode } from "react";
import { BadgeCheck, Bookmark, ChartNoAxesColumn, Heart, MessageCircle, MoreHorizontal, Repeat2, Share } from "lucide-react";
import { RECORD_ACTION, RecordAvatar, RecordEntryForm, RecordPod } from "@/components/record-window/RecordBlocks";
import { RecordSplit } from "@/components/record-window/RecordSplit";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { parseLines, parsePostStats, parsePostView, parseReply, type PostAuthor, type PostCounts, type PostReply, type PostView } from "@/lib/record-plugin-views";
import { RECORD_REPLY_MAX } from "../../../../shared/record-actions";
import { AskButton, CardFacts, SectionStatus, Tiles, WriteButton, tabCount, type PluginContext } from "./PluginParts";
import type { PluginWindowSpec } from "./PluginWindow";

const X_SECONDARY = "[color:var(--x-secondary)]";

/** The text with its hashtags, mentions and links in X's blue. */
function PostText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(#[\p{L}\p{N}_]+|@[A-Za-z0-9_]{1,15}|https?:\/\/[^\s]+)/u);
  return (
    <p dir="auto" className={cn("whitespace-pre-wrap break-words text-[15px] leading-5", className)} data-x-text="">
      {parts.map((part, index) => index % 2 === 1 ? <span key={index} className="[color:var(--x-accent)]">{part}</span> : part)}
    </p>
  );
}

function Head({ author, when }: { author: PostAuthor; when: string }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1 text-[15px] leading-5">
      <b className="font-bold">{author.name}</b>
      {author.verified && <BadgeCheck size={18} role="img" aria-label={t("recordWindow.post.verified")} className="shrink-0 [color:var(--x-accent)]" />}
      <span className={X_SECONDARY}>@{author.handle}{when && ` · ${when}`}</span>
    </div>
  );
}

function Count({ icon, value, label, tone, onClick }: { icon: ReactNode; value?: string; label: string; tone?: string; onClick?: () => void }) {
  const inner = <>{icon}{value && <span>{value}</span>}</>;
  const look = cn("inline-flex items-center gap-1.5 text-[13px] leading-4", tone ?? X_SECONDARY);
  return onClick
    ? <button type="button" className={cn(look, "rounded-full hover:[color:var(--x-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus")} aria-label={label} title={label} onClick={onClick}>{inner}</button>
    : <span className={look} role="img" aria-label={value ? `${label}: ${value}` : label} title={label}>{inner}</span>;
}

function Bar({ counts, small = false, onReply }: { counts: PostCounts; small?: boolean; onReply?: () => void }) {
  const size = small ? 16 : 18;
  return (
    <div className="mt-3 flex min-w-0 max-w-[26rem] items-center justify-between gap-3" data-x-bar="">
      <Count icon={<MessageCircle size={size} aria-hidden="true" />} value={counts.replies} label={t("recordWindow.post.replies")} onClick={onReply} />
      <Count icon={<Repeat2 size={size} aria-hidden="true" />} value={counts.reposts} label={t("recordWindow.post.reposts")} />
      <Count icon={<Heart size={size} aria-hidden="true" />} value={counts.likes} label={t("recordWindow.post.likes")} tone="[color:var(--x-like)]" />
      <Count icon={<ChartNoAxesColumn size={size} aria-hidden="true" />} value={counts.views} label={t("recordWindow.post.views")} />
      <span className="flex items-center gap-3">
        <Count icon={<Bookmark size={size} aria-hidden="true" />} value={counts.bookmarks} label={t("recordWindow.post.bookmarks")} />
        <Count icon={<Share size={size} aria-hidden="true" />} label={t("recordWindow.post.share")} />
      </span>
    </div>
  );
}

/** X's round avatar: the initials in X's blue (the console sends no picture). */
function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return <span className={cn("shrink-0 [&>span]:[background-color:var(--x-accent)] [&>span]:[color:var(--x-on-accent)]", small ? "[&>span]:size-9" : "[&>span]:size-10")}><RecordAvatar name={name} size="lg" /></span>;
}

function ReplyForm({ ctx, to, onDone }: { ctx: PluginContext; to?: string; onDone: () => void }) {
  return (
    <RecordEntryForm data-x-reply-form=""
      fields={[{ key: "text", label: t("recordWindow.post.reply"), kind: "textarea", required: true, max: RECORD_REPLY_MAX, placeholder: t("recordWindow.post.replyPlaceholder") }]}
      submitLabel={t("recordWindow.post.reply")} onCancel={onDone}
      onSubmit={async (values) => { await ctx.detail.write({ action: "post.reply", set: { text: String(values.text ?? ""), ...(to ? { to } : {}) } }); onDone(); }} />
  );
}

function Post({ view, onStats, onReply }: { view: PostView; onStats: () => void; onReply?: () => void }) {
  return (
    <article className="x-look overflow-hidden rounded-2xl border [border-color:var(--x-line)] [background-color:var(--x-surface)] [color:var(--x-ink)]" data-x-post="">
      <div className="flex min-w-0 gap-3 p-4">
        <Avatar name={view.author.name} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-start gap-2">
            <span className="min-w-0 flex-1"><Head author={view.author} when={view.when} /></span>
            <MoreHorizontal size={18} aria-hidden="true" className={X_SECONDARY} />
          </div>
          <PostText text={view.text} className="mt-0.5" />
          {view.media.map((media, index) => (
            <div key={index} role="img" aria-label={media.alt ?? media.label ?? t("recordWindow.post.media")} className="relative mt-3 flex aspect-video min-w-0 items-end overflow-hidden rounded-2xl border [border-color:var(--x-line)] [background-color:var(--x-media)]" data-x-media="">
              {media.label && <span className={cn("p-3 text-[13px] leading-4", X_SECONDARY)}>{media.label}</span>}
            </div>
          ))}
          <Bar counts={view.counts} onReply={onReply} />
        </div>
      </div>
      <button type="button" className="block w-full border-t px-4 py-3 text-start text-[15px] leading-5 [border-color:var(--x-line)] [color:var(--x-accent)] hover:[background-color:var(--x-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" onClick={onStats} data-x-stats-link="">
        {t("recordWindow.post.showStats")}
      </button>
    </article>
  );
}

function Remove({ ctx }: { ctx: PluginContext }) {
  const [asking, setAsking] = useState(false);
  if (!ctx.detail.can("post.remove")) return null;
  if (!asking) return <button type="button" className={RECORD_ACTION} onClick={() => setAsking(true)} data-record-post-remove="">{t("recordWindow.post.remove")}</button>;
  return (
    <span className="flex flex-wrap items-center gap-2" role="group" aria-label={t("recordWindow.post.removeAsk")}>
      <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{t("recordWindow.post.removeAsk")}</span>
      <WriteButton detail={ctx.detail} action={{ action: "post.remove" }} label={t("recordWindow.post.removeConfirm")} />
      <button type="button" className={RECORD_ACTION} onClick={() => setAsking(false)}>{t("recordWindow.cancel")}</button>
    </span>
  );
}

function PostTab({ ctx, setTab }: { ctx: PluginContext; setTab: (tab: string) => void }) {
  const state = ctx.detail.section("view");
  const view = parsePostView(state.data);
  const [replying, setReplying] = useState(false);
  if (!view) return <div className="record-scroll min-h-0 flex-1 overflow-y-auto p-4">{state.data || state.refused ? <CardFacts card={ctx.card} now={ctx.now} /> : <SectionStatus state={state} />}</div>;
  return (
    <RecordSplit type={ctx.type} fallback={760} least={420} rightLeast={320}
      left={
        <div className="flex min-w-0 flex-col gap-3 p-4">
          <Post view={view} onStats={() => setTab("stats")} onReply={ctx.detail.can("post.reply") ? () => setReplying(true) : undefined} />
          {replying && <ReplyForm ctx={ctx} onDone={() => setReplying(false)} />}
        </div>
      }
      right={
        <div className="flex min-w-0 flex-col gap-4 p-4">
          <Tiles tiles={view.tiles} columns={2} />
          <RecordPod>
            <div className="flex min-w-0 flex-wrap items-start gap-2" data-record-post-actions="">
              <AskButton ask={ctx.ask} primary label={t("recordWindow.post.followUp")} prompt={t("recordWindow.post.followUpPrompt", { record: ctx.link })} />
              {view.pinned
                ? <WriteButton detail={ctx.detail} action={{ action: "post.unpin" }} label={t("recordWindow.post.unpin")} />
                : <WriteButton detail={ctx.detail} action={{ action: "post.pin" }} label={t("recordWindow.post.pin")} />}
              <Remove ctx={ctx} />
            </div>
          </RecordPod>
        </div>
      } />
  );
}

function Reply({ ctx, reply }: { ctx: PluginContext; reply: PostReply }) {
  const [replying, setReplying] = useState(false);
  return (
    <li className="flex min-w-0 gap-3 border-b px-4 py-3 last:border-b-0 [border-color:var(--x-line)]" data-x-reply="">
      <Avatar name={reply.author.name} small />
      <div className="flex min-w-0 flex-1 flex-col">
        <Head author={reply.author} when={reply.when} />
        {reply.inReplyTo && <span className={cn("text-[13px] leading-4", X_SECONDARY)}>{t("recordWindow.post.inReplyTo")} <span className="[color:var(--x-accent)]">@{reply.inReplyTo}</span></span>}
        <PostText text={reply.text} className="mt-0.5" />
        <Bar counts={reply.counts} small />
        <div className="mt-2 flex flex-wrap items-start gap-2 [color:var(--color-popover-ink)]">
          {ctx.detail.can("post.reply") && !replying && <button type="button" className={RECORD_ACTION} onClick={() => setReplying(true)} data-x-reply-open="">{t("recordWindow.post.reply")}</button>}
          <AskButton ask={ctx.ask} label={t("recordWindow.post.suggest")} prompt={t("recordWindow.post.suggestPrompt", { handle: reply.author.handle, text: reply.text, record: ctx.link })} />
        </div>
        {replying && <div className="mt-2"><ReplyForm ctx={ctx} to={reply.id} onDone={() => setReplying(false)} /></div>}
      </div>
    </li>
  );
}

function Replies({ ctx }: { ctx: PluginContext }) {
  const state = ctx.detail.section("replies");
  if (!state.data) return <SectionStatus state={state} />;
  const replies = parseLines(state.data, parseReply);
  return (
    <ul className="x-look max-w-[40rem] overflow-hidden rounded-2xl border [border-color:var(--x-line)] [background-color:var(--x-surface)] [color:var(--x-ink)]" aria-label={t("recordWindow.post.repliesTab")}>
      {replies.map((reply) => <Reply key={reply.id} ctx={ctx} reply={reply} />)}
    </ul>
  );
}

function Stats({ ctx }: { ctx: PluginContext }) {
  const state = ctx.detail.section("stats");
  const stats = parsePostStats(state.data);
  if (!stats) return <SectionStatus state={state} />;
  // the bars are drawn against the tallest (a drawing scale, never a number shown)
  const most = Math.max(1, ...stats.hourly.map((one) => one.value));
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 @min-[52rem]:grid-cols-2">
      {stats.hourly.length > 0 && (
        <RecordPod title={stats.hourlyTitle} data-x-hourly="">
          <div className="flex h-36 min-w-0 items-end gap-3 px-2" role="list">
            {stats.hourly.map((one) => (
              <div key={one.label} role="listitem" aria-label={one.text ? `${one.label}: ${one.text}` : one.label} title={one.text} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
                <span className="w-full max-w-10 rounded-md [background-color:var(--x-accent)]" style={{ height: `${Math.max(4, (one.value / most) * 100)}%` }} />
                <span className="text-[13px] leading-4 text-popover-ink-secondary">{one.label}</span>
              </div>
            ))}
          </div>
        </RecordPod>
      )}
      {stats.sources.length > 0 && (
        <RecordPod title={stats.sourcesTitle} bodyClassName="gap-2.5" data-x-sources="">
          {stats.sources.map((one) => (
            <div key={one.label} className="grid min-w-0 items-center gap-3 [grid-template-columns:minmax(0,8rem)_minmax(0,1fr)_auto]">
              <span className="truncate">{one.label}</span>
              <span role="progressbar" aria-label={one.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(one.share)} className="block h-2 overflow-hidden rounded-full bg-popover-hover">
                <span className="block h-full rounded-full [background-color:var(--x-accent)]" style={{ width: `${one.share}%` }} />
              </span>
              <span className="text-[13px] leading-4 text-popover-ink-secondary">{one.text ?? `${one.share} %`}</span>
            </div>
          ))}
        </RecordPod>
      )}
    </div>
  );
}

export const POST_WINDOW: PluginWindowSpec = {
  first: "post",
  open: ["view", "replies"],
  reads: { post: ["view"], replies: ["replies"], stats: ["stats"] },
  tabs: (ctx) => {
    const { detail } = ctx;
    const replies = detail.section("replies");
    const stats = detail.section("stats");
    return [
      { id: "post", label: t("recordWindow.post.post") },
      { id: "replies", label: t("recordWindow.post.repliesTab"), count: tabCount(detail, "replies", replies.data ? parseLines(replies.data, parseReply).length : undefined) },
      { id: "stats", label: t("recordWindow.post.stats"), count: stats.refused ? 0 : undefined },
    ];
  },
  sides: (tab) => tab === "post",
  body: (ctx, tab, setTab) => tab === "post" ? <PostTab ctx={ctx} setTab={setTab} /> : (
    <div className="flex min-w-0 flex-col gap-4 p-4" data-record-post-tab={tab}>
      {tab === "replies" && <Replies ctx={ctx} />}
      {tab === "stats" && <Stats ctx={ctx} />}
    </div>
  ),
};
