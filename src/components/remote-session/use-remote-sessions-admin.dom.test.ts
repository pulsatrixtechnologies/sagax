// @vitest-environment happy-dom
// Remote sessions page: the enrolled computers list. Each read is one short
// Perspicax MCP session (remote_support_hosts through a seat), so the page
// reads it every 15 s only while it is visible: nothing while the window or
// the tab is hidden, and one read at once when it shows again.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOSTS = "/api/admin/remote-sessions/hosts";
const reads = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock("@/state/store", () => ({
  api: async (url: string) => {
    reads.urls.push(url);
    return { hosts: [], available: true };
  },
}));
const { useUnattendedHosts } = await import("./use-remote-sessions-admin");

let visibility: DocumentVisibilityState = "visible";
let root: Root;
let el: HTMLDivElement;
let reload: () => void = () => {};

function Probe() {
  reload = useUnattendedHosts().reload;
  return null;
}

const hostReads = () => reads.urls.filter((url) => url === HOSTS).length;
const mount = async () => { await act(async () => { root.render(createElement(Probe)); }); };
const wait = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
const show = async (next: DocumentVisibilityState) => {
  visibility = next;
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
};

beforeEach(() => {
  vi.useFakeTimers();
  reads.urls.length = 0;
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

describe("useUnattendedHosts: the enrolled computers list", () => {
  it("reads at once, then every 15 s while the page is visible", async () => {
    await mount();
    expect(hostReads()).toBe(1);
    await wait(15_000);
    expect(hostReads()).toBe(2);
    await wait(30_000);
    expect(hostReads()).toBe(4);
  });

  it("reads nothing while the page is hidden, then once at once when it shows again", async () => {
    await mount();
    expect(hostReads()).toBe(1);
    await show("hidden");
    await wait(5 * 60_000);
    expect(hostReads()).toBe(1);
    await show("visible");
    expect(hostReads()).toBe(2);
    await wait(15_000);
    expect(hostReads()).toBe(3);
  });

  it("never reads when the page opens hidden, until it shows", async () => {
    visibility = "hidden";
    await mount();
    await wait(60_000);
    expect(hostReads()).toBe(0);
    await show("visible");
    expect(hostReads()).toBe(1);
  });

  it("keeps a reload asked while hidden for the read made when the page shows", async () => {
    await mount();
    await show("hidden");
    await act(async () => { reload(); });
    await wait(15_000);
    expect(hostReads()).toBe(1);
    await show("visible");
    expect(hostReads()).toBe(2);
  });
});
