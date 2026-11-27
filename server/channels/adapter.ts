// Team channel adapter contract (#3411, lot 1). Each platform implements
// this; the gateway holds one adapter per offered platform. Building of
// Slack starts after this contract; surfaces stay hidden while
// TEAM_CHAT_CHANNELS_OFFERED is false.
import type {
  TeamChannelInbound,
  TeamChannelPlatform,
  TeamChannelStatus,
} from "../../shared/team-channel.ts";

export type { TeamChannelInbound, TeamChannelPlatform, TeamChannelStatus };

/** What connect returns after the person pastes credentials (or installs the app). */
export type TeamChannelConnectResult =
  | { ok: true; workspace?: string }
  | { ok: false; code: "bad_token" | "missing_intent" | "no_public_origin" | "unknown"; detail?: string };

/** A place to post a reply or an approval card. */
export interface TeamChannelSendPlace {
  workspace: string;
  placeId: string;
  threadId?: string;
}

/** A reply body the adapter shapes for its platform (Markdown converted there). */
export interface TeamChannelReply {
  text: string;
  files?: Array<{ name: string; bytes: Uint8Array; mime?: string }>;
}

/** Reference to a message already posted, for streaming edits. */
export interface TeamChannelSentRef {
  platform: TeamChannelPlatform;
  workspace: string;
  placeId: string;
  messageId: string;
  threadId?: string;
}

/** An approval card waiting on the bot's owner only (never on other people
 * in the channel). The adapter draws the platform's own controls. */
export interface TeamChannelApprovalCard {
  title: string;
  body: string;
  /** Opaque id the owner's answer carries back. */
  requestId: string;
}

export type TeamChannelStop = () => void;

/** Inbound sink the gateway registers when start() runs. */
export type TeamChannelSink = (message: TeamChannelInbound) => void;

/** Environment the adapter reads to decide whether its row is drawn. */
export interface TeamChannelOfferEnv {
  /** Public HTTPS origin of this server (Teams needs it). Absent: no public origin. */
  publicOrigin?: string;
  /** Hosted Admin already manages Slack for the workspace. */
  hostedSlack?: boolean;
}

/**
 * One platform. `offered` is cheap and synchronous: false hides the row.
 * `status` is cheap and does no network. `start` opens the socket, gateway
 * or webhook route and returns a stop function.
 */
export interface TeamChannelAdapter {
  platform: TeamChannelPlatform;
  offered(env: TeamChannelOfferEnv): boolean;
  connect(botId: string, credentials: Record<string, string>): Promise<TeamChannelConnectResult>;
  status(botId: string): TeamChannelStatus;
  start(botId: string, sink: TeamChannelSink): TeamChannelStop;
  send(place: TeamChannelSendPlace, reply: TeamChannelReply): Promise<TeamChannelSentRef>;
  update(ref: TeamChannelSentRef, reply: TeamChannelReply): Promise<void>;
  askApproval(place: TeamChannelSendPlace, card: TeamChannelApprovalCard, owner: { platformUserId: string }): Promise<void>;
}

/** Adapters the server may start: only those whose `offered` is true. */
export function offeredTeamChannelAdapters(
  adapters: readonly TeamChannelAdapter[],
  env: TeamChannelOfferEnv,
): TeamChannelAdapter[] {
  return adapters.filter((adapter) => adapter.offered(env));
}
