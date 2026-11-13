// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { AttachmentThumbnail, THUMBNAIL_LOAD_DEADLINE_MS } from "./AttachmentPreview";

// The browser decides what is on screen; here nothing is until a test says so.
const observed: Array<{ callback: IntersectionObserverCallback; elements: Element[] }> = [];
class FakeObserver {
  elements: Element[] = [];
  constructor(readonly callback: IntersectionObserverCallback) { observed.push(this); }
  observe(element: Element) { this.elements.push(element); }
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("IntersectionObserver", FakeObserver);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const image = { src: "/api/attachments/hang-7.png", name: "Scan" };
const render = (eager: boolean) => act(() => root.render(createElement(AttachmentThumbnail, { image, onPreview: () => undefined, eager })));
const spinning = () => host.querySelector("img") !== null && !host.textContent?.includes("Image unavailable");

describe("a picture that never answers (#4205)", () => {
  it("shows the broken state with Retry instead of spinning for ever, and drops its request", () => {
    render(true);
    expect(spinning()).toBe(true);
    act(() => { vi.advanceTimersByTime(THUMBNAIL_LOAD_DEADLINE_MS); });
    expect(host.textContent).toContain("Image unavailable");
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector('[aria-label="Retry loading Scan"]')).not.toBeNull();
  });

  it("does not count time for a picture that has not come on screen", () => {
    render(false);
    act(() => { vi.advanceTimersByTime(THUMBNAIL_LOAD_DEADLINE_MS * 3); });
    expect(spinning()).toBe(true);
    const watcher = observed.at(-1)!;
    act(() => watcher.callback(watcher.elements.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry), watcher as unknown as IntersectionObserver));
    act(() => { vi.advanceTimersByTime(THUMBNAIL_LOAD_DEADLINE_MS); });
    expect(host.textContent).toContain("Image unavailable");
  });
});
