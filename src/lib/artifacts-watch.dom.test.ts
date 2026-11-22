// @vitest-environment happy-dom
// An artifact refreshes on the server while a window holds its watch lease
// (server/artifacts/artifact-refresh.ts), and a Perspicax tool source is one
// short MCP session per run. The window renews the lease every 45 s only while
// it is visible: none while it is hidden (the lease lapses, the source stops),
// and one renewal at once when it shows again.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sent = vi.hoisted(() => ({ watch: [] as unknown[] }));
vi.mock("@/state/store", () => ({
  api: async (url: string, init?: { body?: string }) => {
    if (url === "/api/artifacts/watch") sent.watch.push(JSON.parse(init?.body ?? "{}"));
    return { ok: true };
  },
}));
const { useArtifactWatch, watchedArtifactIds, WATCH_RENEW_MS } = await import("./artifacts");

let visibility: DocumentVisibilityState = "visible";
let root: Root;
let el: HTMLDivElement;

function Probe({ id }: { id: string }) {
  useArtifactWatch(id);
  return null;
}

const mount = async () => { await act(async () => { root.render(createElement(Probe, { id: "a1" })); }); };
const wait = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
const show = async (next: DocumentVisibilityState) => {
  visibility = next;
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
};

beforeEach(() => {
  vi.useFakeTimers();
  sent.watch.length = 0;
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
});

afterEach(() => {
  act(() => root.unmount());
  el.remove();
  delete (document as { visibilityState?: unknown }).visibilityState;
  vi.useRealTimers();
});

describe("useArtifactWatch: the watch lease of an open artifact", () => {
  it("takes the lease at once and renews it while the window is visible", async () => {
    await mount();
    expect(sent.watch).toEqual([{ ids: ["a1"] }]);
    await wait(WATCH_RENEW_MS);
    expect(sent.watch).toHaveLength(2);
  });

  it("renews nothing while the window is hidden, then at once when it shows again", async () => {
    await mount();
    expect(sent.watch).toHaveLength(1);
    await show("hidden");
    expect(watchedArtifactIds()).toEqual([]);
    await wait(10 * WATCH_RENEW_MS);
    expect(sent.watch).toHaveLength(1);
    await show("visible");
    expect(sent.watch).toEqual([{ ids: ["a1"] }, { ids: ["a1"] }]);
    expect(watchedArtifactIds()).toEqual(["a1"]);
    await wait(WATCH_RENEW_MS);
    expect(sent.watch).toHaveLength(3);
  });
});
