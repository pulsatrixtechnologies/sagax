// @vitest-environment happy-dom
import { createElement, StrictMode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WireVideoWidget } from "../../../shared/video-widget.ts";

type ErrorListener = (event: string, data: { fatal: boolean; type: string; details?: string }) => void;
const hlsCalls = vi.hoisted(() => ({
  loadSource: [] as string[],
  attached: 0,
  destroyed: 0,
  recovered: 0,
  listeners: [] as Array<(event: string, data: { fatal: boolean; type: string; details?: string }) => void>,
}));

vi.mock("hls.js", () => ({
  default: class {
    static Events = { ERROR: "hlsError", MANIFEST_PARSED: "hlsManifestParsed", FRAG_LOADED: "hlsFragLoaded" };
    static ErrorTypes = { NETWORK_ERROR: "networkError", MEDIA_ERROR: "mediaError", OTHER_ERROR: "otherError" };
    static isSupported() { return true; }
    alive = true;
    loadSource(src: string) { hlsCalls.loadSource.push(src); }
    attachMedia() { hlsCalls.attached += 1; }
    on(name: string, listener: ErrorListener) {
      hlsCalls.listeners.push((event, data) => { if (this.alive && event === name) listener(event, data); });
    }
    recoverMediaError() { hlsCalls.recovered += 1; }
    destroy() { this.alive = false; hlsCalls.destroyed += 1; }
  },
}));

async function hlsError(data: { fatal: boolean; type: string; details?: string; response?: { code: number } }): Promise<void> {
  await act(async () => {
    for (const listener of hlsCalls.listeners.slice()) listener("hlsError", data);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const { VideoPlayerWidget } = await import("./VideoPlayerWidget");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

async function mount(video: WireVideoWidget, nativeHls: boolean): Promise<HTMLVideoElement> {
  vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockImplementation((type: string) =>
    nativeHls && type === "application/vnd.apple.mpegurl" ? "maybe" : "",
  );
  await act(async () => {
    root.render(createElement(VideoPlayerWidget, { video }));
  });
  // Let the dynamic import of hls.js settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return host.querySelector("video")!;
}

describe("VideoPlayerWidget playback path", () => {
  beforeEach(() => {
    hlsCalls.loadSource.length = 0;
    hlsCalls.attached = 0;
    hlsCalls.destroyed = 0;
    hlsCalls.recovered = 0;
    hlsCalls.listeners.length = 0;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("loads a proxied HLS source (Glitcho live) with hls.js on Chrome/Firefox", async () => {
    const video = await mount(
      { kind: "live", format: "hls", playbackUrl: "/api/media/proxy/eyJ1IjoiaHR0cHM6Ly9nIn0.mac", source: "Glitcho" },
      false,
    );
    expect(hlsCalls.loadSource).toEqual(["/api/media/proxy/eyJ1IjoiaHR0cHM6Ly9nIn0.mac"]);
    expect(hlsCalls.attached).toBe(1);
    expect(video.getAttribute("src")).toBeNull();
  });

  it("loads a proxied HLS recording (Glitcho vod) with hls.js", async () => {
    await mount({ kind: "vod", format: "hls", playbackUrl: "/api/media/proxy/rec.mac", durationMs: 5_400_000 }, false);
    expect(hlsCalls.loadSource).toEqual(["/api/media/proxy/rec.mac"]);
  });

  it("lets Safari play HLS natively", async () => {
    const video = await mount({ kind: "live", format: "hls", playbackUrl: "/api/media/proxy/live.mac" }, true);
    expect(hlsCalls.loadSource).toEqual([]);
    expect(video.src).toContain("/api/media/proxy/live.mac");
  });

  it("plays a proxied MP4 directly", async () => {
    const video = await mount({ kind: "vod", format: "mp4", playbackUrl: "/api/media/proxy/clip.mac" }, false);
    expect(hlsCalls.loadSource).toEqual([]);
    expect(video.src).toContain("/api/media/proxy/clip.mac");
  });

  it("still sniffs .m3u8 on older messages without format", async () => {
    await mount({ kind: "live", playbackUrl: "https://cdn.example/live.m3u8" }, false);
    expect(hlsCalls.loadSource).toEqual(["https://cdn.example/live.m3u8"]);
  });

  it("keeps playing through hls.js hiccups that are not fatal", async () => {
    await mount({ kind: "live", format: "hls", playbackUrl: "/api/media/proxy/live.mac" }, false);
    await hlsError({ fatal: false, type: "mediaError", details: "bufferStalledError" });
    await hlsError({ fatal: false, type: "networkError", details: "fragLoadError" });
    expect(host.querySelector(".vpc-error")).toBeNull();
    expect(hlsCalls.destroyed).toBe(0);
  });

  it("recovers a fatal media error before giving up", async () => {
    await mount({ kind: "vod", format: "hls", playbackUrl: "/api/media/proxy/rec.mac" }, false);
    await hlsError({ fatal: true, type: "mediaError" });
    expect(hlsCalls.recovered).toBe(1);
    expect(host.querySelector(".vpc-error")).toBeNull();
  });

  it("tries the original URL once when the proxy refuses the stream (403), then counts the link as expired", async () => {
    await mount(
      { kind: "live", format: "hls", playbackUrl: "/api/media/proxy/live.mac", directUrl: "https://media.example.test/live/index.m3u8" },
      false,
    );
    await hlsError({ fatal: true, type: "networkError", details: "manifestLoadError", response: { code: 403 } });
    expect(hlsCalls.loadSource).toEqual(["/api/media/proxy/live.mac", "https://media.example.test/live/index.m3u8"]);
    expect(host.querySelector(".vpc-error")).toBeNull();
    await hlsError({ fatal: true, type: "networkError", details: "manifestLoadError", response: { code: 403 } });
    expect(host.querySelector('.vpc-error[data-expired="true"]')).not.toBeNull();
  });

  it("falls back to the original URL when the proxied stream fails for good, then shows the error", async () => {
    await mount(
      { kind: "vod", format: "hls", playbackUrl: "/api/media/proxy/vod.mac", directUrl: "https://media.example.test/vod/index.m3u8" },
      false,
    );
    // two media recoveries, then the third fatal media error fails the source
    for (let i = 0; i < 3; i++) await hlsError({ fatal: true, type: "mediaError", details: "bufferAppendError" });
    expect(hlsCalls.loadSource).toEqual(["/api/media/proxy/vod.mac", "https://media.example.test/vod/index.m3u8"]);
    expect(host.querySelector(".vpc-error")).toBeNull();
    for (let i = 0; i < 3; i++) await hlsError({ fatal: true, type: "mediaError", details: "bufferAppendError" });
    expect(host.querySelector(".vpc-error")?.textContent).toBeTruthy();
    // The error offers the original link, never the proxy path.
    expect(host.querySelector(".vpc-error a")?.getAttribute("href")).toBe("https://media.example.test/vod/index.m3u8");
  });

  it("never attaches a second hls.js instance when the effect re-runs before hls.js loads", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockImplementation(() => "");
    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(VideoPlayerWidget, {
        video: { kind: "live", format: "hls", playbackUrl: "/api/media/proxy/live.mac" },
      })));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(hlsCalls.attached - hlsCalls.destroyed).toBeLessThanOrEqual(1);
  });

  it("falls back to the original URL when the native element cannot play the proxied MP4", async () => {
    const video = await mount(
      { kind: "vod", format: "mp4", playbackUrl: "/api/media/proxy/clip.mac", directUrl: "https://media.example.test/clip.mp4" },
      false,
    );
    expect(video.src).toContain("/api/media/proxy/clip.mac");
    // the proxy refuses the destination: the expiry probe sees its 403
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 403 }));
    await act(async () => {
      video.dispatchEvent(new Event("error"));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(video.src).toBe("https://media.example.test/clip.mp4");
    expect(host.querySelector(".vpc-error")).toBeNull();
  });
});
