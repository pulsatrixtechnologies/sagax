// @vitest-environment happy-dom
// Show a task in my Chrome, in the app: the chooser offers it, Start opens
// the recording, a note joins it, Stop (here or in the tab) hands the steps
// on, and the steps panel lets the person pick where the bot replays it.
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", () => ({ api: fixture.api, useStore: () => ({ state: {}, dispatch: vi.fn() }), useStoreOptional: () => null }));

import { MyChromeRecordDialog, recordedStepLine } from "./MyChromeRecordDialog";
import { TeachChooserDialog, TeachStepsDialog } from "./TeachStepsDialog";
import type { MyChromeRecording } from "@/lib/my-chrome";

let root: Root;
let container: HTMLDivElement;
let anchor: HTMLButtonElement;
const anchorRef = createRef<HTMLElement>();
beforeEach(() => {
  fixture.api.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  anchor = document.createElement("button");
  anchor.setAttribute("data-composer-plus", "");
  document.body.append(anchor);
  (anchorRef as { current: HTMLElement | null }).current = anchor;
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  anchor.remove();
  vi.useRealTimers();
});
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const click = async (selector: string) => {
  await act(async () => { (document.querySelector(selector) as HTMLElement).click(); });
  await flush();
};

describe("Show a task in my Chrome", () => {
  it("is offered by the chooser beside the bot's browser and words", async () => {
    const picked: string[] = [];
    act(() => root.render(createElement(TeachChooserDialog, {
      botName: "Nova", anchorRef, onShow: () => picked.push("browser"), onShowInMyChrome: () => picked.push("mine"), onDescribe: () => picked.push("words"), onClose: () => undefined,
    })));
    expect(document.querySelector("[data-teach-show]")).not.toBeNull();
    expect(document.querySelector("[data-teach-describe]")).not.toBeNull();
    await click("[data-teach-my-chrome]");
    expect(picked).toEqual(["mine"]);
  });

  it("records, takes a note, and hands the steps on at Stop", async () => {
    let recording: MyChromeRecording = { recording: true, startedAt: "2026-10-29T10:00:00.000Z", steps: 0, recent: [], ended: null };
    const calls: Array<[string, unknown]> = [];
    fixture.api.mockImplementation(async (path: string, init?: { body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      calls.push([path, body]);
      if (path === "/api/my-chrome/record/status") return { recording: calls.some(([p]) => p.endsWith("/start")) ? recording : null, unavailable: null };
      if (path === "/api/my-chrome/record/start") {
        recording = { ...recording, steps: 1, recent: [{ id: "1", kind: "open", url: body.url }] };
        return { recording };
      }
      if (path === "/api/my-chrome/record/note") {
        recording = { ...recording, steps: 2, recent: [...recording.recent, { id: "2", kind: "note", text: body.text }] };
        return { recording };
      }
      if (path === "/api/my-chrome/record/stop") return { result: { steps: recording.recent, recordedAt: recording.startedAt, replay: "my-chrome", ended: "person" } };
      return {};
    });
    const done: unknown[] = [];
    act(() => root.render(createElement(MyChromeRecordDialog, { botId: "b1", botName: "Nova", dictationEngine: null, anchorRef, onDone: (result) => done.push(result), onClose: () => undefined })));
    await flush();
    const url = document.querySelector("[data-my-chrome-record] input") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(url, "https://app.example.com/");
      url.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("[data-my-chrome-record-start]");
    expect(document.querySelector("[data-my-chrome-recording]")?.textContent).toContain("1");
    expect(document.querySelector("[data-my-chrome-recent]")?.textContent).toContain("https://app.example.com/");
    const note = document.querySelector("[data-my-chrome-recording] ~ label input, [data-my-chrome-record] label input") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(note, "Pick the newest invoice");
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { note.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await flush();
    expect(calls.find(([path]) => path === "/api/my-chrome/record/note")?.[1]).toEqual({ text: "Pick the newest invoice" });
    await click("[data-my-chrome-record-stop]");
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ replay: "my-chrome", steps: [{ kind: "open" }, { kind: "note", text: "Pick the newest invoice" }] });
  });

  it("names a secret step without its value, and saves the replay the person picked", async () => {
    expect(recordedStepLine({ id: "s", kind: "type", secret: true, target: { role: "textbox", name: "Password", tag: "input" } })).not.toContain("undefined");
    fixture.api.mockResolvedValue({ ok: true, installed: "send-the-request" });
    act(() => root.render(createElement(TeachStepsDialog, {
      botId: "b1", botName: "Nova", recordedAt: "2026-10-29T10:00:00.000Z", replay: "my-chrome", onClose: () => undefined,
      steps: [{ id: "1", kind: "open", url: "https://app.example.com/" }],
    })));
    expect(document.querySelector("[data-teach-replay]")?.getAttribute("data-teach-replay")).toBe("my-chrome");
    const radios = document.querySelectorAll<HTMLInputElement>('input[name="teach-replay"]');
    await act(async () => { radios[0]!.click(); });
    const title = document.querySelector("[data-teach-steps] input") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(title, "Send the request");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("[data-teach-save]");
    const [, init] = fixture.api.mock.calls.at(-1)!;
    expect(JSON.parse((init as { body: string }).body)).toMatchObject({ mode: "save", title: "Send the request", replay: "background" });
  });
});
