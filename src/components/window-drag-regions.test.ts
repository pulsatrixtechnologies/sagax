// The top bar of every view is the window's drag handle wherever the app
// draws its own title bar: macOS (hiddenInset traffic lights) and frameless
// Windows. Linux keeps its native title bar, so nothing there drags. The
// rendered headers are parsed into a DOM and checked region by region:
// the header drags, and every control inside it is cut back out, either by
// an inline no-drag or by the styles.css rule for drag regions.
import { readFileSync } from "node:fs";
import { createElement, type CSSProperties, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, type Bot, type Group } from "@/state/store";

type Chrome = "mac-inset" | "win-caption" | "native";
// The real provider picks the chrome from the preload's platform on render.
const PLATFORM: Record<Chrome, string> = { "mac-inset": "darwin", "win-caption": "win32", native: "linux" };
const fixture = { chrome: "native" as Chrome };

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));

const { ChatView } = await import("./ChatView");
const { GroupView } = await import("./GroupView");
const { DesktopCapabilitiesProvider, WindowDragStrip, captionChrome } = await import("./DesktopCapabilities");

// The selector of the styles.css rule that opts controls inside a drag
// region (and portalled menus) back out.
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const noDragRule = /\/\* Window drag regions\.[\s\S]*?\*\/\s*([^{]+)\{\s*-webkit-app-region: no-drag;/.exec(css);
const noDragSelector = noDragRule![1].trim();

const bot: Bot = {
  id: "bot", threadId: "thread", name: "Pepper", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "default" },
};
const room: Group = {
  id: "room", threadId: "room-thread", name: "Launch planning", memberIds: [],
  defaultResponder: { kind: "member", botId: "atlas" }, bulletin: "", unread: false,
  createdAt: 1, setupCompletedAt: 1, messages: [],
};

const dom = (element: ReactElement) => {
  vi.stubGlobal("window", { ...globalThis.window, ogb: { platform: PLATFORM[fixture.chrome] } });
  const markup = renderToStaticMarkup(createElement(DesktopCapabilitiesProvider, null, createElement(StoreProvider, null, element)));
  const window = new Window();
  window.document.body.innerHTML = markup;
  return window.document;
};
// The few element methods these checks use, met by happy-dom's elements.
type DomNode = { getAttribute(name: string): string | null; parentElement: DomNode | null; matches(selector: string): boolean };
// Read off the style attribute: happy-dom's CSSStyleDeclaration drops the
// Electron-only property.
const styleValue = (element: DomNode | null, property: string) =>
  new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`).exec(element?.getAttribute("style") ?? "")?.[1].trim() ?? "";
const region = (element: DomNode | null) => styleValue(element, "-webkit-app-region");
beforeEach(() => {
  vi.stubGlobal("window", { ogb: undefined, location: { protocol: "http:", search: "" }, innerWidth: 1280 });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

describe("caption chrome", () => {
  it.each<[Chrome, boolean]>([["mac-inset", true], ["win-caption", true], ["native", false]])(
    "%s headers drag: %s",
    (chrome, drags) => {
      const value = captionChrome(chrome);
      expect(value.draggable).toBe(drags);
      expect(value.dragProps["data-window-drag"] === "").toBe(drags);
      const appRegion = (style: CSSProperties | undefined) => (style as Record<string, unknown> | undefined)?.WebkitAppRegion;
      expect(appRegion(value.dragProps.style)).toBe(drags ? "drag" : undefined);
      expect(appRegion(value.noDragStyle)).toBe(drags ? "no-drag" : undefined);
    },
  );

  it("keeps the caption corner offsets on Windows only", () => {
    expect(captionChrome("win-caption").controlsShiftStyle).toMatchObject({ marginTop: "16px" });
    expect(captionChrome("win-caption").padClass).toBe("pt-[28px]");
    expect(captionChrome("mac-inset").controlsShiftStyle).toBeUndefined();
    expect(captionChrome("mac-inset").padClass).toBeUndefined();
  });

  it("opts controls, menus and dialogs out of a drag region in styles.css", () => {
    const document = new Window().document;
    document.body.innerHTML = `<div data-window-drag><button></button><input><a href="#"></a><span role="button"></span><span></span><div class="field"><select></select><svg></svg></div></div><div role="menu"></div><div class="fixed backdrop"><div role="dialog"></div></div><div class="fixed overlay"><p></p></div>`;
    const matches = [...document.querySelectorAll("button, input, a, span, .field, [role], .backdrop, .overlay")].map((element) => element.matches(noDragSelector));
    // button, input, link, role=button, plain text, the select's wrapper (so
    // its chevron), menu, a modal's backdrop, its dialog, a fixed layer that
    // holds no dialog
    expect(matches).toEqual([true, true, true, true, false, true, true, true, true, false]);
  });
});

// Sagax keeps its own chat and room header rows (upstream's three-column
// header with per-control markers was not taken): the row is the drag region
// and styles.css cuts its controls back out.
describe.each([
  ["chat", () => createElement(ChatView, { bot })],
  ["room", () => createElement(GroupView, { group: room })],
] as const)("%s header", (_name, view) => {
  it.each<Chrome>(["mac-inset", "win-caption"])("is a drag region on %s", (chrome) => {
    fixture.chrome = chrome;
    const header = dom(view()).querySelector(".content-topbar[data-window-drag]");
    expect(header).not.toBeNull();
    expect(region(header)).toBe("drag");
  });

  it("leaves Linux's native title bar alone", () => {
    fixture.chrome = "native";
    const document = dom(view());
    expect(document.querySelector("[data-window-drag]")).toBeNull();
    expect(document.body.innerHTML).not.toContain("app-region");
  });
});

describe("headerless views", () => {
  it.each<[Chrome, boolean]>([["mac-inset", true], ["win-caption", true], ["native", false]])(
    "get a top drag strip on %s: %s",
    (chrome, drags) => {
      fixture.chrome = chrome;
      const strip = dom(createElement(WindowDragStrip)).querySelector("[data-window-drag-strip]") as HTMLElement | null;
      expect(Boolean(strip)).toBe(drags);
      if (strip) {
        expect(region(strip)).toBe("drag");
        expect(strip.getAttribute("aria-hidden")).toBe("true");
        expect(strip.className).toContain("pointer-events-none");
      }
    },
  );
});

// Owner bug 2026-11-17 (solo layout): the title bar's buttons often did not
// react. Blink takes a -webkit-app-region box from the untransformed layout,
// so a control (or a wrapper of one) moved by a CSS transform keeps its
// no-drag box where it was before the move and the drag region eats the click.
// Every button in a title bar is cut out of the drag by the styles.css rule,
// and nothing in the bar is placed by a transform.
describe.each([
  ["chat", () => createElement(ChatView, { bot })],
  ["room", () => createElement(GroupView, { group: room })],
] as const)("%s title bar hit areas", (_name, view) => {
  it.each<Chrome>(["mac-inset", "win-caption"])("has no transformed element and only no-drag buttons on %s", (chrome) => {
    fixture.chrome = chrome;
    const bar = dom(view()).querySelector("[data-chat-header-bar]")!;
    expect(bar).not.toBeNull();
    const buttons = [...bar.querySelectorAll("button")] as unknown as DomNode[];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.matches(noDragSelector) || region(button) === "no-drag").toBe(true);
    }
    for (const element of [bar, ...bar.querySelectorAll("*")]) {
      expect(String((element as { className?: unknown }).className ?? "")).not.toMatch(/(^|\s)-?(translate|scale|rotate|skew)-|(^|\s)transform(\s|$)/);
    }
  });
});

describe("the sidebar head", () => {
  it("keeps its buttons outside any transform and under the drag opt-out", () => {
    const source = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
    const head = source.slice(source.indexOf("<div data-sidebar-head"), source.indexOf("{/* Bot list."));
    expect(head).toContain('className="window-drag shrink-0"');
    expect(head).not.toMatch(/(^|[\s"'])-?(translate|scale|rotate|skew)-/);
    // `.window-drag` buttons are cut out by the stylesheet rule, for every button the head draws
    expect(css).toContain(".window-no-drag,\n.app-resize-handle,\n:is(.window-drag, .content-topbar) :is(button,");
    expect(head).toContain("window-no-drag");
  });
});
