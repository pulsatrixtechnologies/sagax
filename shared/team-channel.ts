// Team chat channels (#3411): one bot linked to places in a team chat
// workspace (Slack, Teams, Discord and the others). Shared contract for the
// normalized inbound message, status on the Channels card, and the pure
// gating rules (mention, place switch, people list, bot-loop cap). Adapters
// live in server/channels/. Surfaces stay hidden while
// TEAM_CHAT_CHANNELS_OFFERED is false (shared/team-chat-channels.ts).

/** Platforms a team channel may use. A server that cannot offer one never
 * draws its row. */
export type TeamChannelPlatform =
  | "slack"
  | "teams"
  | "discord"
  | "telegram"
  | "google-chat"
  | "mattermost"
  | "matrix";

export const TEAM_CHANNEL_PLATFORMS: readonly TeamChannelPlatform[] = [
  "slack",
  "teams",
  "discord",
  "telegram",
  "google-chat",
  "mattermost",
  "matrix",
];

/** A chain between bots stops after three hops (#3411). */
export const TEAM_CHANNEL_BOT_HOP_LIMIT = 3;

/** Cheap status for the Channels card row: no network. */
export type TeamChannelStatus =
  | { state: "disconnected" }
  | { state: "connecting" }
  | { state: "connected"; workspace?: string; placesOn: number }
  | { state: "managed"; workspace?: string }
  | { state: "error"; code: "bad_token" | "missing_intent" | "no_public_origin" | "unknown"; detail?: string };

/** A place the bot was added to on the platform (a channel or a direct chat). */
export interface TeamChannelPlace {
  id: string;
  name: string;
  kind: "channel" | "direct";
  /** Off: the bot stays silent there. Default on when first seen. */
  on: boolean;
  /** Answer without a mention. Default false in a channel, true in direct. */
  answerWithoutMention: boolean;
}

/** Who may talk in the places that are on. */
export type TeamChannelAudience =
  | { kind: "everyone" }
  | { kind: "list"; people: string[] };

/** A file attached to an inbound message. */
export interface TeamChannelFile {
  name: string;
  mime?: string;
  bytes?: number;
  /** Platform-specific handle; the adapter fetches bytes when the turn needs them. */
  ref: string;
}

/** Normalized inbound message every adapter yields. */
export interface TeamChannelInbound {
  platform: TeamChannelPlatform;
  workspace: string;
  /** Channel or direct chat id. */
  placeId: string;
  placeName?: string;
  placeKind: "channel" | "direct";
  /** Thread id when the platform has threads; absent: the place itself. */
  threadId?: string;
  author: { id: string; name: string; isBot: boolean };
  /** True when the bot is mentioned, the message is in its own thread, or it is a direct message. */
  addressed: boolean;
  text: string;
  files: TeamChannelFile[];
  /** How many bot-to-bot hops precede this message (0: a person wrote it). */
  botHops: number;
  /** Platform message id, for edits and dedupe. */
  messageId: string;
  at: number;
}

/** Whether this inbound message should start a turn. Pure. */
export function teamChannelShouldAnswer(
  inbound: Pick<TeamChannelInbound, "addressed" | "author" | "botHops" | "placeKind">,
  place: Pick<TeamChannelPlace, "on" | "answerWithoutMention"> | undefined,
  audience: TeamChannelAudience,
): { ok: true } | { ok: false; reason: "place_off" | "not_addressed" | "not_on_list" | "bot_loop" | "from_bot_unaddressed" } {
  if (inbound.botHops >= TEAM_CHANNEL_BOT_HOP_LIMIT) return { ok: false, reason: "bot_loop" };
  if (!place || !place.on) return { ok: false, reason: "place_off" };
  if (inbound.author.isBot && !inbound.addressed) return { ok: false, reason: "from_bot_unaddressed" };
  const addressed = inbound.addressed || place.answerWithoutMention || inbound.placeKind === "direct";
  if (!addressed) return { ok: false, reason: "not_addressed" };
  if (audience.kind === "list" && !audience.people.includes(inbound.author.id)) {
    return { ok: false, reason: "not_on_list" };
  }
  return { ok: true };
}

/** Session key for one place and thread: one conversation context, never reset by itself. */
export function teamChannelSessionKey(input: {
  botId: string;
  platform: TeamChannelPlatform;
  workspace: string;
  placeId: string;
  threadId?: string;
}): string {
  const thread = input.threadId?.trim() || input.placeId;
  return [input.botId, input.platform, input.workspace, input.placeId, thread].join("\0");
}
