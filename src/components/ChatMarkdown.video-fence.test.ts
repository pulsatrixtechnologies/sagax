// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hlsCalls = vi.hoisted(() => ({ loadSource: [] as string[] }));

vi.mock("@/state/store", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/state/store")>();
  return { ...mod, api: vi.fn() };
});

vi.mock("hls.js", () => ({
  default: class {
    static Events = { ERROR: "hlsError" };
    static isSupported() { return true; }
    loadSource(src: string) { hlsCalls.loadSource.push(src); }
    attachMedia() {}
    on() {}
    destroy() {}
  },
}));

const { ChatMarkdown } = await import("./ChatMarkdown");
const { StoreProvider } = await import("@/state/store");
const { ThreadRefsContext } = await import("./ThreadRefs");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LIVE_URL = "https://glitcho.test/v1/share/live/ninja/index.m3u8?u=7&exp=1760000000&t=sig";
const ENVELOPE = `{"sagaxVideos":[{"kind":"live","url":"${LIVE_URL}","title":"Ranked grind","streamer":"ninja"}]}`;

let host: HTMLDivElement;
let root: Root;

async function mount(text: string): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        StoreProvider,
        null,
        createElement(ThreadRefsContext.Provider, { value: { threads: [], currentBotId: undefined } }, createElement(ChatMarkdown, { text })),
      ),
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  hlsCalls.loadSource.length = 0;
  vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("ChatMarkdown sagaxVideos card", () => {
  it("draws a ```json fence holding sagaxVideos as the player, not raw JSON (2026-11-06 case)", async () => {
    await mount(`Player's on the card. She's still live.\n\n\`\`\`json\n${ENVELOPE}\n\`\`\`\n\nHit play on that card.`);
    expect(host.querySelector("[data-video-fence]")).not.toBeNull();
    expect(host.querySelector("video")).not.toBeNull();
    expect(host.querySelector("pre")).toBeNull();
    expect(host.textContent).not.toContain("sagaxVideos");
    expect(host.textContent).toContain("Ranked grind");
  });

  it("draws bare JSON on its own line as the player", async () => {
    await mount(`She's live.\n${ENVELOPE}\nEnjoy.`);
    expect(host.querySelector("[data-video-fence]")).not.toBeNull();
    expect(host.textContent).not.toContain("sagaxVideos");
    expect(host.textContent).toContain("Enjoy.");
  });

  it("plays a live HLS card through hls.js in a video element", async () => {
    await mount(`\`\`\`video\n${ENVELOPE}\n\`\`\``);
    expect(host.querySelector("video")).not.toBeNull();
    expect(hlsCalls.loadSource).toEqual([LIVE_URL]);
  });

  it("falls back to a note with the link for invalid JSON, never raw JSON or an empty box", async () => {
    await mount(`\`\`\`json\n{"sagaxVideos":[{"kind":"live","url":"${LIVE_URL}"\n\`\`\``);
    const note = host.querySelector("[data-video-fallback]");
    expect(note).not.toBeNull();
    expect(note?.querySelector("a")?.getAttribute("href")).toBe(LIVE_URL);
    expect(note?.textContent?.trim().length).toBeGreaterThan(0);
    expect(host.querySelector("pre")).toBeNull();
    expect(host.querySelector("video")).toBeNull();
  });

  it("leaves an ordinary ```json fence as code", async () => {
    await mount("```json\n{\"a\":1}\n```");
    expect(host.querySelector("pre")).not.toBeNull();
    expect(host.querySelector("[data-video-fence]")).toBeNull();
  });
});
