import { afterEach, describe, expect, it, vi } from "vitest";

import { createYoutubePlayer, youtubePlayerOptions, youtubeWatchUrl } from "./youtube-embed";

describe("createYoutubePlayer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fills its mount and keeps YouTube's own controls (play, scrub bar, fullscreen)", async () => {
    let options: Record<string, unknown> | undefined;
    class Player {
      constructor(_el: unknown, opts: Record<string, unknown> & { events: { onReady: (e: unknown) => void } }) {
        options = opts;
        opts.events.onReady({ target: { seekTo() {}, getCurrentTime: () => 0, playVideo() {}, pauseVideo() {}, destroy() {} } });
      }
    }
    vi.stubGlobal("window", { YT: { Player }, location: { origin: "http://127.0.0.1:5173" } });
    expect(await createYoutubePlayer({} as HTMLElement, "jNQXAC9IVRw")).not.toBeNull();
    // Without 100%, the IFrame API writes a fixed 640x390 iframe.
    expect(options).toMatchObject({
      width: "100%",
      height: "100%",
      videoId: "jNQXAC9IVRw",
      host: "https://www.youtube-nocookie.com",
      playerVars: { controls: 1, fs: 1, playsinline: 1, rel: 0, origin: "http://127.0.0.1:5173" },
    });
  });

  it("hands YouTube's error code to the card (101/150 refused here, 153 no Referer)", async () => {
    const codes: number[] = [];
    class Player {
      constructor(_el: unknown, opts: { events: { onError: (e: { data: number }) => void } }) {
        opts.events.onError({ data: 150 });
        opts.events.onError({ data: 153 });
      }
    }
    vi.stubGlobal("window", { YT: { Player }, location: { origin: "https://sagax.example.com" } });
    // An error before ready settles with no handle instead of hanging.
    expect(await createYoutubePlayer({} as HTMLElement, "dQw4w9WgXcQ", { onError: (code) => codes.push(code) })).toBeNull();
    expect(codes).toEqual([150, 153]);
  });
});

describe("youtubePlayerOptions", () => {
  it("embeds from youtube-nocookie with the page's own origin for the API messages", () => {
    expect(youtubePlayerOptions("dQw4w9WgXcQ", "https://sagax.example.com")).toEqual({
      width: "100%",
      height: "100%",
      videoId: "dQw4w9WgXcQ",
      host: "https://www.youtube-nocookie.com",
      playerVars: { controls: 1, fs: 1, rel: 0, playsinline: 1, origin: "https://sagax.example.com" },
    });
  });

  it("links a video it cannot play to its YouTube page", () => {
    expect(youtubeWatchUrl("dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(youtubeWatchUrl("a&b=c")).toBe("https://www.youtube.com/watch?v=a%26b%3Dc");
  });
});
