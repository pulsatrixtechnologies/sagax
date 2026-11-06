// Activity > Computer (reference design, #2125): one row, "Bot's computer"
// over Awake (or Working while the bot is busy), the last screen the bot
// sent as a thumbnail on the right. A click opens the computer view
// (ComputerPanel) in the wide detail panel; the store's computerOpen is the
// same flag every "open the computer" link sets. No screen yet: a wallpaper
// stands in, never an icon.
import { useState } from "react";

import { useStoreDispatch } from "@/state/store-selector";
import type { Bot } from "@/state/store";
import { PANEL_CARD, PANEL_LABEL, PANEL_ROW } from "@/lib/grouped-card";
import { t } from "@/lib/i18n";
import { screenFramePreview } from "../ScreenFrame";

/** The last screen the bot sent in its conversation, if the server holds one. */
export function lastScreenSrc(bot: Pick<Bot, "messages" | "threadId">): string | null {
  for (let index = bot.messages.length - 1; index >= 0; index -= 1) {
    const message = bot.messages[index]!;
    if (message.kind === "screen" && (message.hasImage || message.png)) {
      return screenFramePreview({ threadId: bot.threadId, messageId: message.id }, message.mime).src;
    }
  }
  return null;
}

export function ComputerCard({ bot }: { bot: Bot }) {
  const dispatch = useStoreDispatch();
  const src = lastScreenSrc(bot);
  const [broken, setBroken] = useState<string | null>(null);
  const status = bot.busy ? t("botPanel.computerCard.working") : t("botPanel.computerCard.awake");
  return (
    <section data-bot-settings-section="computer" aria-labelledby={`bot-computer-${bot.id}`} className="flex flex-col gap-2">
      <h3 id={`bot-computer-${bot.id}`} className={PANEL_LABEL}>{t("botPanel.tab.computer")}</h3>
      <div className={PANEL_CARD}>
        <button
          type="button"
          data-computer-card=""
          onClick={() => dispatch({ type: "toggleComputer", open: true })}
          className={`${PANEL_ROW} flex w-full min-w-0 items-center gap-3 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60`}
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[14px] font-normal leading-5 text-ink">{t("botPanel.computerCard.title")}</span>
            <span data-computer-status={bot.busy ? "working" : "awake"} className="truncate text-[13px] leading-[18px] text-ink-tertiary">
              {status}
            </span>
          </span>
          <span aria-hidden="true" data-computer-thumb={src && broken !== src ? "screen" : "wallpaper"} className="h-[29px] w-[46px] shrink-0 overflow-hidden rounded-[5px]" style={src && broken !== src ? undefined : { background: WALLPAPER }}>
            {src && broken !== src && <img src={src} alt="" loading="lazy" onError={() => setBroken(src)} className="size-full object-cover" />}
          </span>
        </button>
      </div>
    </section>
  );
}

/** The desktop wallpaper shown before the bot sent any screen. */
const WALLPAPER = "radial-gradient(120% 90% at 20% 15%, #6d8cff 0%, transparent 55%), radial-gradient(110% 100% at 85% 90%, #c86bd6 0%, transparent 60%), linear-gradient(135deg, #24305e 0%, #3b2a63 55%, #1c1f3a 100%)";
