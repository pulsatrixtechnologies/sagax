// @ts-nocheck
/** fanoutSsePayload (#1388). Pure move from server/index.ts. */
import { ruleNotifyFrame } from "../notify.ts";
import { decideNotifyPushes, type DecidedPushes } from "./observePushFrame.ts";
import { deliverSseFrame, encodeSseDataFrame, sseKindSkipsMembershipRecheck } from "../streams/sse-fanout.ts";
export type Host = Record<string, any>;

export function createFanoutSsePayload(getHost: () => Host): any {
function fanoutSsePayload(payload: Record<string, unknown>, options: { adminOnly?: boolean } = {}) {
  const host = getHost();
  const { configForAccess } = host;
  // #3719: the one rule on what interrupts, for every notify frame (logged)
  // #4233: a frame that would interrupt asks the person's signal gate once
  // (quiet hours, day budget; urgent always passes): the desktop, its shell
  // and the phone follow that one verdict
  let decided: DecidedPushes | undefined;
  const raw = payload;
  payload = ruleNotifyFrame(payload, {
    ...options,
    signal: () => {
      try {
        decided = decideNotifyPushes(host, raw, options);
      } catch (error) {
        console.warn(`push: a frame could not be read for its signal (${error instanceof Error ? error.message : String(error)})`);
        decided = undefined;
      }
      // each verdict names its person: a frame for several people goes quiet
      // only on the streams of those held (sseFrameFor)
      return decided ? decided.messages.map((message, index) => ({ person: String(message.personId ?? ""), decision: decided.decisions[index], reason: decided.reasons?.[index] })) : [];
    }
  });

  host.observeAchievementFrame(payload);
  host.observePushFrame(payload, options, decided);
  host.observeLiveActivityFrame(payload);
  const kind = String(payload.kind ?? "");
  // Membership may change through fleet/CLI config writes. Recheck on durable
  // frames only: a content.delta storm must not rescan email sessions.
  // Throttled to at most once a second unless membershipChanged() ran.
  if (!sseKindSkipsMembershipRecheck(kind)) host.sessions.recheckMembership();
  const seq = ++host.lastSeq;
  const frame = encodeSseDataFrame(host.STREAM_ID, seq, { ...payload, seq });
  // Store both projections as immutable frames: live and reconnecting clients
  // must receive the same filtered config without changing the admin event.
  const clientFrame = options.adminOnly
    ? null
    : kind === "config"
      ? encodeSseDataFrame(host.STREAM_ID, seq, { ...configForAccess(payload as ReturnType<typeof host.configStatus>, false), seq })
      : frame;
  // Live desktop captures can each be hundreds of kilobytes and become stale
  // as soon as the next one arrives. Keep their sequence slots so resume-gap
  // detection stays honest, but never retain their base64 payloads.
  host.replayBuffer.push({ seq, kind, frame: kind === "screen" ? null : frame, clientFrame: kind === "screen" ? null : clientFrame, payload: kind === "screen" ? null : payload });
  for (const client of host.sseClients) {
    if (!host.wants(client, kind)) continue;
    // Admin-only frames (clientFrame null) never reach members, and a member never falls back to the admin frame.
    // A signed-in admin has a viewerId and goes through memberFrame so hidden
    // channels stay hidden. Loopback (no viewerId) still gets the raw frame.
    const out = host.sseFrameFor(client, seq, payload, frame, clientFrame);
    if (out === null) continue;
    // Screen frames are replaceable and durable events are not: see
    // ./sse-fanout.ts for the backpressure/bound decision this makes.
    if (deliverSseFrame(client, kind, out) === "disconnected") client.close();
  }
  if (kind === "bot" && payload.bot && typeof payload.bot === "object") {
    const id = (payload.bot as { id?: unknown }).id;
    if (typeof id === "string") host.announceProfileChange(id);
  }
  // an admin card opened, answered, dismissed or expired: tell the admins
  if ((kind === "message" || kind === "message.patch") && payload.message && typeof payload.message === "object") {
    const card = (payload.message as { card?: { adminApproval?: unknown } }).card;
    if (card?.adminApproval) host.scheduleAdminApprovalsAnnounce();
  }

}
  return fanoutSsePayload;
}
