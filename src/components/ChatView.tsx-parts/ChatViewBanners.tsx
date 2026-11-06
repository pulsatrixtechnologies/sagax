import type { Dispatch } from "react";
import { segmentsAbove } from "@/lib/single-stream";
import { ChatErrorBanner, ChatNotice, ChatReconnectBanner, ChatStaleBanner } from "../ChatErrorBanner";
import { WeeklyLimitNotice } from "../ChatUsageNotices";
import { EngineLimitNotice } from "../LimitResetContinue";
import { ChatFindBar } from "../ChatFindBar";
import { ConfidentialBanner } from "../ConfidentialBanner";
import { AccessCard } from "../AccessCard";
import { TransientNotice } from "../TransientNotice";
import { VoiceCallDock } from "../CallView";
import { ThreadReturnLink } from "../TaskPicker";
import { TurnTimingLine } from "../TurnTimingLine";
import { t } from "@/lib/i18n";
import type { Action, Bot, Message } from "@/state/store";
import { PinnedBanner } from "./PinnedBanner";
import { RoutineRunRow } from "./chips";
import type { SideChat } from "./sideChat";

/** Banner stack under the floating header (timing, confidential, notices, pin). */
export function ChatViewBanners({
  side,
  bot,
  profile,
  state,
  dispatch,
  showThreads,
  confidential,
  privateHint,
  findOpen,
  setFindOpen,
  streamOn,
  remoteClient,
  messages,
  autoPauseSettled,
  resumeAutoPaused,
}: {
  side?: SideChat;
  bot: Bot;
  profile: Bot;
  state: {
    error: string | null | undefined;
    notice: unknown;
    connected: boolean;
    everConnected: boolean;
    disconnectedAt: number | null | undefined;
    config: { viewer?: { principalId?: string | null; role?: string } } | null | undefined;
  };
  dispatch: Dispatch<Action>;
  showThreads: boolean;
  confidential: boolean;
  privateHint: boolean;
  findOpen: boolean;
  setFindOpen: (open: boolean) => void;
  streamOn: boolean;
  remoteClient: boolean;
  messages: Message[];
  autoPauseSettled: (m: Message) => boolean;
  resumeAutoPaused: (m: Message, close: () => void) => (() => void) | undefined;
}) {
  return (
    <>
      <TurnTimingLine timing={profile.tasks?.find((task) => task.threadId === bot.threadId)?.turnTiming} />
      {/* Banners sit below the floating header; the wrapper vanishes when
          none is showing so the transcript can run to the top. */}
      <div className="chat-banners pt-[52px] empty:hidden">
      {confidential && <ConfidentialBanner position="top" className="mb-2" />}
      {/* Voice mode's call pill: first in the stack, centered right under
          the name chip; collapsed it keeps its own small row, expanded its
          card hangs over the thread */}
      <VoiceCallDock bot={bot} />
      {/* Threads off = one unified conversation (2026-10-22): no
          cross-thread chrome at the top. The "Other activity" dropdown, the
          "New activity on an earlier topic" pill and the "Back to
          conversation" links all belonged to the thread-off escape hatches;
          they are gone now. The conversation's own topics still stream in
          place below (PreviousTopicsLine / StreamEarlierTopics) and the New
          topic feature keeps its own Resume (FreshTopicDivider). The thread
          return link stays only while threads are on. */}
      {!side && showThreads && <ThreadReturnLink ownerId={bot.id} threadId={bot.threadId} />}
      {privateHint && <p data-private-conversation-hint className="mx-5 mb-2 text-[11.5px] text-ink-secondary">{t("chat.privateConversation")}</p>}
      {findOpen && <ChatFindBar threadId={bot.threadId} {...(streamOn ? { threadIds: [bot.threadId, ...segmentsAbove(bot.tasks, bot.threadId).map((task) => task.threadId)] } : {})} onClose={() => setFindOpen(false)} />}

      {!side && <ChatErrorBanner message={state.error ?? null} onDismiss={() => dispatch({ type: "error", message: null })} />}
      {!side && <ChatNotice notice={state.notice as never} />}
      {!side && <ChatReconnectBanner connected={state.connected} everConnected={state.everConnected} disconnectedAt={state.disconnectedAt ?? null} />}
      {!side && <TransientNotice messages={messages} settled={autoPauseSettled} render={(m, close) => m.kind === "access" && m.access ? (
        <AccessCard
          access={m.access}
          viewer={{ principalId: state.config?.viewer?.principalId ?? null, admin: state.config?.viewer?.role === "admin" || state.config?.viewer?.role === "owner" }}
          onSignIn={() => { close(); dispatch({ type: "toggleAppSettings", open: true, section: "providers" }); }}
        />
      ) : <RoutineRunRow message={m} botId={bot.id} onResume={resumeAutoPaused(m, close)} />} />}
      {!side && <ChatStaleBanner />}
      {!side && !remoteClient && <WeeklyLimitNotice />}
      {/* Engine near/at its limit: full-width banner (not a header pill). */}
      {!side && !remoteClient && (
        <EngineLimitNotice
          engine={bot.modelSelection?.instanceId}
          botId={bot.id}
          threadId={bot.threadId}
        />
      )}

      {/* Pinned message banner */}
      <PinnedBanner
        bot={bot}
        pinnedId={bot.pinnedMessageId}
        messages={messages}
        onJump={(messageId) =>
          dispatch({ type: "focusMessage", threadId: bot.threadId, messageId })
        }
        onUnpin={remoteClient ? undefined : () =>
          dispatch({ type: "updateTask", botId: bot.id, threadId: bot.threadId, patch: { pinnedMessageId: "" } })
        }
      />
      </div>
    </>
  );
}
