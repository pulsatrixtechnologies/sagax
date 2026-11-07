import { describe, expect, it } from "vitest";

import {
  chapterAt,
  clampLiveSeek,
  clampPan,
  clampZoom,
  hasDvr,
  isBehindLive,
  isExpiredAt,
  isExpiredStatus,
  keyAction,
  liveLatency,
  liveWindowOf,
  loadResumePosition,
  planHlsError,
  RELOAD_MAX_ATTEMPTS,
  reloadBackoffMs,
  resumeKey,
  saveResumePosition,
  uptimeMs,
} from "./video-player-state";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

const ranges = (start: number, end: number) => ({ length: 1, start: () => start, end: () => end });

describe("live window", () => {
  it("reads the last seekable range and tells a DVR from a short buffer", () => {
    expect(liveWindowOf(null)).toBeNull();
    expect(liveWindowOf(ranges(0, 600))).toEqual({ start: 0, end: 600 });
    expect(hasDvr({ start: 0, end: 600 })).toBe(true);
    expect(hasDvr({ start: 590, end: 600 })).toBe(false);
  });

  it("measures latency from the live edge and clamps seeks", () => {
    const w = { start: 0, end: 600 };
    expect(liveLatency(590, w, 597)).toBe(7);
    expect(isBehindLive(590, w, 597)).toBe(false);
    expect(isBehindLive(500, w)).toBe(true);
    expect(clampLiveSeek(900, w)).toBe(599);
    expect(clampLiveSeek(-5, w)).toBe(0);
  });
});

describe("recovery and expiry", () => {
  it("backs off 1, 2, 4, 8 s and caps", () => {
    expect([0, 1, 2, 3, 4].map(reloadBackoffMs)).toEqual([1000, 2000, 4000, 8000, 8000]);
  });

  it("plans hls.js errors", () => {
    const fresh = { network: 0, media: 0 };
    expect(planHlsError({ fatal: false, response: { code: 403 } }, fresh)).toBe("expired");
    expect(planHlsError({ fatal: false, type: "networkError" }, fresh)).toBe("ignore");
    expect(planHlsError({ fatal: true, type: "networkError" }, fresh)).toBe("reload");
    expect(planHlsError({ fatal: true, type: "networkError" }, { network: RELOAD_MAX_ATTEMPTS, media: 0 })).toBe("fail");
    expect(planHlsError({ fatal: true, type: "mediaError" }, fresh)).toBe("recover-media");
    expect(planHlsError({ fatal: true, type: "mediaError" }, { network: 0, media: 2 })).toBe("fail");
  });

  it("knows an expired status or time", () => {
    expect([401, 403, 410, 404, 500].map(isExpiredStatus)).toEqual([true, true, true, false, false]);
    expect(isExpiredAt(1_000, 2_000)).toBe(true);
    expect(isExpiredAt(3_000, 2_000)).toBe(false);
    expect(isExpiredAt(undefined)).toBe(false);
  });
});

describe("resume position", () => {
  it("keys by id, then by what the card shows, never by the proxied URL first", () => {
    expect(resumeKey({ id: "7", playbackUrl: "/p/a" })).toBe("id:7");
    expect(resumeKey({ title: "T", streamer: "S", playbackUrl: "/p/a" })).toBe("meta:S|T");
    expect(resumeKey({ playbackUrl: "/p/a" })).toBe("url:/p/a");
  });

  it("keeps from 10 s, clears past 95 %, caps entries", () => {
    const s = memoryStorage();
    saveResumePosition("a", 5, 100, s);
    expect(loadResumePosition("a", s)).toBeNull();
    saveResumePosition("a", 42.7, 100, s);
    expect(loadResumePosition("a", s)).toBe(42);
    saveResumePosition("a", 96, 100, s);
    expect(loadResumePosition("a", s)).toBeNull();
    for (let i = 0; i < 205; i++) saveResumePosition(`k${i}`, 20, 100, s, i);
    expect(Object.keys(JSON.parse(s.getItem("sagax.video.resume.v1")!))).toHaveLength(200);
    expect(loadResumePosition("k0", s)).toBeNull();
    expect(loadResumePosition("k204", s)).toBe(20);
  });
});

describe("keyboard, zoom, uptime, chapters", () => {
  it("maps the player shortcuts", () => {
    expect(keyAction(" ")).toBe("toggle-play");
    expect(keyAction("K")).toBe("toggle-play");
    expect(keyAction("ArrowLeft")).toBe("seek-back");
    expect(keyAction("l")).toBe("go-live");
    expect(keyAction("t")).toBe("toggle-expand");
    expect(keyAction("=", { meta: true })).toBe("zoom-in");
    expect(keyAction("0", { ctrl: true })).toBe("zoom-reset");
    expect(keyAction("x", { meta: true })).toBeNull();
    expect(keyAction("k", { alt: true })).toBeNull();
  });

  it("clamps zoom and pan", () => {
    expect(clampZoom(9)).toBe(4);
    expect(clampZoom(0.2)).toBe(1);
    expect(clampPan({ x: 500, y: -500 }, 2, { width: 400, height: 200 })).toEqual({ x: 200, y: -100 });
    expect(clampPan({ x: 5, y: 5 }, 1, { width: 400, height: 200 })).toEqual({ x: 0, y: 0 });
  });

  it("computes uptime and the current chapter", () => {
    expect(uptimeMs("2026-11-06T12:00:00Z", Date.parse("2026-11-06T13:00:00Z"))).toBe(3_600_000);
    expect(uptimeMs("2026-11-06T14:00:00Z", Date.parse("2026-11-06T13:00:00Z"))).toBeNull();
    const chapters = [{ startMs: 0, title: "A" }, { startMs: 60_000, title: "B" }];
    expect(chapterAt(chapters, 30)?.title).toBe("A");
    expect(chapterAt(chapters, 61)?.title).toBe("B");
    expect(chapterAt(undefined, 61)).toBeNull();
  });
});
