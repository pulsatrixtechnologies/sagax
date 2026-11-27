// Team channel contract (#3411): mention gating, place switch, people list,
// bot-loop cap, and the session key. Pure; no network.
import { describe, expect, it } from "vitest";

import {
  TEAM_CHANNEL_BOT_HOP_LIMIT,
  TEAM_CHANNEL_PLATFORMS,
  teamChannelSessionKey,
  teamChannelShouldAnswer,
  type TeamChannelAudience,
  type TeamChannelInbound,
  type TeamChannelPlace,
} from "./team-channel.ts";

const place = (over: Partial<TeamChannelPlace> = {}): TeamChannelPlace => ({
  id: "C1",
  name: "general",
  kind: "channel",
  on: true,
  answerWithoutMention: false,
  ...over,
});

const inbound = (over: Partial<TeamChannelInbound> = {}): TeamChannelInbound => ({
  platform: "slack",
  workspace: "T1",
  placeId: "C1",
  placeKind: "channel",
  author: { id: "U1", name: "Ada", isBot: false },
  addressed: true,
  text: "hello",
  files: [],
  botHops: 0,
  messageId: "m1",
  at: 1_800_000_000_000,
  ...over,
});

const everyone: TeamChannelAudience = { kind: "everyone" };

describe("teamChannelShouldAnswer", () => {
  it("answers when the bot is addressed in a place that is on", () => {
    expect(teamChannelShouldAnswer(inbound(), place(), everyone)).toEqual({ ok: true });
  });

  it("stays silent when the place is off", () => {
    expect(teamChannelShouldAnswer(inbound(), place({ on: false }), everyone)).toEqual({ ok: false, reason: "place_off" });
    expect(teamChannelShouldAnswer(inbound(), undefined, everyone)).toEqual({ ok: false, reason: "place_off" });
  });

  it("stays silent for an unaddressed channel message unless the place allows it", () => {
    expect(teamChannelShouldAnswer(inbound({ addressed: false }), place(), everyone)).toEqual({ ok: false, reason: "not_addressed" });
    expect(teamChannelShouldAnswer(inbound({ addressed: false }), place({ answerWithoutMention: true }), everyone)).toEqual({ ok: true });
  });

  it("answers a direct message without a mention", () => {
    expect(teamChannelShouldAnswer(
      inbound({ addressed: false, placeKind: "direct" }),
      place({ kind: "direct", answerWithoutMention: false }),
      everyone,
    )).toEqual({ ok: true });
  });

  it("honours the people list", () => {
    const list: TeamChannelAudience = { kind: "list", people: ["U1"] };
    expect(teamChannelShouldAnswer(inbound(), place(), list)).toEqual({ ok: true });
    expect(teamChannelShouldAnswer(inbound({ author: { id: "U9", name: "Other", isBot: false } }), place(), list))
      .toEqual({ ok: false, reason: "not_on_list" });
  });

  it("caps a bot-to-bot chain at three hops", () => {
    expect(teamChannelShouldAnswer(inbound({ botHops: TEAM_CHANNEL_BOT_HOP_LIMIT - 1, author: { id: "B2", name: "Peer", isBot: true } }), place(), everyone))
      .toEqual({ ok: true });
    expect(teamChannelShouldAnswer(inbound({ botHops: TEAM_CHANNEL_BOT_HOP_LIMIT, author: { id: "B2", name: "Peer", isBot: true } }), place(), everyone))
      .toEqual({ ok: false, reason: "bot_loop" });
  });

  it("ignores another bot that did not mention this one", () => {
    expect(teamChannelShouldAnswer(
      inbound({ addressed: false, author: { id: "B2", name: "Peer", isBot: true } }),
      place({ answerWithoutMention: true }),
      everyone,
    )).toEqual({ ok: false, reason: "from_bot_unaddressed" });
  });
});

describe("teamChannelSessionKey", () => {
  it("is one key per bot, platform, workspace, place and thread", () => {
    const base = { botId: "bot-1", platform: "slack" as const, workspace: "T1", placeId: "C1" };
    expect(teamChannelSessionKey(base)).toBe(teamChannelSessionKey({ ...base, threadId: "C1" }));
    expect(teamChannelSessionKey({ ...base, threadId: " thr " })).not.toBe(teamChannelSessionKey(base));
    expect(teamChannelSessionKey({ ...base, botId: "bot-2" })).not.toBe(teamChannelSessionKey(base));
  });
});

describe("TEAM_CHANNEL_PLATFORMS", () => {
  it("lists every platform the contract names", () => {
    expect(TEAM_CHANNEL_PLATFORMS).toEqual([
      "slack", "teams", "discord", "telegram", "google-chat", "mattermost", "matrix",
    ]);
  });
});
