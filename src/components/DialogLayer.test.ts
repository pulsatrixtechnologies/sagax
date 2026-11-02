// @vitest-environment happy-dom
// The release notes' X only closed when clicked below it (owner, 2026-10-18,
// 0.5.17): the dialog was mounted inside the shell before the chat header,
// and Electron resolves -webkit-app-region in DOM order, so the header's
// 56 px drag strip cut the upper part of the button out. DialogLayer puts
// every such window after the headers, at the end of <body>.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DIALOG, DialogFrame, DialogLayer } from "./SettingsPrimitives";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mountInShell(onClose: () => void) {
  // The shell as App draws it: the dialog first, then the header with its drag strip.
  act(() => root.render(createElement("div", { "data-app-shell": "" },
    createElement(DialogLayer, {
      className: "z-[70]",
      onBackdropMouseDown: onClose,
      children: createElement(DialogFrame, { titleId: "t", title: "Release notes", closeLabel: "Close", onClose }),
    }),
    createElement("header", { className: "content-topbar" }, "Pepper"),
  )));
}

describe("DialogLayer (release notes close button, 2026-10-18)", () => {
  it("mounts the window after every drag-region header, outside the shell", () => {
    mountInShell(() => {});
    const layer = document.querySelector("[data-dialog-layer]")!;
    expect(layer.parentElement).toBe(document.body);
    expect(layer.closest("[data-app-shell]")).toBeNull();
    const header = document.querySelector(".content-topbar")!;
    // DOCUMENT_POSITION_FOLLOWING: the layer comes later, so its no-drag wins.
    expect(header.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(layer.className).toContain("fixed");
  });

  it("closes on a click at the centre of the X, whose 18 px icon is centred in a 32 px button", () => {
    const onClose = vi.fn();
    mountInShell(onClose);
    const close = document.querySelector<HTMLButtonElement>("[data-dialog-close]")!;
    expect(close.getAttribute("aria-label")).toBe("Close");
    for (const token of ["size-8", "flex", "items-center", "justify-center"]) expect(DIALOG.close.split(" ")).toContain(token);
    expect(close.querySelector("svg")?.getAttribute("width")).toBe("18");
    act(() => close.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 16, clientY: 16 })));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on the backdrop, not on the window", () => {
    const onClose = vi.fn();
    mountInShell(onClose);
    act(() => document.querySelector('[role="dialog"]')!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onClose).not.toHaveBeenCalled();
    act(() => document.querySelector("[data-dialog-layer]")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays on the update notes, the update check and About; release notes stay a content page", () => {
    const update = readFileSync(resolve(process.cwd(), "src/components/UpdateBanner.tsx"), "utf8");
    expect(update).toContain("<DialogLayer");
    expect(update).not.toContain('role="alertdialog"');
    expect(update).not.toContain("DIALOG.backdrop");
    const about = readFileSync(resolve(process.cwd(), "src/components/AboutDialog.tsx"), "utf8");
    expect(about).toContain("<DialogLayer");
    expect(about).not.toContain("DIALOG.backdrop");
    const notes = readFileSync(resolve(process.cwd(), "src/components/ReleaseNotesPrompt.tsx"), "utf8");
    expect(notes).not.toContain("<DialogLayer");
    expect(notes).not.toContain("DIALOG.backdrop");
  });

  it("keeps the backdrop and dialogs out of the drag regions (styles.css)", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    expect(css).toMatch(/\[role="dialog"\][^{]*\{[^}]*-webkit-app-region: no-drag/s);
  });
});
