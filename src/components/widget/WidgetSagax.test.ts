// @vitest-environment happy-dom
// Sagax's own checks on the declarative chat widgets ported from upstream
// (docs/superpowers/specs/2026-10-13-chat-widgets-design.md): a widget runs
// no script and reaches no network by itself, even through a Markdown node
// that holds one of Sagax's rich fences; a press is posted as the person's
// next message on the send route; and the reusable card (WidgetCardFrame)
// that the MCP Apps host will draw in.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BotEditorStore, type Message, type useStore } from "@/state/store";
import { parseWidgetInput, type WidgetRoot } from "../../../shared/widget";
import { WidgetCardFrame } from "./WidgetCardFrame";
import { WidgetMessage } from "./WidgetMessage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function tree(input: unknown): WidgetRoot {
  const parsed = parseWidgetInput(input);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

const row = (root: WidgetRoot): Message => ({ id: "w1", role: "bot", kind: "widget", at: 1, text: "fallback", widget: { v: 1, root } });

const fetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
const store = { state: { bots: [] }, dispatch: vi.fn(), flushBotPatches: vi.fn(async () => null) } as unknown as ReturnType<typeof useStore>;

let host: HTMLDivElement;
let root: Root;

function mount(element: ReturnType<typeof createElement>) {
  act(() => root.render(createElement(BotEditorStore, { value: store, children: element })));
}

const widget = (message: Message) => createElement(WidgetMessage, { botId: "scout", threadId: "t1", message });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("what a widget refuses to hold", () => {
  it.each([
    ["an http image", { type: "Card", children: [{ type: "Image", src: "http://example.com/a.png" }] }, /must be an https url/],
    ["a data: image", { type: "Card", children: [{ type: "Image", src: "data:image/png;base64,AAAA" }] }, /must be an https url/],
    ["a javascript: link", { type: "Card", children: [{ type: "Button", label: "Go", onClickAction: { type: "open_url", payload: { url: "javascript:alert(1)" } } }] }, /open_url needs an http or https url/],
    ["a password field", { type: "Card", children: [{ type: "Input", name: "pw", inputType: "password" }] }, /use request_credential/],
    ["a node type it does not know", { type: "Card", children: [{ type: "Script", value: "alert(1)" }] }, /unknown type "Script"/],
  ])("refuses %s, with the path of the problem", (_name, input, error) => {
    const parsed = parseWidgetInput(input);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(error);
  });

  it("drops event handlers and raw HTML props, and keeps markup in a Text as words", () => {
    const parsed = tree({ type: "Card", onLoad: "alert(1)", children: [{ type: "Text", value: "<script>alert(1)</script>", dangerouslySetInnerHTML: { __html: "<b>x</b>" } }] });
    expect(parsed).toEqual({ type: "Card", id: "n1", children: [{ type: "Text", id: "n2", value: "<script>alert(1)</script>" }] });
    mount(widget(row(parsed)));
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("b")).toBeNull();
    expect(host.textContent).toContain("<script>alert(1)</script>");
  });
});

describe("a Markdown node is inert", () => {
  it("shows an HTML ```widget, an ```artifact and a ```cw fence as code, never as a frame or a card", () => {
    const value = [
      "```widget\n<script>fetch('https://example.com')</script>\n```",
      "```artifact\n{\"title\":\"Report\",\"url\":\"https://example.com/page\"}\n```",
      "```cw\n{\"family\":\"tickets\",\"view\":\"list\",\"records\":[]}\n```",
    ].join("\n\n");
    mount(widget(row(tree({ type: "Card", children: [{ type: "Markdown", value }] }))));
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector("script")).toBeNull();
    expect(host.textContent).toContain("<script>fetch('https://example.com')</script>");
    expect(host.textContent).toContain("https://example.com/page");
  });

  it("keeps a YouTube link a link instead of a player", () => {
    mount(widget(row(tree({ type: "Card", children: [{ type: "Markdown", value: "[Watch](https://www.youtube.com/watch?v=dQw4w9WgXcQ)" }] }))));
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("Watch");
  });
});

describe("a press is the person's next message", () => {
  it("posts the widgetAction on the send route with no words of its own", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, threadId: "t1" }), { status: 202, headers: { "content-type": "application/json" } }));
    mount(widget(row(tree({
      type: "Card", title: "Deploy",
      children: [{ type: "Select", name: "env", options: [{ label: "Staging", value: "staging" }, { label: "Production", value: "prod" }], defaultValue: "staging" }],
      confirm: { label: "Deploy now", action: { type: "deploy.start" } },
    }))));
    const deploy = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Deploy now")!;
    await act(async () => { deploy.click(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(String(path)).toMatch(/\/api\/bots\/scout\/messages$/);
    const body = JSON.parse(String(init?.body));
    expect(body).not.toHaveProperty("text");
    expect(body).toMatchObject({ threadId: "t1", widgetAction: { messageId: "w1", ref: "confirm", rev: 0, values: { env: "staging" } } });
    expect(body.sendId).toEqual(expect.any(String));
  });
});

describe("WidgetCardFrame", () => {
  it("draws a header, the caller's content, a problem line and the footer", () => {
    act(() => root.render(createElement(WidgetCardFrame, {
      label: "Weather app", title: "Weather", caption: "From an MCP app", meta: "now", problem: "The app stopped answering.",
      footer: createElement("button", { type: "button" }, "Open"), fallbackText: "Weather", frameId: "app-1",
      children: createElement("iframe", { title: "app", sandbox: "allow-scripts" }),
    })));
    const group = host.querySelector('[data-widget-frame="app-1"]')!;
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-label")).toBe("Weather app");
    expect(host.textContent).toContain("Weather");
    expect(host.textContent).toContain("From an MCP app");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("The app stopped answering.");
    expect(host.querySelector("iframe")?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(Array.from(host.querySelectorAll("button")).map((button) => button.textContent)).toEqual(["Open"]);
  });

  it("falls back to its text when its content throws while drawing", () => {
    const Broken = () => { throw new Error("bad tree"); };
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    act(() => root.render(createElement(WidgetCardFrame, { label: "Broken", fallbackText: "What the card said", children: createElement(Broken) })));
    quiet.mockRestore();
    expect(host.textContent).toBe("What the card said");
  });
});
