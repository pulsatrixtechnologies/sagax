/** A conversation column for the docked panel galleries (screen panel,
 * artifact side panel): the real chat header (ChatHeaderBar, the bot pill,
 * the round controls the chat header draws) over a short transcript, so a
 * headless capture shows the panel's controls beside the chat header's. */
import { MessagesSquare, MoreHorizontal, PanelRight } from "lucide-react";
import { BotAvatar } from "../components/Avatar";
import { BotHeaderPill } from "../components/BotHeaderPill";
import { ChatHeaderBar } from "../components/ChatHeaderBar";
import { CIRCLE_BUTTON, CIRCLE_ICON } from "../lib/circle-button";
import type { Bot } from "../state/store";

export function ChatHeadSample({ bot, lines }: { bot: Bot; lines: [string, string] }) {
  return (
    <div data-chat-head-sample="" className="relative flex min-w-0 flex-1 flex-col bg-app">
      <ChatHeaderBar
        center={<BotHeaderPill name={bot.name} label={bot.title} panelOpen={false} onToggle={() => {}} avatar={<BotAvatar bot={bot} state="idle" size={24} animated={false} />} />}
      >
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" aria-label="Panel" className={CIRCLE_BUTTON}><PanelRight {...CIRCLE_ICON} aria-hidden="true" /></button>
          <button type="button" aria-label="More" className={CIRCLE_BUTTON}><MoreHorizontal {...CIRCLE_ICON} aria-hidden="true" /></button>
          <button type="button" aria-label="Tasks" className={CIRCLE_BUTTON}><MessagesSquare {...CIRCLE_ICON} aria-hidden="true" /></button>
        </div>
      </ChatHeaderBar>
      <div className="flex flex-1 flex-col gap-3 px-6 pt-[72px] text-[15px] leading-6 text-ink">
        <p className="self-end rounded-2xl bg-hover/60 px-3 py-2">{lines[0]}</p>
        <p className="self-start">{lines[1]}</p>
      </div>
    </div>
  );
}
