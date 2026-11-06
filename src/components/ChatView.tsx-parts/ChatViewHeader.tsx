import type { CSSProperties, Dispatch, ReactNode } from "react";
import { downloadBotZip, showBotZipExport } from "@/lib/bot-zip";
import { splitBesideMain } from "@/lib/split-view";
import { CallOverlay } from "../CallView";
import { ExportTranscriptMenu } from "../ExportTranscriptMenu";
import { TaskPicker } from "../TaskPicker";
import { cn } from "@/lib/cn";
import type { Action, Bot, ConfigStatus, Message } from "@/state/store";
import { NewTopicButton } from "./stream";
import type { SideChat } from "./sideChat";

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
  showInspector: boolean;
  advanced: boolean;
  remoteClient: boolean;
  showThreads: boolean;
  confidential: boolean;
  messages: Message[];
  dataItem: unknown;
}) {
  return (
    <>
      {/* The older call mode covers the thread while the bot is on the line;
          a voice mode call docks at the top of the banner stack below */}
      {!side && <>
      <CallOverlay bot={bot} />
      {(macInset || browser) && <div className="content-topbar-strip" />}
      </>}
      {/* Header */}
      {side ? (typeof side.header === "function" ? side.header(side.panel ? botPill : null) : side.header) : <div
        {...headerDragProps}
        className={cn(
          "content-topbar",
          // @container so the chips on the right can fold to icon bubbles
          // when the column is narrow (side panel open, small window)
          // Grok-style: no bar. The header floats over the transcript, which
          // scrolls under it; only the bot pill and the controls show.
          // Pulsatrix Light overrides `position` to `relative` (see
          // styles.css): a normal band, not a float, but still the
          // containing block the centered pill below needs.
          "@container/chathead absolute inset-x-0 top-0 z-[3] flex min-h-[52px] items-center justify-end px-5 py-2.5",
          // Room for the drawer button, which overlays this corner below sm.
          "pl-11 sm:pl-5",
        )}
      >
        <div className="absolute left-1/2 top-1/2 flex max-w-[60%] -translate-x-1/2 -translate-y-1/2 items-center gap-2" style={headerNoDragStyle}>
          {chatHeader}
        </div>
        <div
          data-chathead-controls
          className="flex shrink-0 items-center gap-2 @max-[30rem]/chathead:ml-auto @max-[30rem]/chathead:flex-wrap @max-[30rem]/chathead:justify-end @min-[30rem]/chathead:col-start-3 @min-[30rem]/chathead:justify-self-end"
          // The caption buttons sit over the header's right end; drop this
          // icon row 16px (visual only — the header keeps its height) so the
          // buttons clear the 26px overlay while the rest of the layout stays.
          style={controlsShiftStyle}
        >
          {/* No Computer button in the header (JC 2026-11-05): Computer
              opens from the bot panel. */}
          {/* One "..." for the conversation: share and export, then the
              Inspector (Advanced) and Data (Experimental). The pill opens
              the bot's panel; while the panel is open its top bar carries
              this same menu. */}
          {!panelOpen && <ExportTranscriptMenu
            title={bot.name}
            messages={messages}
            botName={bot.name}
            onExportBot={showBotZipExport(state.config, bot) ? () => downloadBotZip(bot.id, { conversations: false, sharing: false }) : undefined}
            confidential={confidential}
            {...(!remoteClient && showInspector && advanced ? { onToggleInspector: () => dispatch({ type: "toggleInspector" }), inspectorOpen: state.inspectorOpen } : {})}
            {...(dataItem ? { data: dataItem as never } : {})}
            onSplit={(edge) => splitBesideMain(showThreads ? { kind: "bot", botId: bot.id, threadId: bot.threadId } : { kind: "bot", botId: bot.id }, edge)}
          />}
          {!showThreads && <NewTopicButton bot={bot} />}
          <TaskPicker bot={bot} />
        </div>
      </div>}
    </>
  );
}
