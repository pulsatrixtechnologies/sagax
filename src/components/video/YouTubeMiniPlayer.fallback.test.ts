// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const embed = vi.hoisted(() => ({
  onError: undefined as ((code: number) => void) | undefined,
  destroy: vi.fn(),
}));

vi.mock("@/state/store", () => ({ api: vi.fn(), ApiError: class extends Error {} }));
vi.mock("@/lib/youtube-embed", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/youtube-embed")>(),
  createYoutubePlayer: vi.fn(async (mount: HTMLElement, _id: string, hooks: { onError?: (code: number) => void }) => {
    embed.onError = hooks.onError;
    mount.appendChild(document.createElement("iframe"));
    return { seekTo() {}, getCurrentTimeMs: () => null, play() {}, pause() {}, destroy: embed.destroy };
  }),
}));

const { YouTubeMiniPlayer } = await import("./YouTubeMiniPlayer");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  embed.onError = undefined;
  embed.destroy.mockClear();
  vi.unstubAllGlobals();
});

describe("YouTubeMiniPlayer when YouTube will not play the video here", () => {
  it.each([101, 150, 153])("error %i: a Watch on YouTube button instead of YouTube's error screen", async (code) => {
    await act(async () => root.render(createElement(YouTubeMiniPlayer, { videoId: "dQw4w9WgXcQ" })));
    expect(host.querySelector("iframe")).not.toBeNull();
    expect(host.querySelector(".vpc-embed-fallback")).toBeNull();

    await act(async () => embed.onError?.(code));

    const link = host.querySelector<HTMLAnchorElement>(".vpc-embed-fallback a");
    expect(link?.textContent).toBe("Watch on YouTube");
    expect(link?.getAttribute("href")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(host.querySelector(".vpc-embed-fallback")?.getAttribute("data-youtube-error")).toBe(String(code));
    // The player is gone, and the transcript button stays.
    expect(embed.destroy).toHaveBeenCalled();
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector(".vpc-footer .vpc-chip")?.textContent).toContain("Get full transcript");
  });

  it("another video gets a fresh player, without the previous fallback", async () => {
    await act(async () => root.render(createElement(YouTubeMiniPlayer, { videoId: "dQw4w9WgXcQ" })));
    await act(async () => embed.onError?.(150));
    expect(host.querySelector(".vpc-embed-fallback")).not.toBeNull();

    await act(async () => root.render(createElement(YouTubeMiniPlayer, { videoId: "jNQXAC9IVRw" })));
    expect(host.querySelector(".vpc-embed-fallback")).toBeNull();
    expect(host.querySelector("iframe")).not.toBeNull();
  });
});
