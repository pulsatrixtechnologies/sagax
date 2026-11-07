// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WireVideoWidget } from "../../../shared/video-widget.ts";

type Handler = (event: string, data: unknown) => void;
const hls = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  liveSyncPosition: null as number | null,
  levels: [] as { height: number }[],
  currentLevel: -1,
}));

vi.mock("hls.js", () => ({
  default: class {
    static Events = { ERROR: "hlsError", MANIFEST_PARSED: "manifestParsed", FRAG_LOADED: "fragLoaded" };
    static isSupported() { return true; }
    get liveSyncPosition() { return hls.liveSyncPosition; }
    get levels() { return hls.levels; }
    set currentLevel(v: number) { hls.currentLevel = v; }
    loadSource() {}
    attachMedia() {}
    startLoad() {}
    recoverMediaError() {}
    on(event: string, fn: Handler) { hls.handlers.set(event, fn); }
    destroy() {}
  },
}));

const { VideoPlayerWidget } = await import("./VideoPlayerWidget");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount(props: Parameters<typeof VideoPlayerWidget>[0]) {
  vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("");
  await act(async () => {
    root.render(createElement(VideoPlayerWidget, props));
  });
  await flush();
}

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T & HTMLElement>(sel);

const live: WireVideoWidget = {
  kind: "live",
  format: "hls",
  playbackUrl: "/api/media/proxy/live.mac",
  title: "Finals",
  streamer: "NorthStar",
  category: "Strategy",
  tags: ["English", "Finals"],
  startedAt: new Date(Date.now() - 3_600_000).toISOString(),
  recording: true,
  viewerCount: 1200,
};

const vod: WireVideoWidget = {
  kind: "vod",
  format: "mp4",
  playbackUrl: "/api/media/proxy/rec.mac",
  title: "Season review",
  durationMs: 5_400_000,
  chapters: [
    { startMs: 0, title: "Intro" },
    { startMs: 900_000, title: "Draft" },
    { startMs: 2_700_000, title: "Map 1" },
  ],
};

beforeEach(() => {
  hls.handlers.clear();
  hls.liveSyncPosition = null;
  hls.levels = [];
  hls.currentLevel = -1;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("live card", () => {
  it("shows the live pill, category, tags, uptime and REC", async () => {
    await mount({ video: live });
    expect(q(".vpc-live")).not.toBeNull();
    expect(q(".vpc-rec")).not.toBeNull();
    expect(q(".vpc-uptime")?.textContent).toMatch(/^1:00:0\d$/);
    expect([...host.querySelectorAll(".vpc-tag")].map((n) => n.textContent)).toEqual(["English", "Finals"]);
    expect(host.textContent).toContain("Strategy");
  });

  it("offers Back to live when behind the edge of a DVR window, and jumps there", async () => {
    await mount({ video: live });
    const el = q<HTMLVideoElement>("video")!;
    Object.defineProperty(el, "seekable", { configurable: true, value: { length: 1, start: () => 0, end: () => 600 } });
    vi.spyOn(el, "paused", "get").mockReturnValue(false);
    hls.liveSyncPosition = 597;
    el.currentTime = 590;
    await act(async () => { el.dispatchEvent(new Event("timeupdate")); });
    expect(q(".vpc-golive")).toBeNull();
    expect(q(".vpc-scrub")?.getAttribute("data-live")).toBe("true");

    el.currentTime = 500;
    await act(async () => { el.dispatchEvent(new Event("timeupdate")); });
    const goLive = q<HTMLButtonElement>(".vpc-golive");
    expect(goLive).not.toBeNull();
    expect(q(".vpc-live")?.getAttribute("data-behind")).toBe("true");
    await act(async () => goLive!.click());
    expect(el.currentTime).toBe(597);
  });

  it("lists the hls.js levels in the quality menu and switches level", async () => {
    hls.levels = [{ height: 720 }, { height: 1080 }];
    await mount({ video: live });
    await act(async () => hls.handlers.get("manifestParsed")?.("manifestParsed", {}));
    await act(async () => q<HTMLButtonElement>('[aria-haspopup="menu"]')!.click());
    const items = [...host.querySelectorAll<HTMLButtonElement>('.vpc-menu [role="menuitemradio"]')];
    expect(items.map((b) => b.textContent?.trim())).toEqual([expect.any(String), "1080p", "720p"]);
    await act(async () => items[1]!.click());
    expect(hls.currentLevel).toBe(1);
  });
});

describe("recording", () => {
  it("draws chapter marks and seek steps on the scrubber", async () => {
    await mount({ video: vod });
    expect(host.querySelectorAll(".vpc-scrub-mark").length).toBeGreaterThanOrEqual(2);
    expect(host.querySelectorAll(".vpc-step").length).toBeGreaterThanOrEqual(1);
    expect(q(".vpc-live")).toBeNull();
  });

  it("expands into the large view and collapses on Escape", async () => {
    await mount({ video: vod });
    const card = q(".vpc-card")!;
    expect(card.getAttribute("data-expanded")).not.toBe("true");
    const expand = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.querySelector(".lucide-maximize"));
    await act(async () => expand!.click());
    expect(q(".vpc-card")?.getAttribute("data-expanded")).toBe("true");
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(q(".vpc-card")?.getAttribute("data-expanded")).not.toBe("true");
  });
});

describe("expired share link", () => {
  it("shows the refresh panel when expiresAt is past and asks the bot once", async () => {
    const onRequestRefresh = vi.fn();
    await mount({ video: { ...vod, expiresAt: Date.now() - 1_000 }, onRequestRefresh });
    expect(q('.vpc-error[data-expired="true"]')).not.toBeNull();
    const ask = q<HTMLButtonElement>('.vpc-chip[data-primary="true"]')!;
    await act(async () => ask.click());
    expect(onRequestRefresh).toHaveBeenCalledTimes(1);
    expect(onRequestRefresh.mock.calls[0]![0]).toContain("Season review");
    expect(q<HTMLButtonElement>('.vpc-chip[data-primary="true"]')!.disabled).toBe(true);
  });

  it("offers only Try again without a way to reach the bot", async () => {
    await mount({ video: { ...vod, expiresAt: Date.now() - 1_000 } });
    expect(q('.vpc-error[data-expired="true"]')).not.toBeNull();
    expect(q('.vpc-chip[data-primary="true"]')).toBeNull();
  });

  it("turns a 403 on the hls manifest into the expired panel", async () => {
    await mount({ video: live, onRequestRefresh: () => {} });
    await act(async () => {
      hls.handlers.get("hlsError")?.("hlsError", { fatal: true, type: "networkError", details: "manifestLoadError", response: { code: 403 } });
    });
    expect(q('.vpc-error[data-expired="true"]')).not.toBeNull();
  });
});
