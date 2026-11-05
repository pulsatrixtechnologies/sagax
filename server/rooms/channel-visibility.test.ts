import { describe, expect, it } from "vitest";
import {
  canSeeChannel,
  canSeeDirectBot,
  channelViewerId,
  liveFramesNeedChannelFilter,
  sseFrameProjection,
  searchHitVisible,
  seesBotForViewer,
  seesChannel,
  seesChannelFrame,
} from "./channel-visibility.ts";

describe("channel visibility", () => {
  it("hides a channel from someone who was not added", () => {
    expect(canSeeChannel({ humanIds: ["owner"], viewerId: "morgan@example.test" })).toBe(false);
    expect(canSeeChannel({ humanIds: ["owner", "morgan@example.test"], viewerId: "morgan@example.test" })).toBe(true);
  });
  it("shows another person's bot in Direct only after a grant", () => {
    expect(canSeeDirectBot({ ownerUserId: "owner", viewerId: "morgan@example.test", directGrants: [] })).toBe(false);
    expect(canSeeDirectBot({ ownerUserId: "owner", viewerId: "morgan@example.test", directGrants: ["morgan@example.test"] })).toBe(true);
    expect(canSeeDirectBot({ ownerUserId: "owner", viewerId: "owner", directGrants: [] })).toBe(true);
  });
  it("hides a channel from an admin who was not added", () => {
    const viewerId = channelViewerId({
      kind: "session",
      session: { email: "ada@example.test", principalId: "pr_ada" },
    });
    expect(seesChannel({ humanIds: ["owner"] }, viewerId)).toBe(false);
    expect(seesChannel({ humanIds: ["owner", "pr_ada"] }, viewerId)).toBe(true);
  });
  it("filters live frames for a signed-in admin and not for loopback", () => {
    expect(liveFramesNeedChannelFilter("ada@example.test")).toBe(true);
    expect(liveFramesNeedChannelFilter(undefined)).toBe(false);
  });
  it("keeps the admin projection after a channel filter allows the frame", () => {
    expect(sseFrameProjection({ admin: true })).toBe("admin");
    expect(sseFrameProjection({ admin: false })).toBe("client");
  });
  it("keeps a channel speaker visible even without a direct grant", () => {
    expect(seesChannelFrame({
      humanIds: ["owner", "morgan@example.test"],
      viewerId: "morgan@example.test",
      speakingOwnerUserId: "owner",
      speakingDirectGrants: [],
    })).toBe(true);
    expect(canSeeDirectBot({ ownerUserId: "owner", viewerId: "morgan@example.test", directGrants: [] })).toBe(false);
    expect(seesBotForViewer({
      viewerId: "morgan@example.test",
      ownerUserId: "owner",
      directGrants: [],
      inChannels: [{ humanIds: ["owner", "morgan@example.test"] }],
    })).toBe(true);
    expect(seesBotForViewer({
      viewerId: "morgan@example.test",
      ownerUserId: "owner",
      directGrants: [],
      inChannels: [{ humanIds: ["owner"] }],
    })).toBe(false);
  });
  it("in an organization a room opens the room, never its bots", () => {
    const viewer = { principalId: "pr_morgan", orgAdmin: false, teams: [], disabled: false };
    const room = { humanIds: ["owner", "pr_morgan"] };
    expect(seesBotForViewer({ viewerId: "pr_morgan", ownerUserId: "owner", directGrants: [], inChannels: [room], viewer, grants: [] })).toBe(true);
    expect(seesBotForViewer({ viewerId: "pr_morgan", ownerUserId: "owner", directGrants: [], inChannels: [room], viewer, grants: [], channelsOpenBot: false })).toBe(false);
    expect(seesBotForViewer({ viewerId: "pr_morgan", ownerUserId: "owner", directGrants: [], inChannels: [room], viewer, grants: [{ target: "user:pr_morgan", level: "use", by: "owner", at: 0 }], channelsOpenBot: false })).toBe(true);
  });
  it("hides a bot with no owner from a signed-in viewer who was not given it", () => {
    expect(seesBotForViewer({
      viewerId: "morgan@example.test",
      directGrants: [],
      inChannels: [],
    })).toBe(false);
    expect(seesBotForViewer({
      viewerId: "morgan@example.test",
      directGrants: ["Morgan@example.test"],
      inChannels: [],
    })).toBe(true);
    expect(seesBotForViewer({
      viewerId: undefined,
      directGrants: [],
      inChannels: [],
    })).toBe(true);
  });
  it("drops search hits from a channel or bot the viewer was not given", () => {
    expect(searchHitVisible({
      viewerId: "morgan@example.test",
      channel: { humanIds: ["owner"] },
      bot: null,
    })).toBe(false);
    expect(searchHitVisible({
      viewerId: "morgan@example.test",
      channel: null,
      bot: { ownerUserId: "owner", directGrants: [], inChannels: [{ humanIds: ["owner"] }] },
    })).toBe(false);
    expect(searchHitVisible({
      viewerId: "morgan@example.test",
      channel: { humanIds: ["owner", "morgan@example.test"] },
      bot: null,
    })).toBe(true);
    expect(searchHitVisible({
      viewerId: "owner",
      channel: null,
      bot: { ownerUserId: "owner", directGrants: [], inChannels: [] },
    })).toBe(true);
  });
});

describe("viewer id by principal", () => {
  it("uses the session principal", () => {
    expect(channelViewerId({ kind: "session", session: { id: "s1", email: "z@example.com", principalId: "pr_11111111-1111-4111-8111-111111111111" } }))
      .toBe("pr_11111111-1111-4111-8111-111111111111");
  });
  it("gives a session without a principal an id that sees no channel", () => {
    const viewer = channelViewerId({ kind: "session", session: { id: "s9" } });
    expect(viewer).toBe("anon:s9");
    expect(seesChannel({ humanIds: ["pr_11111111-1111-4111-8111-111111111111"] }, viewer)).toBe(false);
    expect(seesBotForViewer({ viewerId: viewer, ownerUserId: "pr_11111111-1111-4111-8111-111111111111", directGrants: [], inChannels: [] })).toBe(false);
  });
  it("leaves the local operator unfiltered", () => {
    expect(channelViewerId({ kind: "loopback" })).toBeUndefined();
  });
});


