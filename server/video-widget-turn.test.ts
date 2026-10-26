import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { initMediaProxy } from "./media-proxy.ts";
import { videoMessagesFromTool } from "./video-widget-turn.ts";

describe("videoMessagesFromTool", () => {
  it("maps Glitcho list_followed output to video messages", () => {
    initMediaProxy(mkdtempSync(join(tmpdir(), "sagax-vid-")));
    const output = JSON.stringify({
      items: [{ title: "Ranked", hls_url: "https://cdn.example/live.m3u8", login: "ninja" }],
    });
    const msgs = videoMessagesFromTool("mcp__glitcho__list_followed", output, "thread-1", "play my followed streams", 1_700_000_000_000);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.requested).toBe(true);
    expect(msgs[0]?.kind).toBe("video");
    expect(msgs[0]?.video?.kind).toBe("live");
    expect(msgs[0]?.video?.playbackUrl).toMatch(/^\/api\/media\/proxy\//);
    expect(msgs[0]?.video?.streamer).toBe("ninja");
  });

  it("ignores unrelated tools", () => {
    expect(videoMessagesFromTool("bash", "ok", "t", "play it")).toEqual([]);
  });

  it("adds no player the person did not ask for (views on request, 2026-10-20)", () => {
    initMediaProxy(mkdtempSync(join(tmpdir(), "sagax-vid-")));
    const output = JSON.stringify({ items: [{ title: "Ranked", hls_url: "https://cdn.example/live.m3u8", login: "ninja" }] });
    expect(videoMessagesFromTool("mcp__glitcho__list_followed", output, "t", "who do I follow that is online?")).toEqual([]);
    expect(videoMessagesFromTool("mcp__glitcho__list_followed", output, "t", undefined)).toEqual([]);
  });
});
