// An X post in the record window (M-20261127-146), drawn the way X shows it
// by the chat's own X card (XPostCards.tsx `XPostItem`, its tokens `.x-post`
// in styles.css): the picture, the name, the badge, the handle, the text, the
// media, the row of replies, reposts, likes and views, the bookmark and the
// share, here as buttons (reply opens the form, the bookmark is written when
// the console takes it, share copies the post's link). Then its replies and
// its statistics. Beside it, the post's tiles and its actions (Write a
// follow-up through a bot, Pin to the profile, Delete).
//
// The console's sections: `view` (`post`, an X post as the X API or the chat's
// cards give it, read by `readXPost`; tiles, pinned, bookmarked), `replies`
// (X posts), `stats` (a view: hourly, sources). No plugin serves X posts yet:
// the window waits for one.
import { useState } from "react";
import { RECORD_ACTION, RECORD_LINK_ACTION, RecordEntryForm, RecordPod } from "@/components/record-window/RecordBlocks";
import { RecordSplit } from "@/components/record-window/RecordSplit";
import { XPostItem } from "@/components/XPostCards";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { parseLines, parsePostStats, parsePostView, parseReply, type PostView } from "@/lib/record-plugin-views";
import { RECORD_REPLY_MAX } from "../../../../shared/record-actions";
import { AskButton, SectionStatus, Tiles, WriteButton, tabCount, type PluginContext } from "./PluginParts";
import type { PluginWindowSpec } from "./PluginWindow";

function ReplyForm({ ctx, to, onDone }: { ctx: PluginContext; to?: string; onDone: () => void }) {
  return (
    <RecordEntryForm data-x-reply-form=""
      fields={[{ key: "text", label: t("recordWindow.post.reply"), kind: "textarea", required: true, max: RECORD_REPLY_MAX, placeholder: t("recordWindow.post.replyPlaceholder") }]}
      submitLabel={t("recordWindow.post.reply")} onCancel={onDone}
      onSubmit={async (values) => { await ctx.detail.write({ action: "post.reply", set: { text: String(values.text ?? ""), ...(to ? { to } : {}) } }); onDone(); }} />
  );
}

/** The post, the X card's own, its reply, bookmark and share as buttons. */
function Post({ ctx, view, onReply }: { ctx: PluginContext; view: PostView; onReply?: () => void }) {
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const { detail, card } = ctx;
  const mark = view.bookmarked ? "post.unbookmark" as const : "post.bookmark" as const;
  const link = view.post.url ?? card.openUrl;
  return (
    <XPostItem post={view.post} card actions={{
      onReply,
      bookmarked: view.bookmarked,
      onBookmark: detail.can(mark) && !busy ? () => { setBusy(true); detail.write({ action: mark }).catch(() => {}).finally(() => setBusy(false)); } : undefined,
      onShare: link ? () => { void copyText(link).then(() => { setShared(true); setTimeout(() => setShared(false), 1_500); }); } : undefined,
      shared,
    }} />
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
  if (!view) return <div className="p-4"><SectionStatus state={state} /></div>;
  return (
    <RecordSplit type={ctx.type} fallback={760} least={420} rightLeast={320}
      left={
        <div className="flex min-w-0 flex-col gap-3 p-4">
          <Post ctx={ctx} view={view} onReply={ctx.detail.can("post.reply") ? () => setReplying(true) : undefined} />
          <button type="button" className={cn(RECORD_LINK_ACTION, "self-start")} onClick={() => setTab("stats")} data-x-stats-link="">{t("recordWindow.post.showStats")}</button>
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

function Reply({ ctx, reply, divider }: { ctx: PluginContext; reply: NonNullable<ReturnType<typeof parseReply>>; divider: boolean }) {
  const [replying, setReplying] = useState(false);
  return (
    <li data-x-reply="">
      <XPostItem post={reply} divider={divider} actions={ctx.detail.can("post.reply") ? { onReply: () => setReplying(true) } : undefined} />
      <div className="flex flex-col gap-2 pb-3 pe-4 ps-[68px]">
        <div className="flex flex-wrap items-start gap-2">
          {/* X's own reply button opens the form; the reply is named by its author, never by its words: a third party's text never becomes the person's request */}
          <AskButton ask={ctx.ask} label={t("recordWindow.plugin.suggestReply")} prompt={t("recordWindow.post.suggestPrompt", { handle: reply.handle, record: ctx.link })} />
        </div>
        {replying && <ReplyForm ctx={ctx} to={reply.id} onDone={() => setReplying(false)} />}
      </div>
    </li>
  );
}

function Replies({ ctx }: { ctx: PluginContext }) {
  const state = ctx.detail.section("replies");
  if (!state.data) return <SectionStatus state={state} />;
  const replies = parseLines(state.data, parseReply);
  return (
    <ul className="x-post max-w-[40rem] overflow-hidden rounded-2xl border border-[var(--x-quote-line)] bg-[var(--x-bg)]" aria-label={t("recordWindow.post.repliesTab")}>
      {replies.map((reply, index) => <Reply key={reply.id} ctx={ctx} reply={reply} divider={index > 0} />)}
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
                <span className="x-blue w-full max-w-10 rounded-md bg-[var(--x-blue)]" style={{ height: `${Math.max(4, (one.value / most) * 100)}%` }} />
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
                <span className="x-blue block h-full rounded-full bg-[var(--x-blue)]" style={{ width: `${one.share}%` }} />
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
  core: "view",
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
