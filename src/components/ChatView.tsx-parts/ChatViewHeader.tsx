import { PanelRight } from "lucide-react";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { CSSProperties, Dispatch, HTMLAttributes, ReactNode } from "react";
import { downloadBotZip, showBotZipExport } from "@/lib/bot-zip";
import { splitBesideMain } from "@/lib/split-view";
import { CallOverlay } from "../CallView";
import { ExportTranscriptMenu } from "../ExportTranscriptMenu";
import { TaskPicker } from "../TaskPicker";
import { LiveCallChip } from "../LiveCallPill";
import { useConversationHeader } from "@/lib/conversation-header";
import { useStoreSelector } from "@/state/store-selector";
import { openBotThread, startNewTopic, type Action, type Bot, type ConfigStatus, type Message } from "@/state/store";
import type { SideChat } from "./sideChat";
import { ChatHeaderBar } from "@/components/ChatHeaderBar";
import { UsageChip } from "@/components/UsageChip";

/** Call overlay strip and the floating bot-pill header (or a side header). */
export function ChatViewHeader({
  side,
  bot,
  state,
  dispatch,
  botPill,
  chatHeader,
  headerDragProps,
  headerNoDragStyle,
  controlsShiftStyle,
  macInset,
  browser,
  panelOpen,
  pillPanelOpen,
  onTogglePanel,
  showInspector,
  advanced,
  remoteClient,
  showThreads,
  confidential,
  messages,
  dataItem,
}: {
  side?: SideChat;
  bot: Bot;
  state: {
    config: ConfigStatus | null | undefined;
    inspectorOpen: boolean;
  };
  dispatch: Dispatch<Action>;
  botPill: ReactNode;
  chatHeader: ReactNode;
  headerDragProps: Record<string, unknown>;
  headerNoDragStyle: CSSProperties;
  controlsShiftStyle: CSSProperties | undefined;
  macInset: boolean;
  browser: boolean;
  panelOpen: boolean;
  pillPanelOpen: boolean;
  onTogglePanel: () => void;
  showInspector: boolean;
  advanced: boolean;
  remoteClient: boolean;
  showThreads: boolean;
  confidential: boolean;
  messages: Message[];
  dataItem: unknown;
}) {
  const bots = useStoreSelector((current) => current.bots);
  const conversationHeader = useConversationHeader();
  return (
    <>
      {/* The older call mode covers the thread while the bot is on the line;
          a voice mode call docks at the top of the banner stack below */}
      {!side && <>
      <CallOverlay bot={bot} />
      {(macInset || browser) && <div className="content-topbar-strip" />}
      </>}
      {/* Header */}
      {side ? (typeof side.header === "function" ? side.header(side.panel ? botPill : null) : side.header) : <ChatHeaderBar
        {...(headerDragProps as HTMLAttributes<HTMLDivElement>)}
        // The person's choice (Settings > Appearance > Conversation, #4536):
        // the centred pill (the default), or a plain title at the top left of
        // this bar, on the bar's own ground, which hides whatever scrolls
        // there. The transcript keeps its room under the bar either way.
        align={conversationHeader === "title" ? "start" : "center"}
        // @container/chathead lets the chips on the right fold to icon
        // bubbles when the column is narrow. Pulsatrix Light makes it
        // `relative`.
        center={chatHeader}
        centerStyle={headerNoDragStyle}
      >
        <div
          data-chathead-controls
          className="flex shrink-0 items-center gap-2 @max-[30rem]/chathead:ml-auto @max-[30rem]/chathead:flex-wrap @max-[30rem]/chathead:justify-end @min-[30rem]/chathead:col-start-3 @min-[30rem]/chathead:justify-self-end"
          // The caption buttons sit over the header's right end; drop this
          // icon row 16px (visual only — the header keeps its height) so the
          // buttons clear the 26px overlay while the rest of the layout stays.
          style={controlsShiftStyle}
        >
          <UsageChip usage={bot.tasks?.find((task) => task.threadId === bot.threadId)?.usage} />
          {/* No Computer button in the header (JC 2026-11-05): Computer
              opens from the bot panel. */}
          {/* The bot panel toggle (owner 2026-11-17): a round panel icon left of
              the "...", the same toggle as the bot pill. It stays put while the
              panel is open (the panel keeps its own gear). */}
          {!remoteClient && <button
            type="button"
            data-chat-bot-panel
            aria-expanded={pillPanelOpen}
            onClick={onTogglePanel}
            aria-label={pillPanelOpen ? t("chat.closePanel") : t("chat.openPanel")}
            title={pillPanelOpen ? t("chat.closePanel") : t("chat.openPanel")}
            className={cn(CIRCLE_BUTTON, pillPanelOpen && "bg-circle-hover")}
          >
            <PanelRight size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>}
          {/* One "..." for the conversation: share and export, then the
              Inspector (Advanced) and Data (Experimental). The pill opens
              the bot's panel; while the panel is open its top bar carries
              this same menu. */}
          {/* Clear chat is the menu's first entry (JC 2026-11-06), never a
              separate button, so the menu stays while the panel is open
              when the chat has it. */}
          {(!panelOpen || !showThreads) && <ExportTranscriptMenu
            title={bot.name}
            messages={messages}
            botName={bot.name}
            onExportBot={showBotZipExport(state.config, bot) ? () => downloadBotZip(bot.id, { conversations: false, sharing: false }) : undefined}
            confidential={confidential}
            {...(!remoteClient && showInspector && advanced ? { onToggleInspector: () => dispatch({ type: "toggleInspector" }), inspectorOpen: state.inspectorOpen } : {})}
            {...(dataItem ? { data: dataItem as never } : {})}
            onSplit={(edge) => splitBesideMain(showThreads ? { kind: "bot", botId: bot.id, threadId: bot.threadId } : { kind: "bot", botId: bot.id }, edge)}
            {...(!showThreads ? { onClearChat: () => startNewTopic(dispatch, bot), clearChatKey: bot.id } : {})}
          />}
          {/* #4100: this window listens in another chat: back to it */}
          <LiveCallChip variant="listening" currentBotId={bot.id} onOpen={(botId, threadId) => { const target = bots.find((candidate) => candidate.id === botId); if (target) openBotThread(dispatch, target, threadId, showThreads); }} />
          <TaskPicker bot={bot} />
        </div>
      </ChatHeaderBar>}
    </>
  );
}
