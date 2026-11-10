// @vitest-environment happy-dom
// Mounted PagePublishCard: bot appending v2 while v1 stays mounted must
// reload the summary and flip Updated below / open-latest. Deliberate
// viewing of a non-superseded card version stays on that version.
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ApiError } = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    status: number;
    body?: Record<string, unknown>;
    constructor(message: string, status: number, body?: Record<string, unknown>) {
      super(message);
      this.status = status;
      this.body = body;
    }
  },
}));

const openPage = vi.fn();
let summaryVersions = [{ n: 1, kind: "html", title: "Demo", createdAt: 1, state: "proposed", bytes: 10, botId: "b1" }];
let summaryFetches = 0;
let sourceHtml = "<p>Demo</p>";

vi.mock("@/state/store", () => ({
  api: vi.fn(async (path: string) => {
    if (path === "/api/pages/policy") return { linkSharing: true, readerComments: true };
    // the version's own source, for the capabilities line (#3413): a page that declares nothing
    if (/\/versions\/\d+\/source$/.test(path)) return { version: { n: 1 }, content: sourceHtml };
    const version = /\/versions\/(\d+)$/.exec(path);
    if (version) {
      return {
        version: {
          n: Number(version[1]),
          kind: "html",
          title: "Demo",
          state: "proposed",
          previewPath: `/pages/preview/abcdefgh12345678/${version[1]}`,
        },
      };
    }
    if (path.startsWith("/api/pages/")) {
      summaryFetches += 1;
      return {
        page: {
          id: "abcdefgh12345678",
          title: "Demo KPI Dashboard",
          status: "draft",
          access: "private",
          expiresAt: null,
          currentVersion: null,
          botId: "b1",
          threadId: "t1",
          createdAt: 1,
          updatedAt: 1,
          expired: false,
          versions: summaryVersions,
          comments: 0,
        },
      };
    }
    throw new ApiError("unexpected", 500);
  }),
  useStore: () => ({ state: { groups: [] }, dispatch: vi.fn() }),
  ApiError,
}));

vi.mock("./WidgetFrame", () => ({ useWidgetTheme: () => ({ scheme: "light", css: "", tokens: {} }) }));
vi.mock("@/lib/open-page", () => ({ openPage: (...args: unknown[]) => openPage(...args) }));

import { forgetVersionCapabilities } from "@/lib/page-capabilities-line";
import { PagePublishCard } from "./PublishedPages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  summaryVersions = [{ n: 1, kind: "html", title: "Demo", createdAt: 1, state: "proposed", bytes: 10, botId: "b1" }];
  summaryFetches = 0;
  sourceHtml = "<p>Demo</p>";
  forgetVersionCapabilities();
  openPage.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); });
};

const v1Message = {
  id: "m1",
  role: "bot",
  kind: "text",
  text: "page",
  at: 1,
  pagePublish: { pageId: "abcdefgh12345678", version: 1, title: "Demo KPI Dashboard" },
};

describe("PagePublishCard version refresh while mounted", () => {
  it("reloads the summary when the thread names a newer version and flips Updated below", async () => {
    act(() => root!.render(createElement(PagePublishCard, { message: v1Message as never })));
    await flush();
    expect(summaryFetches).toBe(1);
    expect(host.querySelector("[data-page-card-state]")?.getAttribute("data-page-card-state")).toBe("draft");

    summaryVersions = [
      { n: 1, kind: "html", title: "Demo", createdAt: 1, state: "proposed", bytes: 10, botId: "b1" },
      { n: 2, kind: "html", title: "Demo", createdAt: 2, state: "proposed", bytes: 12, botId: "b1" },
    ];
    act(() => root!.render(createElement(PagePublishCard, { message: v1Message as never, threadLatestVersion: 2 })));
    await flush();
    expect(summaryFetches).toBe(2);
    expect(host.querySelector("[data-page-card-state]")?.getAttribute("data-page-card-state")).toBe("superseded");
    expect(host.querySelector("[data-page-card-state]")?.textContent).toMatch(/Updated below/i);

    act(() => (host.querySelector("[data-page-open]") as HTMLButtonElement).click());
    expect(openPage).toHaveBeenCalledOnce();
    const arg = openPage.mock.calls[0]![0] as { pageId: string; version?: number };
    expect(arg.pageId).toBe("abcdefgh12345678");
    expect(arg.version).toBeUndefined();
  });

  it("keeps deliberate version viewing when this card is still the latest", async () => {
    summaryVersions = [
      { n: 1, kind: "html", title: "Demo", createdAt: 1, state: "proposed", bytes: 10, botId: "b1" },
      { n: 2, kind: "html", title: "Demo", createdAt: 2, state: "proposed", bytes: 12, botId: "b1" },
    ];
    const v2 = {
      ...v1Message,
      id: "m2",
      pagePublish: { pageId: "abcdefgh12345678", version: 2, title: "Demo KPI Dashboard" },
    };
    act(() => root!.render(createElement(PagePublishCard, { message: v2 as never, threadLatestVersion: 2 })));
    await flush();
    expect(host.querySelector("[data-page-card-state]")?.getAttribute("data-page-card-state")).toBe("draft");
    act(() => (host.querySelector("[data-page-open]") as HTMLButtonElement).click());
    const arg = openPage.mock.calls[0]![0] as { version?: number };
    expect(arg.version).toBe(2);
  });

  it("says what the page reads on its card, and nothing for a page with no declaration (#3413)", async () => {
    sourceHtml = '<script type="application/sagax-capabilities+json">{"data":["team-board"],"viewer":true}</script><p>Board</p>';
    act(() => root!.render(createElement(PagePublishCard, { message: v1Message as never })));
    await flush();
    expect(host.querySelector("[data-page-card-caps]")?.textContent).toBe("Reads: the work of your coding teams, your name and role");
    act(() => root!.unmount());
    forgetVersionCapabilities();
    sourceHtml = "<p>Plain</p>";
    root = createRoot(host);
    act(() => root!.render(createElement(PagePublishCard, { message: { ...v1Message, pagePublish: { ...v1Message.pagePublish, version: 1 } } as never })));
    await flush();
    expect(host.querySelector("[data-page-card-caps]")).toBeNull();
  });
});
