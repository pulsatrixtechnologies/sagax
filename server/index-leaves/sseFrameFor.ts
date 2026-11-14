// @ts-nocheck
/** sseFrameFor (#1388). Pure move from server/index.ts. */
import { voiceOpenerFrameAllowed } from "../voice/voice-first-sentence.ts";
import { phoneToolsFrameAllowed } from "../../shared/phone-tools.ts";
import { liveFramesNeedChannelFilter, sseFrameProjection } from "../rooms/channel-visibility.ts";
import { botActFrameAllowed } from "../../shared/bot-act.ts";
import { teamWorkFrameAllowed } from "../../shared/team-work.ts";
import { achievementFrameAllowed } from "../achievements/achievements.ts";
import { encodeSseDataFrame } from "../streams/sse-fanout.ts";
import { notifyHeldFor } from "../notify.ts";
import { dataFrameAllowed } from "../data/scope.ts";
import { screenVisibleToPrincipal } from "../sandbox/user-sandbox-routing.ts";
export type Host = Record<string, any>;

export function createSseFrameFor(getHost: () => Host): any {
function sseFrameFor(   client: SseClient,   seq: number,   payload: Record<string, unknown> | null,   frame: string | null,   clientFrame: string | null, ) {
  const host = getHost();
  const { PHONE_TOOLS_FRAME } = host;

  if (payload && !host.peopleDmFrameAllowed(payload, client.viewerId)) return null;
  if (payload && host.temporaryAgentFrame(payload)) return null;
  if (payload && host.viewerNotificationMuted(payload, client.viewerId)) return null;
  // #4233: a frame this person's own quiet hours or day budget held reaches
  // their streams as notify false; the others it is for still hear it
  if (payload?.kind === "notify" && notifyHeldFor(payload, client.viewerId || host.localPrincipalId())) {
    payload = { ...payload, notification: { ...(payload.notification as Record<string, unknown>), notify: false } };
    const serialized = encodeSseDataFrame(host.STREAM_ID, seq, { ...payload, seq });
    frame = serialized;
    if (clientFrame !== null) clientFrame = serialized;
  }
  // A conversation between two people carries each person's own unread
  // state, and never who else has read it (server/people/people-dms.ts).
  // Its threads too, per thread. A frame always carries the default
  // thread: a client that knows threads keeps the one it has open.
  if (payload?.kind === "group" && payload.group && typeof payload.group === "object" &&
    (Array.isArray((payload.group as { unreadFor?: unknown }).unreadFor) || (payload.group as { peopleDm?: unknown }).peopleDm === true)) {
    const carried = payload.group as { peopleDm?: boolean; unread?: boolean; unreadFor?: string[]; tasks?: Array<{ threadId: string; unreadFor?: string[] }> };
    payload = { ...payload, group: host.peopleDmForViewer(carried, client.viewerId || client.approvalUserId || host.localPrincipalId()) };
    const serialized = encodeSseDataFrame(host.STREAM_ID, seq, { ...payload, seq });
    frame = serialized;
    if (clientFrame !== null) clientFrame = serialized;
  }
  // the approvals waiting for an organization admin reach the admins only
  if (payload?.kind === "org.approvals" && !host.orgAdminStream(client)) return null;
  // a person's unlocks reach that person's streams only
  if (payload?.kind === "achievements" && !achievementFrameAllowed(payload, client.viewerId, host.localPrincipalId())) return null;
  // a person's phone tool requests reach that person's own streams only
  if (payload?.kind === PHONE_TOOLS_FRAME && !phoneToolsFrameAllowed(payload, client.viewerId, host.localPrincipalId())) return null;
  // a person's device settings requests reach that person's own streams only (#1545)
  if (payload?.kind === host.DEVICE_SETTINGS_FRAME && !host.deviceSettingsFrameAllowed(payload, client.viewerId, host.localPrincipalId())) return null;
  // a person's preferences reach that person's own devices only
  if (payload?.kind === "preferences" && !host.preferencesFrameAllowed(payload, client.viewerId)) return null;
  // a person left a group: that person's own streams only (server/groups/group-leave.ts)
  if (payload?.kind === "group.left") return host.groupLeftFrameAllowed(payload, client.viewerId, host.localPrincipalId()) ? clientFrame ?? frame : null;
  if ((payload?.kind === "nudge" || payload?.kind === "nudge.sent") && !host.nudgeFrameAllowed(payload, client.viewerId, host.localPrincipalId())) return null;
  if ((payload?.kind === "voice.opener" || payload?.kind === "voice.call.ended") && !voiceOpenerFrameAllowed(payload, client.viewerId, host.localPrincipalId())) return null;
  if (payload?.kind === "presence.changed" && !host.presenceFrameAllowed(payload, client)) return null;
  if (payload?.kind === "cloud.agent" && typeof payload.botId === "string") {
    const bot = host.store.bot(payload.botId);
    if (!bot || !host.listedBotVisible(bot, client.viewerId || undefined)) return null;
    // A shared bot: a run launched in someone else's thread reaches only
    // the people who may read that thread (same rule as the list route).
    const itemId = payload.item && typeof payload.item === "object" ? (payload.item as { id?: unknown }).id : undefined;
    const record = typeof itemId === "string" ? host.cloudAgentStore.get(itemId) : null;
    if (!record || !host.cloudAgentRecordVisible(record, client.viewerId || undefined)) return null;
  }
  // A read position in a conversation between two people follows both
  // people's "Send read receipts" choice (server/messages/read-receipts.ts).
  if (payload?.kind === "thread.read" && !host.threadReadFrameAllowed(payload, client.viewerId)) return null;
  // A Data sheet reaches the person whose scope it is (data/scope.ts).
  // This is before the admin short-circuit: an admin does not see it.
  if (payload?.kind === "data" && !dataFrameAllowed(payload, client.viewerId, host.localPrincipalId())) return null;
  // a bot's task list changed: that person's streams only (shared/bot-task-list.ts)
  if (payload && !host.botTasksFrameAllowed(payload, client.viewerId || undefined, host.localPrincipalId())) return null;
  // an orchestrator's team work changed: that person's streams only (shared/team-work.ts)
  if (payload && !teamWorkFrameAllowed(payload, client.viewerId || undefined, host.localPrincipalId())) return null;
  if (payload?.kind === "bot-act" && !botActFrameAllowed(typeof payload.audience === "string" ? payload.audience : "", client.viewerId, host.localPrincipalId())) return null;
  if (payload) {
    const scoped = host.scopeChannelApproval(payload, host.approvalViewerOf(client));
    if (scoped.action === "drop") return null;
    if (scoped.action === "replace") {
      payload = scoped.payload;
      const serialized = encodeSseDataFrame(host.STREAM_ID, seq, { ...payload, seq });
      frame = serialized;
      clientFrame = serialized;
    }
  }
  // Private threads (server/threads/thread-privacy.ts): a bot frame shows each
  // organization viewer their own threads and transcript only, and queued
  // sends list their threads only. Admin streams too: the admin projection
  // below would otherwise send the frame as it was broadcast.
  if (payload && client.viewerId && host.privateThreads() && (payload.kind === "bot" || payload.kind === "bot.queued")) {
    let narrowed: Record<string, unknown> = payload;
    if (payload.kind === "bot" && payload.bot && typeof payload.bot === "object" && !Array.isArray(payload.bot)) {
      const bot = host.botForViewer(payload.bot as Record<string, unknown>, client.viewerId);
      if (bot !== payload.bot) narrowed = { ...payload, bot };
    } else if (payload.kind === "bot.queued" && payload.queues && typeof payload.queues === "object") {
      const queues = payload.queues as Record<string, unknown>;
      const shown = host.threadKeyedForViewer(queues, client.viewerId);
      if (Object.keys(shown).length !== Object.keys(queues).length) narrowed = { ...payload, queues: shown };
    }
    if (narrowed !== payload) {
      payload = narrowed;
      const serialized = encodeSseDataFrame(host.STREAM_ID, seq, { ...payload, seq });
      frame = serialized;
      if (clientFrame !== null) clientFrame = serialized;
    }
  }
  // A config frame names its viewer: each stream gets its own profile and
  // viewer block, never another person's.
  if (payload?.kind === "config" && clientFrame !== null && client.identity) {
    const identity = client.identity();
    const projected = host.orgXaiMediaView(host.configForPerson(host.configForAccess(payload as ReturnType<typeof host.configStatus>, client.admin), identity), identity);
    return encodeSseDataFrame(host.STREAM_ID, seq, { ...projected, seq });
  }
  // #2045: a team list is one person's own, admins included. The first
  // admin's stream has no viewerId (the operator sees every channel), so
  // name the person by their sign-in, before the admin short-circuit.
  const teamViewer = client.viewerId || client.approvalUserId;
  if (payload?.kind === "sections" && clientFrame !== null && host.IDENTITY.kind === "perspicax" && teamViewer && Array.isArray(payload.sections)) {
    const sections = host.orgVisibleSections(payload.sections.filter((name): name is string => typeof name === "string"), teamViewer);
    return encodeSseDataFrame(host.STREAM_ID, seq, { ...payload, sections, seq });
  }
  // A live screen of a person's cloud computer reaches that person only.
  // This is before the admin short-circuit: an admin does not see it.
  if (payload?.kind === "screen" && !screenVisibleToPrincipal({
    organization: host.IDENTITY.kind === "perspicax",
    viewerId: client.viewerId,
    workplacePrincipal: (typeof payload.threadId === "string" ? host.turnWorkplaces.get(payload.threadId)?.decision.principal : undefined) ?? undefined
  })) return null;
  if (client.admin && (!liveFramesNeedChannelFilter(client.viewerId) || clientFrame === null)) return frame;
  if (clientFrame === null || !payload) return clientFrame;
  const filtered = host.memberFrame(client, seq, payload, clientFrame);
  if (filtered === null) return null;
  return sseFrameProjection({ admin: client.admin }) === "admin" ? frame : filtered;

}
  return sseFrameFor;
}
