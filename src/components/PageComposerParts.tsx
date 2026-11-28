// The conversation around an open page (2026-10-28; lot 5 side pane 2026-10-31):
//   - PageRefChip: a message sent while the page was open carries the page as
//     a chip over its words (icon and title); a click opens that page;
//   - PageSelectionQuote: under the chip, the passage the person selected and
//     asked about (#4099), in the reply's quote strip;
//   - ComposerPageCiteStrip: the same passage parked on the main composer
//     (#5464 R4), so the person can write there and send with
//     dataContext.page.selection; PageSelectionAsk still offers ask-in-place;
//   - PageBotStatus: above the composer in the desktop side pane, the bot's
//     state or its latest answer in one line, with its avatar ("On it", then
//     its reply), so the person can follow the bot while reading the page.
import { MessageSquareQuote, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { PageCiteDraft } from "@/lib/page-cite-draft";
import { openPage } from "@/lib/open-page";
import type { Message } from "@/state/store";
import { PageGlyph } from "./PageViewer";
import { QUOTE_STRIP, QUOTE_STRIP_COMPACT } from "./ReplyQuote";
import type { PageQuote } from "../../shared/page-threads";

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

/** The passage of the page a message is about (#4099): the words, in the
 * quote strip a reply uses; a part of the page without words, its tag. */
export function PageSelectionQuote({ selection }: { selection: PageQuote }) {
  const words = selection.quote.replace(/\s+/g, " ").trim() || `<${selection.tag}>`;
  return (
    <div data-page-ref-quote="" className={cn(QUOTE_STRIP, QUOTE_STRIP_COMPACT, "mb-1.5 max-w-full")}>
      <MessageSquareQuote size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0 rtl:-scale-x-100" />
      <span className="sr-only">{t("pages.selection.tag")}: </span>
      <span dir="auto" className="min-w-0 flex-1 truncate">{words}</span>
    </div>
  );
}

/** One soft strip at the top of the composer box for a page passage waiting
 * to go with the next message (#5464): same family as the reply strip. */
export function ComposerPageCiteStrip({
  cite,
  onClear,
}: {
  cite: PageCiteDraft;
  onClear?: () => void;
}) {
  const words = cite.selection.quote.replace(/\s+/g, " ").trim() || `<${cite.selection.tag}>`;
  const label = t("pages.selection.citeStrip", { title: cite.title || t("pages.untitled") });
  return (
    <div
      role="group"
      aria-label={label}
      title={label}
      data-composer-page-cite=""
      className="mb-1 flex min-w-0 items-center gap-2 rounded-2xl bg-ink/[0.06] py-1.5 ps-3 pe-1.5 text-[13px] leading-5 text-ink-secondary"
    >
      <MessageSquareQuote size={15} strokeWidth={1.5} aria-hidden="true" className="shrink-0 rtl:-scale-x-100" />
      <span className="sr-only">{label}: </span>
      <span dir="auto" className="min-w-0 flex-1 truncate">{words}</span>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label={t("pages.selection.clearCite")}
          title={t("pages.selection.clearCite")}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <X size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
      )}
    </div>
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
