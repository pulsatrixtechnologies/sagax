import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChatMarkdown } from "./ChatMarkdown";
import { StoreProvider } from "@/state/store";
import { ThreadRefsContext } from "./ThreadRefs";
import { mediaLinkTitle } from "./video/ChatMediaLink";

vi.mock("@/state/store", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/state/store")>();
  return { ...mod, api: vi.fn() };
});

vi.mock("hls.js", () => ({
  default: class {
    static isSupported() { return false; }
    loadSource() {}
    attachMedia() {}
    destroy() {}
  },
}));

const MESSAGE = { threadId: "t-1", messageId: "m-1" };
const render = (text: string, inert = false, scope: typeof MESSAGE | null = MESSAGE) =>
  renderToStaticMarkup(
    createElement(
      StoreProvider,
      null,
      createElement(ThreadRefsContext.Provider, { value: { threads: [], currentBotId: undefined } }, createElement(ChatMarkdown, { text, inert, message: scope ?? undefined })),
    ),
  );

// exp in the past (2001) and far in the future (2286), epoch seconds
const EXPIRED_HLS = "https://media.example.test/v1/share/recordings/r1/index.m3u8?u=1&exp=1000000000&t=sig";
const LIVE_HLS = "https://media.example.test/v1/share/recordings/r1/index.m3u8?u=1&exp=9999999999&t=sig";

describe("ChatMarkdown media links", () => {
  it("plays a signed HLS link on its own line and keeps the address under the player", () => {
    const html = render(`Voici l'enregistrement :\n\n${LIVE_HLS}`);
    expect(html).toContain('data-chat-media="hls"');
    expect(html).toContain("<video");
    expect(html).toContain("data-media-caption");
    // the address once, under the player, as a link
    expect(html.split(`href="${LIVE_HLS.replaceAll("&", "&amp;")}"`).length - 1).toBe(1);
  });

  it("says an expired link in words instead of a broken player", () => {
    const html = render(`The player link is good for about 10 minutes: ${EXPIRED_HLS}`);
    expect(html).toContain('data-chat-media="hls"');
    expect(html).toContain('data-expired="true"');
    expect(html).not.toContain("data-media-caption");
  });

  it("draws an audio link as a clip card that loads nothing before Play, and says when it expired", () => {
    const html = render("[Écouter](https://cdn.example.test/clips/song.mp3)");
    expect(html).toContain('data-chat-media="audio"');
    expect(html).toContain('data-media-audio="idle"');
    expect(html).not.toContain("<audio");
    const expired = render("https://cdn.example.test/clips/song.m4a?exp=1000000000");
    expect(expired).toContain('data-media-audio="expired"');
    expect(expired).toContain("This playback link has expired.");
  });

  it("never repeats a labeled link's words in the card under it", () => {
    const html = render("[Écouter l'appel](https://cdn.example.test/clips/call.mp3)");
    expect(html).toMatch(/data-media-caption[\s\S]*>https:\/\/cdn.example.test\/clips\/call.mp3</);
    expect(html.split(">Écouter l&#x27;appel<").length - 1).toBe(1);
    expect(html).toContain(">call.mp3<");
  });

  it("loads no video source before Play", () => {
    const html = render(`${LIVE_HLS}\n\nhttps://cdn.example.test/clip.mp4`);
    expect(html).not.toContain("0:00 / 0:00");
    expect(html.match(/<video[^>]*>/g)?.every((tag) => !/\ssrc=/.test(tag))).toBe(true);
  });

  it("keeps the address a link while the reply has no stored message yet", () => {
    const html = render(LIVE_HLS, false, null);
    expect(html).not.toContain("data-chat-media");
    expect(html).toContain("data-media-pending");
  });

  it("plays a video file and leaves plain http and inert surfaces as links", () => {
    expect(render("https://cdn.example.test/clip.mp4")).toContain('data-chat-media="video"');
    expect(render("http://cdn.example.test/clip.mp4")).not.toContain("data-chat-media");
    const inert = render("https://cdn.example.test/clip.mp4", true);
    expect(inert).not.toContain("data-chat-media");
    expect(inert).toContain('href="https://cdn.example.test/clip.mp4"');
  });
});

describe("mediaLinkTitle", () => {
  it("is a telling file name, never a manifest's", () => {
    expect(mediaLinkTitle("https://x.test/a/index.m3u8")).toBeUndefined();
    expect(mediaLinkTitle("https://x.test/a/Demo%20finale.mp4?sig=1")).toBe("Demo finale.mp4");
  });
});
