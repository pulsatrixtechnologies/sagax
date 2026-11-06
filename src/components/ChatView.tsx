import type { Bot } from "@/state/store";
import { MessageBoundary } from "./MessageBoundary";
import { ReplyAction, CopyButton } from "./ChatView.tsx-parts/actions";
import {
  ErrorRow,
  claudeUpdateTarget,
  FailedTurnRow,
  PreSendRefusalLine,
} from "./ChatView.tsx-parts/ErrorRows";
import { StepBoundary } from "./MessageBoundary";
import { AttentionRow, RoutineRunRow } from "./ChatView.tsx-parts/chips";
import { PreviousTopicsLine } from "./ChatView.tsx-parts/stream";
import { STREAM_ANCHOR_BAND } from "./ChatView.tsx-parts/useStreamAnchor";
import { NewConversationInstead } from "./ChatView.tsx-parts/NewConversationInstead";
import type { SideChat } from "./ChatView.tsx-parts/sideChat";
import { useChatViewSession } from "./ChatView.tsx-parts/useChatViewSession";
import { useChatViewTranscript } from "./ChatView.tsx-parts/useChatViewTranscript";
import { useChatViewStream } from "./ChatView.tsx-parts/useChatViewStream";
import { useChatViewPresence } from "./ChatView.tsx-parts/useChatViewPresence";
import { ChatViewShell } from "./ChatView.tsx-parts/ChatViewShell";

export {
  ReplyAction,
  CopyButton,
  ErrorRow,
  claudeUpdateTarget,
  FailedTurnRow,
  PreSendRefusalLine,
  AttentionRow,
  RoutineRunRow,
  PreviousTopicsLine,
  STREAM_ANCHOR_BAND,
  NewConversationInstead,
  MessageBoundary,
  StepBoundary,
};
export type { SideChat };

export function ChatView({ bot: stored, side }: { bot: Bot; side?: SideChat }) {
  "use memo";
  const session = useChatViewSession(stored, side);
  const transcript = useChatViewTranscript({
    bot: session.bot,
    state: session.state,
    storeBots: session.storeBots,
    engine: session.engine,
    focus: session.focus,
    dispatch: session.dispatch,
    composerDockPad: session.composerDock.pad,
    sideLoadOlder: side?.loadOlder,
    sideLoadingOlder: side?.loadingOlder,
    preview: session.preview,
  });
  const stream = useChatViewStream({
    bot: session.bot,
    side,
    showThreads: session.showThreads,
    preview: session.preview,
    dispatch: session.dispatch,
    pendingQueued: session.pendingQueued,
    messages: transcript.messages,
    windowedMessages: transcript.windowedMessages,
    olderPending: transcript.olderPending,
    hiddenCount: transcript.hiddenCount,
    stopFollowing: transcript.stopFollowing,
    composerDockRef: session.composerDockRef,
    engine: session.engine,
  });
  const presence = useChatViewPresence({
    bot: session.bot,
    profile: session.profile,
    messages: transcript.messages,
    dispatch: session.dispatch,
    state: session.state,
    side,
    pillPanelOpen: session.pillPanelOpen,
    mascotMotion: session.mascotMotion,
    pendingQueued: session.pendingQueued,
    canWrite: session.canWrite,
    openPage: session.openPage,
    pageStage: session.pageStage,
    composerDockHeight: session.composerDock.height,
  });

  return (
    <ChatViewShell
      {...session}
      {...transcript}
      {...stream}
      {...presence}
      side={side}
      selectReply={session.selectReply}
      showRunCard={transcript.showRunCard}
    />
  );
}
