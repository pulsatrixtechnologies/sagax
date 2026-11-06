// @ts-nocheck
/** memberFrame (#1388). Pure move from server/index.ts. */
import { liveFramesNeedChannelFilter } from "../rooms/channel-visibility.ts";
import { frameForMember, noteSeen } from "../bots/bot-visibility.ts";
import { encodeSseDataFrame } from "../streams/sse-fanout.ts";
export type Host = Record<string, any>;

export function createMemberFrame(getHost: () => Host): any {
function memberFrame(client: SseClient, seq: number, payload: Record<string, unknown>, clientFrame: string | null) {
  const host = getHost();

  // A frame kept from clients altogether stays kept: never the admin copy.
  if (clientFrame === null) return null;
  if (liveFramesNeedChannelFilter(client.viewerId) && client.viewerId && !host.memberSeesFrame(payload, client.viewerId)) return null;
  // Slice 4: an organization member hears only the section names they see.
  if (host.IDENTITY.kind === "perspicax" && client.viewerId && payload.kind === "sections" && Array.isArray(payload.sections)) {
    const sections = host.orgVisibleSections(payload.sections.filter((name): name is string => typeof name === "string"), client.viewerId);
    return memberFrame({ ...client, viewerId: undefined }, seq, { ...payload, sections }, encodeSseDataFrame(host.STREAM_ID, seq, { ...payload, sections, seq }));
  }
  if (client.viewer.kind === "all") return clientFrame;
  const visible = host.visibleTo(client.viewer);
  if (visible.everything) {
    noteSeen(payload, client.seen);
    return clientFrame;
  }
  const narrowed = frameForMember(payload, host.memberFrameContext(visible, host.approvalViewerOf(client)), client.seen);
  if (!narrowed) return null;
  return narrowed === payload ? clientFrame : encodeSseDataFrame(host.STREAM_ID, seq, { ...narrowed, seq });

}
  return memberFrame;
}
