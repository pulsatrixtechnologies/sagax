// The conversation around an open page (2026-10-28; lot 5 side pane 2026-10-31):
//   - PageRefChip: a message sent while the page was open carries the page as
//     a chip over its words (icon and title); a click opens that page;
//   - PageBotStatus: above the composer in the desktop side pane, the bot's
//     state or its latest answer in one line, with its avatar ("On it", then
//     its reply), so the person can follow the bot while reading the page.
import { t } from "@/lib/i18n";
import { openPage } from "@/lib/open-page";
import type { Message } from "@/state/store";
import { PageGlyph } from "./PageViewer";

export function PageRefChip({ page, botId, threadId }: { page: { pageId: string; title: string; version?: number }; botId: string; threadId: string }) {
  return (
    <button type="button" data-page-ref={page.pageId} title={t("pages.cardOpen", { title: page.title })}
      onClick={() => void openPage({ pageId: page.pageId, botId, threadId, title: page.title })}
      className="mb-1.5 inline-flex max-w-full items-center gap-1.5 rounded-lg bg-black/5 px-2 py-1 text-[12px] font-medium text-ink hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15">
      <PageGlyph size={16} className="rounded-[4px]" />
      <span className="min-w-0 truncate">{page.title || t("pages.untitled")}</span>
    </button>
  );
}

/** The one line over the composer: working, or the bot's newest text since
 * the page was opened, cut to one line. Null when there is nothing new.
 * Pure. */
export function pageBotStatusLine(messages: readonly Pick<Message, "role" | "kind" | "text" | "at">[], busy: boolean, openedAt: number): { kind: "working" } | { kind: "reply"; text: string } | null {
  if (busy) return { kind: "working" };
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.at < openedAt) return null;
    if (message.role === "bot" && message.kind === "text" && message.text?.trim()) {
      const line = message.text.replace(/\*\*|__|`|^\s{0,3}(#{1,6}|>)\s/gm, "").replace(/\s+/g, " ").trim();
      return line ? { kind: "reply", text: line.length > 160 ? `${line.slice(0, 159).trimEnd()}…` : line } : null;
    }
  }
  return null;
}

export function PageBotStatus({ status, avatar, name }: { status: ReturnType<typeof pageBotStatusLine>; avatar: React.ReactNode; name: string }) {
  if (!status) return null;
  return (
    <div data-page-bot-status={status.kind} role="status" aria-live="polite"
      className="pointer-events-auto mx-auto mb-2 flex w-fit max-w-[min(640px,calc(100%-40px))] items-center gap-2 rounded-full border border-hairline/40 bg-elevated/95 py-1.5 pl-1.5 pr-3.5 text-[13px] text-ink shadow-lg backdrop-blur">
      <span className="shrink-0">{avatar}</span>
      <span className="sr-only">{name}</span>
      <span className="min-w-0 truncate">{status.kind === "working" ? t("pages.botWorking") : status.text}</span>
    </div>
  );
}
