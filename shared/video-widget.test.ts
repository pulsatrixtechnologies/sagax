import { describe, expect, it } from "vitest";
import {
  extractSagaxVideoBlocks,
  fenceBareSagaxVideos,
  glitchoVideosFromTool,
  parseSagaxVideoFence,
  isHlsVideo,
  normalizeVideoFormat,
  sagaxVideosFromJson,
  videoFormatFromUrl,
  videosFromToolOutput,
  youtubeIdsInText,
  youtubeVideoId,
} from "./video-widget.ts";

describe("youtubeVideoId", () => {
  it("reads watch, youtu.be, embed and shorts URLs", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBe(null);
    expect(youtubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
});

describe("youtubeIdsInText", () => {
  it("dedupes ids from links and bare URLs", () => {
    const text = "Voir https://youtu.be/abc12345678 et [clip](https://www.youtube.com/watch?v=abc12345678)";
    expect(youtubeIdsInText(text)).toEqual(["abc12345678"]);
  });
});

describe("sagaxVideosFromJson", () => {
  it("reads sagaxVideos and sagaxVideo", () => {
    expect(sagaxVideosFromJson({ sagaxVideo: { url: "https://x.test/a.m3u8", kind: "live", title: "Live" } })).toEqual([
      { kind: "live", url: "https://x.test/a.m3u8", format: "hls", title: "Live", streamer: undefined, source: undefined, posterUrl: undefined, durationMs: undefined },
    ]);
    expect(sagaxVideosFromJson({ sagaxVideos: [{ playback_url: "https://x.test/v.mp4", duration: 120 }] })[0]).toMatchObject({
      kind: "vod",
      url: "https://x.test/v.mp4",
      durationMs: 120_000,
    });
  });
});

describe("glitchoVideosFromTool", () => {
  it("maps list_followed live rows", () => {
    const output = JSON.stringify({
      items: [{ login: "ninja", title: "Ranked", hls_url: "https://cdn.example/live.m3u8", isLive: true }],
    });
    const rows = glitchoVideosFromTool("mcp__glitcho__list_followed", output);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "live", url: "https://cdn.example/live.m3u8", streamer: "ninja", source: "Glitcho" });
  });

  it("maps list_recordings as vod", () => {
    const output = JSON.stringify({
      recordings: [{ id: 3, title: "Hier", url: "https://glitcho.local/rec/3.mp4", durationMs: 90_000 }],
    });
    const rows = glitchoVideosFromTool("mcp__glitcho__list_recordings", output);
    expect(rows[0]).toMatchObject({ kind: "vod", durationMs: 90_000, source: "Glitcho" });
  });
});

describe("videosFromToolOutput", () => {
  it("prefers sagax envelope over glitcho heuristics", () => {
    const output = JSON.stringify({ sagaxVideos: [{ url: "https://a.test/x.m3u8" }] });
    expect(videosFromToolOutput("mcp__glitcho__list_followed", output)).toHaveLength(1);
  });
});

describe("video format", () => {
  it("reads the extension of the source URL, not its query", () => {
    expect(videoFormatFromUrl("https://g.test/v1/share/live/ninja/index.m3u8?u=1&exp=2&t=abc")).toBe("hls");
    expect(videoFormatFromUrl("https://g.test/clip.mp4?x=.m3u8")).toBe("mp4");
    expect(videoFormatFromUrl("/api/media/proxy/eyJ1IjoiaHR0cHM6Ly9nLnRlc3QvYS5tM3U4In0.mac")).toBeUndefined();
  });

  it("normalizes declared formats and MIME types", () => {
    expect(normalizeVideoFormat("HLS")).toBe("hls");
    expect(normalizeVideoFormat("application/x-mpegURL")).toBe("hls");
    expect(normalizeVideoFormat("application/vnd.apple.mpegurl; charset=utf-8")).toBe("hls");
    expect(normalizeVideoFormat("video/mp4")).toBe("mp4");
    expect(normalizeVideoFormat("dash")).toBeUndefined();
  });

  it("takes a declared format over the URL, and keys like hls_url", () => {
    expect(sagaxVideosFromJson({ sagaxVideo: { url: "https://x.test/play?id=4", format: "hls" } })[0]?.format).toBe("hls");
    expect(sagaxVideosFromJson({ sagaxVideo: { url: "https://x.test/play?id=4", mimeType: "video/mp4" } })[0]?.format).toBe("mp4");
    expect(sagaxVideosFromJson({ sagaxVideo: { hls_url: "https://x.test/play?id=4" } })[0]?.format).toBe("hls");
    expect(sagaxVideosFromJson({ sagaxVideo: { url: "https://x.test/play?id=4" } })[0]?.format).toBeUndefined();
  });

  it("decides HLS from format, and only sniffs the URL for older messages", () => {
    expect(isHlsVideo({ format: "hls", playbackUrl: "/api/media/proxy/tok.mac" })).toBe(true);
    expect(isHlsVideo({ format: "mp4", playbackUrl: "/api/media/proxy/tok.mac" })).toBe(false);
    expect(isHlsVideo({ playbackUrl: "https://cdn.test/a.m3u8" })).toBe(true);
    expect(isHlsVideo({ playbackUrl: "/api/media/proxy/tok.mac" })).toBe(false);
  });

  it("maps the Glitcho sagaxVideos envelope (live and recordings) to HLS", () => {
    const live = JSON.stringify({
      items: [{ login: "ninja" }],
      sagaxVideos: [{
        kind: "live",
        url: "https://glitcho.test/v1/share/live/ninja/index.m3u8?u=7&exp=1760000000&t=sig",
        title: "Ranked", streamer: "Ninja", source: "Glitcho", viewerCount: 1234,
      }],
    });
    expect(videosFromToolOutput("mcp__glitcho__list_followed", live)).toEqual([
      expect.objectContaining({ kind: "live", format: "hls", source: "Glitcho", viewerCount: 1234 }),
    ]);
    const vod = JSON.stringify({
      items: [{ id: 42 }],
      sagaxVideos: [{
        kind: "vod",
        url: "https://glitcho.test/v1/share/recordings/42/index.m3u8?u=7&exp=1760000000&t=sig",
        title: "Hier", streamer: "Ninja", source: "Glitcho",
        posterUrl: "https://glitcho.test/v1/share/recordings/42/thumbnail?u=7&exp=1760000000&t=sig",
        durationMs: 5_400_000,
      }],
    });
    expect(videosFromToolOutput("mcp__glitcho__list_recordings", vod)).toEqual([
      expect.objectContaining({ kind: "vod", format: "hls", durationMs: 5_400_000, source: "Glitcho" }),
    ]);
  });
});

describe("bot-written sagaxVideos cards", () => {
  const url = "https://glitcho.test/v1/share/live/ninja/index.m3u8?u=7&exp=1&t=sig";
  const envelope = `{"sagaxVideos":[{"kind":"live","url":"${url}","title":"T"}]}`;

  it("reads ```json, unlabeled and ```video fences; ignores other JSON", () => {
    for (const lang of ["json", "", "video"]) {
      const card = parseSagaxVideoFence(envelope, lang);
      expect(card).toEqual({ status: "videos", videos: [expect.objectContaining({ kind: "live", url, format: "hls", title: "T" })] });
    }
    expect(parseSagaxVideoFence('{"a":1}', "json")).toBeNull();
    expect(parseSagaxVideoFence(envelope, "ts")).toBeNull();
  });

  it("marks broken JSON or a card without a URL invalid, with the first link", () => {
    expect(parseSagaxVideoFence(`{"sagaxVideos":[{"url":"${url}"`, "json")).toEqual({ status: "invalid", url });
    expect(parseSagaxVideoFence('{"sagaxVideos":[{"title":"x"}]}', "video")).toEqual({ status: "invalid", url: undefined });
  });

  it("fences bare JSON outside code and leaves fenced text alone", () => {
    expect(fenceBareSagaxVideos(`hi\n${envelope}\nbye`)).toBe(`hi\n\`\`\`video\n${envelope}\n\`\`\`\nbye`);
    const inside = `\`\`\`\n${envelope}\n\`\`\``;
    expect(fenceBareSagaxVideos(inside)).toBe(inside);
  });

  it("takes cards out of a reply and keeps the words (the 2026-11-06 reply)", () => {
    const reply = `Player's on the card.\n\n\`\`\`json\n${envelope}\n\`\`\`\n\n| Field | Value |\n|---|---|\n| State | live |\n\nHit play on that card.`;
    const out = extractSagaxVideoBlocks(reply);
    expect(out.videos).toHaveLength(1);
    expect(out.text).not.toContain("sagaxVideos");
    expect(out.text).toContain("Hit play on that card.");
    expect(out.text).toContain("| State | live |");
    expect(extractSagaxVideoBlocks("no video here")).toEqual({ text: "no video here", videos: [] });
    const broken = "```json\n{\"sagaxVideos\":[\n```";
    expect(extractSagaxVideoBlocks(broken)).toEqual({ text: broken, videos: [] });
  });
});
