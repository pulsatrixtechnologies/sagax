// @vitest-environment happy-dom
// The shared markdown editor: the CodeMirror chunk mounts with the value,
// toolbar actions report through onChange, Preview renders with the chat
// renderer, Simple mode keeps the extras behind More, and a value from
// outside replaces the text without echoing back through onChange.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { setInterfaceMode } from "@/lib/interface-mode";
import { MarkdownEditor, loadMarkdownEditorCore, shortcutLabel, type MarkdownEditorProps } from "./MarkdownEditor";

let host: HTMLDivElement;
let root: Root;

const render = (props: Partial<MarkdownEditorProps> & Pick<MarkdownEditorProps, "value" | "onChange">) =>
  flushSync(() => root.render(createElement(MarkdownEditor, { ariaLabel: "Notes", ...props })));

export async function mountedEditor(container: ParentNode): Promise<HTMLElement> {
  await loadMarkdownEditorCore();
  for (let i = 0; i < 50; i += 1) {
    const content = container.querySelector<HTMLElement>(".cm-content");
    if (content) return content;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("the editor did not mount");
}

beforeEach(() => {
  setLocale("en");
  setInterfaceMode("advanced");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

describe("MarkdownEditor", () => {
  it("mounts CodeMirror with the value, its label and the word count", async () => {
    render({ value: "# Rules\n\nBe **kind**.", onChange: vi.fn() });
    const content = await mountedEditor(host);
    expect(content.textContent).toContain("# Rules");
    expect(content.getAttribute("aria-label")).toBe("Notes");
    expect(host.querySelector("[data-markdown-count]")?.textContent).toContain("3 words");
  });

  it("reports a toolbar edit through onChange", async () => {
    const onChange = vi.fn();
    render({ value: "item", onChange });
    await mountedEditor(host);
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-md-tool="bullet"]')!.click());
    expect(onChange).toHaveBeenLastCalledWith("- item");
  });

  it("formats the whole text with the Format button", async () => {
    const onChange = vi.fn();
    render({ value: "# Title\ntext  \n* a", onChange });
    await mountedEditor(host);
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-md-tool="format"]')!.click());
    expect(onChange).toHaveBeenLastCalledWith("# Title\n\ntext\n\n- a");
  });

  it("takes a new value from outside without echoing it", async () => {
    const onChange = vi.fn();
    render({ value: "one", onChange });
    const content = await mountedEditor(host);
    render({ value: "two", onChange });
    expect(content.textContent).toBe("two");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("previews with the chat renderer", async () => {
    render({ value: "## Hello\n\n- a", onChange: vi.fn() });
    await mountedEditor(host);
    const previewButton = [...host.querySelectorAll("button")].find((button) => button.textContent === "Preview")!;
    flushSync(() => previewButton.click());
    const preview = host.querySelector("[data-markdown-preview]")!;
    expect(preview.querySelector(".chat-md")).not.toBeNull();
    expect(preview.textContent).toContain("Hello");
    expect(preview.querySelector("li")?.textContent).toBe("a");
  });

  it("keeps the extras behind More in Simple mode", async () => {
    setInterfaceMode("simple");
    render({ value: "", onChange: vi.fn() });
    await mountedEditor(host);
    const tools = () => [...host.querySelectorAll("[data-md-tool]")].map((button) => button.getAttribute("data-md-tool"));
    expect(tools()).toEqual(["bold", "italic", "bullet", "task", "link", "more"]);
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-md-tool="more"]')!.click());
    expect(tools()).toContain("table");
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "Side by side")).toBe(false);
  });

  it("labels every toolbar button and names its shortcut", async () => {
    render({ value: "", onChange: vi.fn() });
    await mountedEditor(host);
    const bold = host.querySelector('[data-md-tool="bold"]')!;
    expect(bold.getAttribute("aria-label")).toBe("Bold");
    expect(host.querySelector('[role="toolbar"]')?.getAttribute("aria-label")).toBe("Formatting");
    expect(shortcutLabel("Mod-Shift-7", true)).toBe("⌘⇧7");
    expect(shortcutLabel("Mod-b", false)).toBe("Ctrl+B");
  });

  it("caps the text at maxLength and shows the count against it", async () => {
    render({ value: "abc", onChange: vi.fn(), maxLength: 10 });
    await mountedEditor(host);
    expect(host.querySelector("[data-markdown-count]")?.textContent).toContain("3 / 10");
  });
});

describe("compact and full screen (routine instructions, 2026-10-29)", () => {
  it("keeps the everyday buttons even in Advanced mode, with Preview as one toggle", () => {
    setInterfaceMode("advanced");
    render({ value: "Hello", onChange: () => {}, compact: true });
    const tools = [...host.querySelectorAll("[data-md-tool]")].map((button) => button.getAttribute("data-md-tool"));
    expect(tools).toEqual(["bold", "italic", "bullet", "task", "link", "more"]);
    expect(host.textContent).not.toContain("Side by side");
    expect(host.textContent).toContain("Preview");
    expect(host.textContent).not.toContain("Write");
  });

  it("opens full screen and comes back", () => {
    render({ value: "Long instructions", onChange: () => {}, compact: true, expandable: true });
    const button = host.querySelector<HTMLButtonElement>("[data-md-full]")!;
    expect(button.getAttribute("aria-label")).toBe("Full screen");
    flushSync(() => button.click());
    const shell = host.querySelector<HTMLElement>("[data-markdown-editor]")!;
    expect(shell.className).toContain("fixed");
    expect(button.getAttribute("aria-label")).toBe("Exit full screen");
    flushSync(() => button.click());
    expect(shell.className).not.toContain("fixed");
  });

  it("hides the word count until the person is editing, and shows it in full screen", async () => {
    render({ value: "Hello there", onChange: () => {}, compact: true, expandable: true });
    await mountedEditor(host);
    expect(host.querySelector("[data-markdown-count]")).toBeNull();
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-md-tool="bold"]')!.focus());
    expect(host.querySelector("[data-markdown-count]")?.textContent).toMatch(/2 words/);
    flushSync(() => host.querySelector<HTMLButtonElement>("[data-md-full]")!.click());
    expect(host.querySelector("[data-markdown-count]")?.textContent).toMatch(/2 words/);
  });
});
