// Conference call mode — one microphone, several room members.
//
// Capture stays half-duplex for the same reason as one-to-one calls: the
// native recognizer has no acoustic echo cancellation. Bot replies are
// explicitly queued so a fast second member never cuts off the first.
//
// While the room works in silence the call says a short progress line built
// from this turn's real tool events, rate-limited like a Live call
// (src/lib/voice-mode/progress.ts): never the server's English chip
// narration (the chip's `spoken` text), never a tool name. One turn may
// reach several members, so a line is generic and is said in a member's voice only when
// every tool of the turn is that member's (`turnToolAuthor`); otherwise in
// the call's own voice, never attributed to the wrong bot.
import { useRef } from "react";

import { useOnCall } from "@/lib/call";
import { track } from "@/lib/analytics";
import { useSpeech } from "@/lib/tts/useSpeech";
import { usePushToTalk } from "@/lib/push-to-talk";
import { useStore, type Bot, type Group } from "@/state/store";
import { CallTargetButton, useOrganizationCall } from "./CallView";
import { VoiceModeCallButton } from "./voice-mode/VoiceModeCallButton";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { pendingApprovals } from "./PendingApproval";
import { CallFailure } from "@/lib/voice-mode/failure";
import type { Phase } from "./GroupCallView.tsx-parts/types";
import { questionIn } from "./GroupCallView.tsx-parts/questionIn";
import { useGroupCallSpeech } from "./GroupCallView.tsx-parts/useGroupCallSpeech";
import { useGroupCallTurnEffects } from "./GroupCallView.tsx-parts/useGroupCallTurnEffects";
import { GroupCallStage } from "./GroupCallView.tsx-parts/GroupCallStage";

export function GroupCallButton({ group, members }: { group: Group; members: Bot[] }) {
  // a room on an organization server: voice mode talks to one bot at a time
  const organization = useOrganizationCall();
  const { capabilities, ready } = useDesktopCapabilities();
  if (group.dm) return null;
  if (organization) {
    return <VoiceModeCallButton targetId={group.id} targetName={group.name} group onStart={() => {}} />;
  }
  // A room call takes turns, which only the Mac app's own page can do, and a
  // room has no Live call: elsewhere (a browser, the Windows or Linux app, My
  // Cloud) there is no room call to offer, so no button that can't start one.
  if (ready && !capabilities.dictation.available) return null;
  return (
    <CallTargetButton
      targetId={group.id}
      targetName={group.name}
      voices={members.map((member) => member.voice)}
      setupBotId={members.find((member) => !member.voice)?.id ?? members[0]?.id}
      requireExplicitVoices
      onStart={() => track("group_call_started", { memberCount: members.length })}
    />
  );
}

export function GroupCallOverlay({ group, members }: { group: Group; members: Bot[] }) {
  const active = useOnCall() === group.id;
  if (!active) return null;
  return <GroupCall group={group} members={members} />;
}

function GroupCall({ group, members }: { group: Group; members: Bot[] }) {
  const { dispatch } = useStore();
  const speechUi = useSpeech();
  const initialPhase: Phase = group.working || group.busyBotId ? "working" : "listening";
  const speech = useGroupCallSpeech({
    groupId: group.id,
    initialPhase,
    dispatch,
  });
  const pushToTalk = usePushToTalk(group.id, speech.phase === "listening", () => {
    speech.setNote("Push to talk couldn't start. Check Microphone and Speech Recognition access.");
  });

  const messages = group.messages;
  const approval = pendingApprovals(messages)[0];
  const question = questionIn(messages);
  const membersRef = useRef(members);
  const defaultResponderRef = useRef(group.defaultResponder);
  membersRef.current = members;
  speech.busyRef.current = Boolean(group.working || group.busyBotId);
  defaultResponderRef.current = group.defaultResponder;

  const spokenIds = useRef<Set<string>>(new Set());
  /** A failed turn: one sentence with what to do, then silence (failure.ts). */
  const failure = useRef<CallFailure | null>(null);
  const started = useRef(false);
  if (!started.current) {
    started.current = true;
    for (const message of messages) spokenIds.current.add(message.id);
    failure.current = new CallFailure(messages);
  }

  const askedApproval = useRef<{
    requestId: string;
    member?: Bot;
    routine: boolean;
    skill: boolean;
    submitted: boolean;
  } | null>(null);
  const askedQuestion = useRef<{ requestId: string; member?: Bot } | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useGroupCallTurnEffects({
    group,
    members,
    messages,
    approval,
    question,
    dispatch: dispatch as (action: Record<string, unknown>) => void,
    speech,
    membersRef,
    defaultResponderRef,
    messagesRef,
    spokenIds,
    failure,
    askedApproval,
    askedQuestion,
  });

  return (
    <GroupCallStage
      group={group}
      members={members}
      phase={speech.phase}
      heard={speech.heard}
      note={speech.note}
      speakingMemberId={speech.speakingMemberId}
      pushToTalk={pushToTalk}
      speechCaption={speechUi.caption}
      speechError={speechUi.error}
      onListen={speech.listen}
      onInterrupt={speech.interruptSpeech}
    />
  );
}
