// @ts-nocheck
/** fanoutSsePayload (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createFanoutSsePayload(getHost: () => Host): any {
function fanoutSsePayload(payload: Record<string, unknown>, options: { adminOnly?: boolean } = {}) {
  const host = getHost();
  const { configForAccess } = host;

  host.observeAchievementFrame(payload);
  host.observePushFrame(payload);
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
