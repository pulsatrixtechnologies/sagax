// @vitest-environment happy-dom
// The composer's controls: one + that opens Attach files and Teach a task; no Send button (Enter sends; the round CTA turns into the
// send arrow while something is typed, Voice otherwise, in the bot's color);
// a grey mic that dictates into the field, with a recording pill, or opens
// the Keys card when nothing can transcribe here.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ComponentProps, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo } from "@/state/store";
import type { ModelPicker } from "./ModelPicker";

const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(), instances: [] as unknown[], dictation: false,
  // the headless model picker: what it was given, and its menu's control
  picker: null as null | Record<string, unknown>,
  toggleModel: vi.fn(), closeModel: vi.fn(),
}));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, api: vi.fn(async () => ({})), useStore: () => ({
    state: { ...original.initialState, instances: fixture.instances },
    dispatch: fixture.dispatch,
  }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: fixture.dictation }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "x", message: "" } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: vi.fn() }));
vi.mock("./ModelPicker", async () => {
  const { useEffect } = await import("react");
  return { ModelPicker: (props: ComponentProps<typeof ModelPicker>) => {
    fixture.picker = props as unknown as Record<string, unknown>;
    if (props.menuControl) props.menuControl.current = { toggle: fixture.toggleModel, close: fixture.closeModel };
    const { onChip } = props;
    useEffect(() => {
      onChip?.({ label: "Opus 5.5 High", title: "Claude · Opus 5.5", busy: false, ultracode: false, open: false });
    }, [onChip]);
    return createElement("span", { "data-model-picker-mock": "" });
  } };
});
vi.mock("./settings/ProviderKeys", async (importOriginal) => ({
  ...await importOriginal<typeof import("./settings/ProviderKeys")>(),
  openProviderKeyDialog: vi.fn(),
}));

const { Composer } = await import("./Composer");
const { ComposerPlusMenu } = await import("./ComposerControls");
const { setLocale } = await import("@/lib/i18n");
const { openProviderKeyDialog } = await import("./settings/ProviderKeys");
const { forgetVoiceModeStatus } = await import("@/lib/voice-mode/api");

const bot = (color: string): Bot => ({
  id: "bot", threadId: "selected", name: "Harrie", title: "", description: "", color: color as Bot["color"],
  notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "m" },
  tasks: [{ threadId: "selected", title: "Selected", createdAt: 1, busy: false, activity: "idle",
    modelSelection: { instanceId: "test", model: "m" }, approvalMode: "ask" }],
});

let host: HTMLDivElement;
let root: Root;
const render = (element: ReactElement) => flushSync(() => root.render(element));
const $ = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector);
const textarea = () => $<HTMLTextAreaElement>("textarea")!;
const click = (element: Element | null) => flushSync(() => (element as HTMLElement).click());

function type(value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  flushSync(() => {
    setValue.call(textarea(), value);
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  setLocale("en");
  fixture.dispatch.mockClear();
  fixture.toggleModel.mockClear();
  fixture.closeModel.mockClear();
  fixture.picker = null;
  fixture.instances = [];
  fixture.dictation = false;
  forgetVoiceModeStatus();
  // voice mode answers "not available" for this bot
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ provider: "xai", available: false, refusal: { cause: "no_credentials" } }), { status: 200, headers: { "content-type": "application/json" } })));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  delete window.ogb;
  vi.unstubAllGlobals();
});

describe("composer controls (Grok Bot's prompt bar)", () => {
  it("has no Send button: the CTA is Voice when empty and the send arrow once typed", () => {
    render(createElement(Composer, { bot: bot("pink") }));
    expect($('[aria-label="Attach a file"]')).toBeNull();
    expect($("[data-composer-cta]")?.getAttribute("data-composer-cta")).toBe("voice");
    type("hello");
    expect($("[data-composer-cta]")?.getAttribute("data-composer-cta")).toBe("send");
    click($("[data-composer-send]"));
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "send", text: "hello" }));
  });

  it("paints the Voice button in the open bot's color, and keeps a grey bot on the ink button", () => {
    render(createElement(Composer, { bot: bot("pink") }));
    const pink = $("[data-composer-voice]")!.getAttribute("style") ?? "";
    expect(pink).toContain("--cta-fill: #d84f8b");
    render(createElement(Composer, { key: "teal", bot: bot("teal") }));
    const teal = $("[data-composer-voice]")!.getAttribute("style") ?? "";
    expect(teal).toContain("--cta-fill");
    expect(teal).not.toBe(pink);
    render(createElement(Composer, { key: "grey", bot: bot("grey") }));
    expect($("[data-composer-voice]")!.getAttribute("style") ?? "").not.toContain("--cta-fill");
  });

  it("opens a + menu with Attach files, GIF and Teach a task, as in the reference design", () => {
    fixture.instances = [{ instanceId: "test", driverKind: "claude", displayName: "Claude", capabilities: { agentsMcp: true } } as unknown as InstanceInfo];
    render(createElement(Composer, { bot: bot("teal") }));
    click($("[data-composer-plus]"));
    const menu = $('[data-composer-plus-menu]')!;
    expect(menu.getAttribute("role")).toBe("menu");
    const items = [...menu.querySelectorAll<HTMLElement>("[data-composer-plus-item]")];
    expect(items.map((item) => [item.dataset.composerPlusGroup, item.dataset.composerPlusItem])).toEqual([
      ["add", "attach"], ["add", "gif"], ["add", "teach"],
    ]);
    const labels = items.map((item) => item.querySelector(".truncate")?.textContent);
    expect(labels).toEqual(["Attach files", "GIF", "Teach a task"]);
    // no voice note, setup, model or approval rows, and no separators
    expect(menu.querySelectorAll('[role="separator"]').length).toBe(0);
    expect(menu.querySelector("[data-composer-plus-row]")).toBeNull();
    click(menu.querySelector('[data-composer-plus-item="teach"]'));
    expect(textarea().value).toBe("/learn ");
    expect($("[data-composer-plus]")!.getAttribute("aria-expanded")).toBe("false");
  });

  it("has no stand-alone GIF button in the bar; the + menu's GIF row opens the picker on the +", () => {
    render(createElement(Composer, { bot: bot("teal") }));
    expect($("[data-composer-memes]")).toBeNull();
    expect($("[data-meme-picker]")).toBeNull();
    click($("[data-composer-plus]"));
    click($('[data-composer-plus-item="gif"]'));
    expect($("[data-meme-picker]") ?? document.querySelector("[data-meme-picker]")).not.toBeNull();
    expect($("[data-composer-plus]")!.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the model chip in the chat bar (#2106) and keeps no emoji button", () => {
    render(createElement(Composer, { bot: bot("teal") }));
    expect(fixture.picker?.inComposer).toBe(true);
    // Visible chip: ComposerActionBar no longer passes headless (#2106).
    expect(fixture.picker?.headless).not.toBe(true);
    expect($("[data-model-picker-mock]")).not.toBeNull();
    expect($('[aria-label="Insert an emoji"]')).toBeNull();
    expect($("[data-composer-emoji]")).toBeNull();
  });

  it("shows Stop while the turn runs; Escape in the empty field still stops it (#2042)", () => {
    const busy: Bot = { ...bot("teal"), busy: true, tasks: [{ ...bot("teal").tasks![0]!, busy: true, activity: "working" }] };
    render(createElement(Composer, { bot: busy }));
    const stop = $('[aria-label="Stop this turn"]')!;
    expect(stop).not.toBeNull();
    expect(stop.getAttribute("data-composer-stop")).toBe("");
    expect(host.querySelector(".lucide-square")).not.toBeNull();
    click(stop);
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "interrupt", botId: "bot", threadId: "selected" });
    fixture.dispatch.mockClear();
    // #1481: in the bot's own conversation the stop word is sent as is; the
    // server stops the turn at once, keeps the words and answers "Stopped".
    type("Arrête !");
    flushSync(() => textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(fixture.dispatch).toHaveBeenCalledTimes(1);
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "send", botId: "bot", threadId: "selected", text: "Arrête !" }));
    expect(fixture.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "interrupt" }));
    expect(textarea().value).toBe("");
    fixture.dispatch.mockClear();
    flushSync(() => textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "interrupt", botId: "bot", threadId: "selected" });
  });

  it("hides Stop when the conversation is idle", () => {
    render(createElement(Composer, { bot: bot("teal") }));
    expect($('[aria-label="Stop this turn"]')).toBeNull();
    expect($("[data-composer-stop]")).toBeNull();
  });

  it("leaves Teach a task out when the bot cannot draft a skill", () => {
    render(createElement(Composer, { bot: bot("teal") }));
    click($("[data-composer-plus]"));
    expect($('[data-composer-plus-item="teach"]')).toBeNull();
    expect($('[data-composer-plus-item="attach"]')).not.toBeNull();
  });

  it("opens the Keys card from the mic when nothing can transcribe here", () => {
    render(createElement(Composer, { bot: bot("teal") }));
    const mic = $("[data-composer-mic]")!;
    expect(mic.getAttribute("data-composer-mic")).toBe("setup");
    click(mic);
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "providers" });
    expect(openProviderKeyDialog).toHaveBeenCalledWith("xai");
    expect($("[data-dictation-chip]")).toBeNull();
  });

  it("dictates into the field with the Mac's helper: pill with stop, timer and levels; Escape discards", () => {
    fixture.dictation = true;
    let transcript: ((line: { text?: string }) => void) | undefined;
    const speechStart = vi.fn(async () => {});
    const speechStop = vi.fn(async () => {});
    window.ogb = {
      speechStart, speechStop,
      onSpeechTranscript: (cb: (line: { text?: string }) => void) => { transcript = cb; return () => {}; },
      onSpeechEnd: () => () => {},
    } as unknown as NonNullable<Window["ogb"]>;
    render(createElement(Composer, { bot: bot("teal") }));
    type("Note:");
    click($("[data-composer-mic]"));
    expect(speechStart).toHaveBeenCalled();
    const chip = $('[data-dictation-chip="recording"]')!;
    expect(chip.textContent).toContain("0:00");
    expect(chip.querySelectorAll("[data-dictation-levels] > span")).toHaveLength(5);
    expect(chip.querySelector("button")?.getAttribute("aria-label")).toBe("Stop dictation, 0:00");
    // the CTA and the mic give way to the pill
    expect($("[data-composer-cta]")).toBeNull();
    flushSync(() => transcript?.({ text: "buy milk" }));
    expect(textarea().value).toBe("Note: buy milk");
    // Escape on the pill discards what was dictated
    flushSync(() => chip.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(textarea().value).toBe("Note:");
    expect($("[data-dictation-chip]")).toBeNull();
    expect(speechStop).toHaveBeenCalled();
  });

  it("toggles dictation with ⌘D / Ctrl+D in the field", () => {
    fixture.dictation = true;
    window.ogb = {
      speechStart: vi.fn(async () => {}), speechStop: vi.fn(async () => {}),
      onSpeechTranscript: () => () => {}, onSpeechEnd: () => () => {},
    } as unknown as NonNullable<Window["ogb"]>;
    render(createElement(Composer, { bot: bot("teal") }));
    const mac = navigator.userAgent.includes("Mac");
    const press = () => {
      const event = new KeyboardEvent("keydown", { key: "d", metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true });
      flushSync(() => textarea().dispatchEvent(event));
      return event;
    };
    expect(press().defaultPrevented).toBe(true);
    expect($('[data-dictation-chip="recording"]')).not.toBeNull();
    press();
    expect($("[data-dictation-chip]")).toBeNull();
  });

  // Owner, 2026-10-16: on one line the buttons sat 2 px below the bar's middle
  // (28 px buttons end-aligned with a 32 px field). Both groups now sit in a
  // band as tall as the field's first line and center in it.
  it("centers the + and the right-hand buttons on the field's first line", () => {
    render(createElement(Composer, { bot: bot("teal") }));
    const row = $("[data-composer-row]")!;
    expect(row.className).toContain("items-end");
    const plusGroup = $('[aria-haspopup="menu"]')?.closest(".composer-band");
    const actions = $("[data-composer-actions]")!;
    expect(plusGroup?.parentElement).toBe(row);
    for (const group of [plusGroup!, actions]) {
      expect(group.classList).toContain("composer-band");
      expect(group.classList).toContain("items-center");
    }
    expect(actions.querySelector("[data-composer-cta]")).not.toBeNull();
  });

  it("makes the band as tall as one line of the field with its padding", () => {
    const css = readFileSync(resolve(__dirname, "../styles.css"), "utf8");
    const px = (rule: RegExp) => Number(rule.exec(css)?.[1]);
    const desktopLine = px(/\.chat-input-text,\s*\.mention-editor-mirror\s*\{[^}]*line-height:\s*(\d+)px/);
    const phoneLine = px(/@media[^{]*\{\s*\.chat-input-text,\s*\.mention-editor-mirror\s*\{[^}]*line-height:\s*(\d+)px/);
    const desktopBand = px(/^\.composer-band\s*\{\s*min-height:\s*(\d+)px/m);
    const phoneBand = px(/@media[^{]*\{\s*\.composer-band\s*\{\s*min-height:\s*(\d+)px/);
    // py-1.5 on the textarea: 6 px above and below the line
    expect(desktopBand).toBe(desktopLine + 12);
    expect(phoneBand).toBe(phoneLine + 12);
  });
});

describe("ComposerPlusMenu", () => {
  it("moves with the arrow keys and closes on Escape, focus back on the +", async () => {
    const picked = vi.fn();
    render(createElement(ComposerPlusMenu, { items: [
      { id: "a", label: "Attach files", icon: null, onSelect: picked },
      { id: "b", label: "Teach a task", icon: null, onSelect: picked },
    ] }));
    click($("[data-composer-plus]"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const items = [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(document.activeElement).toBe(items[0]);
    flushSync(() => items[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(items[1]);
    flushSync(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect($("[data-composer-plus]")!.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe($("[data-composer-plus]"));
  });
});
