// @vitest-environment happy-dom
// Lot 5 review fixes: beside/cover follows the ChatView host width (narrow
// pane on a wide desktop covers), and the exchange sheet host lives on the
// chat column so absolute inset-0 never covers the page panel.
import { act, createElement, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  pageBesideChat,
  pageCoversChat,
  PAGE_CHAT_SIDE_MIN_PX,
  usePageChatHostWide,
} from "@/lib/page-chat-layout";
import { ExchangeColumnProvider, ExchangeSheet, useExchangeColumn } from "./BotExchangeChip";
import type { ExchangeRun } from "@/lib/bot-exchange";
import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
setLocale("en");

type ResizeCb = (entries: ReadonlyArray<{ target: Element; contentRect: { width: number } }>) => void;

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  private cb: ResizeCb;
  private targets = new Set<Element>();
  constructor(cb: ResizeCb) {
    this.cb = cb;
    FakeResizeObserver.instances.push(this);
  }
  observe(target: Element) {
    this.targets.add(target);
    this.cb([{ target, contentRect: { width: (target as HTMLElement).getBoundingClientRect().width } }]);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
  }
  fire(width: number) {
    for (const target of this.targets) {
      Object.defineProperty(target, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }),
      });
      this.cb([{ target, contentRect: { width } }]);
    }
  }
}

vi.stubGlobal("ResizeObserver", FakeResizeObserver);

const run: ExchangeRun = {
  id: "ex1",
  party: { id: "peer", name: "Quasar", color: "blue" },
  ends: [
    { id: "self", name: "Scout", color: "green" },
    { id: "peer", name: "Quasar", color: "blue" },
  ],
  messages: [
    { id: "p", role: "user", kind: "text", text: "Which database?", at: 1, peerAsk: { botId: "peer", name: "Quasar" } },
    { id: "r", role: "bot", kind: "text", text: "Postgres.", at: 2, requestMessageId: "p" },
  ] as never,
};

function PageChatShell({ pageOpen, surface = "beside", children }: { pageOpen: boolean; surface?: "stage" | "beside"; children?: ReactNode }) {
  const hostRef = useRef<HTMLElement | null>(null);
  const wide = usePageChatHostWide(hostRef);
  const beside = pageBesideChat(pageOpen, wide, surface);
  const cover = pageCoversChat(pageOpen, wide, surface);
  const { node, ref: exchangeRef } = useExchangeColumn();
  const [sheetOpen, setSheetOpen] = useState(false);
  return createElement(
    ExchangeColumnProvider,
    { node, children: null } as never,
    createElement(
      "main",
      {
        ref: hostRef as never,
        "data-page-host": "",
        "data-page-beside": beside ? "" : undefined,
        "data-page-cover": cover ? "" : undefined,
        "data-page-surface-mode": surface,
        "data-host-wide": wide ? "1" : "0",
        className: `relative isolate flex h-[800px] min-w-0 flex-1 bg-app ${beside ? "flex-row" : "flex-col"}`,
      },
      createElement(
        "div",
        {
          ref: exchangeRef,
          "data-chat-column": "",
          inert: cover ? true : undefined,
          className: `relative isolate flex min-h-0 min-w-0 flex-1 flex-col ${beside ? "order-2 w-[min(26rem,38%)] max-w-[28rem] flex-none border-l" : ""}`,
        },
        createElement(
          "div",
          { "data-chat-scroll": "", className: "min-h-0 flex-1 overflow-y-auto p-3" },
          createElement("button", { type: "button", "data-open-exchange": "", onClick: () => setSheetOpen(true) }, "Open exchange"),
          children,
        ),
        sheetOpen
          ? createElement(ExchangeSheet, { run, showToolCalls: false, onClose: () => setSheetOpen(false) })
          : null,
      ),
      pageOpen
        ? createElement(
          "div",
          {
            "data-page-panel": "p1",
            className: cover ? "absolute inset-0 z-[6] flex flex-col bg-app" : "relative order-1 flex-1 bg-app",
          },
          createElement("button", { type: "button", "data-page-close": "" }, "Close page"),
          cover ? createElement("div", { "data-page-stage-chat": "docked" }, "Stage composer") : null,
          createElement("div", { "data-page-body": "" }, "Page body"),
        )
        : null,
    ),
  );
}

let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  FakeResizeObserver.instances = [];
  host = document.createElement("div");
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
};

describe("ChatView page host width (not window)", () => {
  it("stage default covers even on a wide host (measured HTML file path)", async () => {
    await act(async () => {
      root!.render(createElement(PageChatShell, { pageOpen: true, surface: "stage" }));
    });
    const pageHost = host.querySelector("[data-page-host]") as HTMLElement;
    Object.defineProperty(pageHost, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ width: 1200, height: 800, top: 0, left: 0, right: 1200, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }),
    });
    await act(async () => FakeResizeObserver.instances.at(-1)?.fire(1200));
    await flush();
    expect(pageHost.getAttribute("data-page-cover")).toBe("");
    expect(pageHost.getAttribute("data-page-beside")).toBeNull();
    expect(host.querySelector("[data-page-stage-chat]")).not.toBeNull();
    expect(host.querySelector("[data-chat-column]")?.hasAttribute("inert")).toBe(true);
  });

  it("optional beside covers when the host is a narrow pane on a wide desktop", async () => {
    await act(async () => {
      root!.render(createElement(PageChatShell, { pageOpen: true, surface: "beside" }));
    });
    const pageHost = host.querySelector("[data-page-host]") as HTMLElement;
    Object.defineProperty(pageHost, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ width: 420, height: 800, top: 0, left: 0, right: 420, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }),
    });
    await act(async () => {
      FakeResizeObserver.instances.at(-1)?.fire(420);
    });
    await flush();
    expect(window.innerWidth).toBe(1600);
    expect(420).toBeLessThan(PAGE_CHAT_SIDE_MIN_PX);
    expect(pageHost.getAttribute("data-page-cover")).toBe("");
    expect(pageHost.getAttribute("data-page-beside")).toBeNull();
    expect(pageHost.getAttribute("data-host-wide")).toBe("0");
    expect(host.querySelector("[data-chat-column]")?.hasAttribute("inert")).toBe(true);
  });

  it("optional beside puts chat beside the page when the host itself is wide", async () => {
    await act(async () => {
      root!.render(createElement(PageChatShell, { pageOpen: true, surface: "beside" }));
    });
    const pageHost = host.querySelector("[data-page-host]") as HTMLElement;
    Object.defineProperty(pageHost, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ width: 1200, height: 800, top: 0, left: 0, right: 1200, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }),
    });
    await act(async () => {
      FakeResizeObserver.instances.at(-1)?.fire(1200);
    });
    await flush();
    expect(pageHost.getAttribute("data-page-beside")).toBe("");
    expect(pageHost.getAttribute("data-page-cover")).toBeNull();
    expect(host.querySelector("[data-chat-column]")?.hasAttribute("inert")).toBe(false);
    expect(host.querySelector("[data-page-panel]")?.className).toContain("order-1");
    expect(host.querySelector("[data-chat-column]")?.className).toContain("order-2");
  });

  it("optional beside flips cover when the host resizes without a window change", async () => {
    await act(async () => {
      root!.render(createElement(PageChatShell, { pageOpen: true, surface: "beside" }));
    });
    const pageHost = host.querySelector("[data-page-host]") as HTMLElement;
    const observer = FakeResizeObserver.instances.at(-1)!;
    await act(async () => observer.fire(900));
    await flush();
    expect(pageHost.getAttribute("data-page-beside")).toBe("");
    await act(async () => observer.fire(500));
    await flush();
    expect(pageHost.getAttribute("data-page-cover")).toBe("");
    expect(window.innerWidth).toBe(1600);
  });
});

describe("exchange sheet stays on the chat column", () => {
  it("portals into the chat column and leaves the page panel reachable", async () => {
    await act(async () => {
      root!.render(createElement(PageChatShell, { pageOpen: true, surface: "beside" }));
    });
    const pageHost = host.querySelector("[data-page-host]") as HTMLElement;
    Object.defineProperty(pageHost, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ width: 1200, height: 800, top: 0, left: 0, right: 1200, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }),
    });
    await act(async () => FakeResizeObserver.instances.at(-1)?.fire(1200));
    await flush();

    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-open-exchange]")!.click();
    });
    await flush();

    const chatColumn = host.querySelector("[data-chat-column]")!;
    const pagePanel = host.querySelector("[data-page-panel]")!;
    const sheet = host.querySelector("[data-testid=bot-exchange-sheet]")!;
    expect(sheet).not.toBeNull();
    expect(chatColumn.contains(sheet)).toBe(true);
    expect(pagePanel.contains(sheet)).toBe(false);
    expect(sheet.className).toContain("absolute inset-0");
    expect(pagePanel.querySelector("[data-page-close]")).not.toBeNull();
    expect(pagePanel.querySelector("[data-page-body]")?.textContent).toBe("Page body");
  });
});
