// @vitest-environment happy-dom
// A click on a page in the Library opens it the one way every page opens
// (openPage, src/lib/open-page.ts): the full panel over the conversation
// while that conversation is on screen, else a window of its own, never a
// panel that shows nothing.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { currentOpenPage, registerPagePanelHost, resetOpenPage } from "@/lib/open-page";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// the Share popover itself (it needs the app's store) as a plain stand-in:
// the test is where the Library draws it
vi.mock("../PageShare", () => ({
  PageSharePopover: ({ page }: { page: { id: string } }) => createElement("div", { "data-page-share-popover": page.id, role: "dialog" }, "share"),
}));

const { LibraryBody } = await import("./LibraryTab");

const now = Date.parse("2026-10-26T12:00:00Z");
const page = {
  id: "pageAAAA1111", title: "Weekly KPIs", status: "draft", access: "private", expiresAt: null, currentVersion: null, botId: "bot1", threadId: "t1",
  createdAt: now - 1000, updatedAt: now - 1000, expired: false, versions: [], pinned: false,
};

let root: Root | null = null;
const windowOpen = vi.fn();
const artifactWindowOpen = vi.fn(async () => "created");
beforeEach(() => {
  setLocale("en");
  (window as unknown as { open: unknown }).open = windowOpen;
  (window as unknown as { ogb: unknown }).ogb = { artifactWindow: { open: artifactWindowOpen } };
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  resetOpenPage();
  windowOpen.mockClear();
  artifactWindowOpen.mockClear();
});

function mount(extra: Record<string, unknown> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(LibraryBody, { threadId: "t1", files: [], list: { artifacts: [], error: false, reload: () => {}, patch: () => {} }, pages: [page] as never, now, ...extra })));
  return host;
}

describe("Library: a page opens the one way", () => {
  it("with the bot's conversation on screen, a click on the row opens the panel, not a window", async () => {
    registerPagePanelHost("bot1");
    const host = mount();
    await act(async () => { host.querySelector<HTMLElement>("[data-page-open]")!.click(); });
    expect(currentOpenPage()).toMatchObject({ pageId: "pageAAAA1111", botId: "bot1", threadId: "t1", title: "Weekly KPIs" });
    expect(artifactWindowOpen).not.toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("without that conversation on screen, the page opens in a window of its own instead of nowhere", async () => {
    const host = mount();
    await act(async () => { host.querySelector<HTMLElement>("[data-page-open]")!.click(); });
    expect(currentOpenPage()).toBeNull();
    expect(artifactWindowOpen).toHaveBeenCalledWith({ botId: "bot1", artifactId: "page:pageAAAA1111", title: "Weekly KPIs" });
  });

  it("Share… draws its popover outside the row's open button and list frame (#3184)", async () => {
    registerPagePanelHost("bot1");
    mount({ openMenus: true });
    const share = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) => item.textContent?.includes("Share…"));
    await act(async () => { share!.click(); });
    const popover = document.querySelector<HTMLElement>("[data-page-share-popover]");
    expect(popover).not.toBeNull();
    expect(popover!.closest("[data-page-open]")).toBeNull();
    expect(popover!.closest("ul")).toBeNull();
    await act(async () => { popover!.click(); });
    expect(currentOpenPage()).toBeNull();
  });
});
