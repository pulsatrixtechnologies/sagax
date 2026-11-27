// Team channel adapter contract (#3411): the row is not drawn when the
// platform is not offered.
import { describe, expect, it } from "vitest";

import {
  offeredTeamChannelAdapters,
  type TeamChannelAdapter,
  type TeamChannelOfferEnv,
} from "./adapter.ts";

function stub(platform: TeamChannelAdapter["platform"], offered: boolean): TeamChannelAdapter {
  return {
    platform,
    offered: () => offered,
    connect: async () => ({ ok: false, code: "unknown" }),
    status: () => ({ state: "disconnected" }),
    start: () => () => {},
    send: async () => ({ platform, workspace: "", placeId: "", messageId: "" }),
    update: async () => {},
    askApproval: async () => {},
  };
}

describe("offeredTeamChannelAdapters", () => {
  it("keeps only adapters whose offered() is true", () => {
    const env: TeamChannelOfferEnv = {};
    const adapters = [
      stub("slack", true),
      stub("discord", false),
      stub("teams", true),
    ];
    expect(offeredTeamChannelAdapters(adapters, env).map((adapter) => adapter.platform)).toEqual(["slack", "teams"]);
  });

  it("hides Teams when the server has no public HTTPS origin (adapter decides)", () => {
    const teams: TeamChannelAdapter = {
      ...stub("teams", false),
      offered: (env) => Boolean(env.publicOrigin?.startsWith("https://")),
    };
    expect(offeredTeamChannelAdapters([teams], {}).map((adapter) => adapter.platform)).toEqual([]);
    expect(offeredTeamChannelAdapters([teams], { publicOrigin: "https://app.example" }).map((adapter) => adapter.platform)).toEqual(["teams"]);
  });
});
