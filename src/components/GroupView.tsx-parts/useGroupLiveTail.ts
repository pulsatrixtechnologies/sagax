import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Bot, Group } from "@/state/store";
import { useOnCall } from "@/lib/call";
import { awaitedMemberId, showWorkingDots } from "@/lib/turn-tail";
import { liveActivityPhrases } from "@/lib/live-activity";
import { latestFailure, latestReply, type TranscriptSnapshot } from "@/lib/transcript-announcer";
import { pendingApprovals } from "../PendingApproval";
import { roomSpeakerIds, roomThreadSpeakerId, roomThreadWorking } from "@/lib/room-threads";

export function useGroupLiveTail(group: Group, members: Bot[]) {
  const speaker = members.find((b) => b.id === group.busyBotId);
  // The room's threads run side by side: what this view shows working is the
  // open thread; members busy in another thread are marked apart below.
  const threadWorking = roomThreadWorking(group, group.threadId);
  const speakersElsewhere = useMemo(
    () => new Set(roomSpeakerIds(group).filter((id) => id !== group.busyBotId)),
    [group],
  );
  // The member working in the open thread: the one its Stop holds.
  const threadSpeakerId = roomThreadSpeakerId(group, group.threadId);
  const threadSpeaker = threadSpeakerId ? members.find((b) => b.id === threadSpeakerId) : undefined;

  // Mascot stays while a member works; the finished reply pops in above it.
  const lastGroupMessage = group.messages.at(-1);
  const activity = liveActivityPhrases(lastGroupMessage);
  // A member busy elsewhere takes its turn when free; until then the room
  // works with no speaker, and the presence row names who it is waiting on.
  const awaited = members.find(
    (b) => b.id === awaitedMemberId(threadWorking, group.busyBotId, lastGroupMessage),
  );
  const waiting =
    Boolean(speaker && showWorkingDots(true, group.messages.at(-1), speaker.id)) || awaited !== undefined;
  const wasWaiting = useRef(false);
  // the reply was drawn as it was written (LiveReply): it settles in place
  // On a call the words are spoken, not typed out (same as iOS ChatLiveTail).
  const onCall = useOnCall() === group.id;
  const liveShown = useRef(false);
  const [popping, setPopping] = useState<{ id: string; botId?: string } | null>(null);
  const poppingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (poppingTimer.current) clearTimeout(poppingTimer.current);
  }, []);
  useLayoutEffect(() => {
    if (poppingTimer.current) clearTimeout(poppingTimer.current);
    poppingTimer.current = null;
    wasWaiting.current = false;
    liveShown.current = false;
    setPopping(null);
  }, [group.id, group.threadId]);
  useEffect(() => {
    if (waiting) wasWaiting.current = true;
  }, [waiting]);
  useLayoutEffect(() => {
    if (lastGroupMessage?.role !== "bot" || lastGroupMessage.kind !== "text" || !wasWaiting.current) return;
    wasWaiting.current = false;
    if (liveShown.current) {
      liveShown.current = false;
      return;
    }
    setPopping({
      id: lastGroupMessage.id,
      botId: lastGroupMessage.from?.botId,
    });
    const messageId = lastGroupMessage.id;
    if (poppingTimer.current) clearTimeout(poppingTimer.current);
    poppingTimer.current = setTimeout(() => {
      poppingTimer.current = null;
      setPopping((current) => current?.id === messageId ? null : current);
    }, 520);
  }, [
    lastGroupMessage?.id,
    lastGroupMessage?.role,
    lastGroupMessage?.kind,
    lastGroupMessage?.from?.botId,
  ]);
  const presenceVisible = waiting || popping !== null;
  const announcement = useMemo((): TranscriptSnapshot => {
    const approval = pendingApprovals(group.messages)[0];
    return {
      busy: threadWorking,
      reply: latestReply(group.messages, (m) => m.from?.name ?? group.name),
      failure: latestFailure(group.messages, (m) => m.from?.name ?? group.name),
      approval: approval
        ? { id: approval.requestId, name: approval.message.from?.name ?? speaker?.name ?? group.name }
        : undefined,
    };
  }, [group.messages, threadWorking, group.name, speaker?.name]);
  const presenceSpeaker =
    speaker ?? awaited ?? members.find((member) => member.id === popping?.botId) ?? members[0];

  return {
    speaker,
    activity,
    onCall,
    liveShown,
    popping,
    presenceVisible,
    presenceSpeaker,
    announcement,
    speakersElsewhere,
    threadSpeaker,
  };
}
