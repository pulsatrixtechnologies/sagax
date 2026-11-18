import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { initMediaProxy, verifyMediaProxyToken } from "./media-proxy.ts";
import { messageCarriesUrl, messageMediaSource } from "./message-media-link.ts";

const HLS = "https://media.example.test/v1/share/recordings/r1/index.m3u8?u=1&exp=9999999999&t=sig";
const message = (text: string) => ({ kind: "text", text });

describe("messageMediaSource", () => {
  beforeAll(() => initMediaProxy(mkdtempSync(join(tmpdir(), "sagax-media-link-"))));

  it("plays an HLS link of the message through the media proxy, the address as fallback", () => {
    const answer = messageMediaSource(message(`Voici :\n\n${HLS}`), HLS, "t-1", 1_000);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.video.playbackUrl).toMatch(/^\/api\/media\/proxy\//);
    expect(answer.video.directUrl).toBe(HLS);
    expect(answer.video.format).toBe("hls");
    const token = decodeURIComponent(answer.video.playbackUrl.slice("/api/media/proxy/".length));
    expect(verifyMediaProxyToken(token, 2_000)).toMatchObject({ u: HLS, t: "t-1" });
  });

  it("follows the same verdict as a video card for a public file", () => {
    const url = "https://cdn.example.test/clip.mp3";
    const answer = messageMediaSource(message(`[Écouter](${url})`), url, "t-1");
    expect(answer).toMatchObject({ ok: true, video: { playbackUrl: url } });
  });

  it("never mints a source for an address the message does not show", () => {
    expect(messageMediaSource(message("rien ici"), HLS, "t-1")).toMatchObject({ ok: false, status: 403 });
    expect(messageMediaSource({ kind: "video", text: HLS }, HLS, "t-1")).toMatchObject({ ok: false, status: 403 });
    expect(messageMediaSource(message("http://cdn.example.test/a.mp4"), "http://cdn.example.test/a.mp4", "t-1")).toMatchObject({ ok: false, status: 400 });
    expect(messageMediaSource(message("x"), undefined, "t-1")).toMatchObject({ ok: false, status: 400 });
  });

  it("finds a percent-encoded destination as written in the text", () => {
    expect(messageCarriesUrl("[a](https://x.test/é.mp4)", "https://x.test/%C3%A9.mp4")).toBe(true);
  });
});
