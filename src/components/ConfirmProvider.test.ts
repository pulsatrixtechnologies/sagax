/** @vitest-environment happy-dom */
import { createElement, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import {
  ConfirmProvider,
  confirmAsync,
  discardConfirmRequest,
  useConfirm,
} from "./ConfirmProvider";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  root.unmount();
  host.remove();
  setLocale("en");
});

function mount(node: ReactNode) {
  root.render(createElement(ConfirmProvider, null, node));
}

function Probe({ onReady }: { onReady: (confirm: ReturnType<typeof useConfirm>) => void }) {
  const confirm = useConfirm();
  useEffect(() => { onReady(confirm); }, [confirm, onReady]);
  return null;
}

describe("ConfirmProvider", () => {
  it("resolves true when the action is confirmed and false when cancelled", async () => {
    let confirm!: ReturnType<typeof useConfirm>;
    mount(createElement(Probe, { onReady: (fn) => { confirm = fn; } }));
    await vi.waitFor(() => expect(confirm).toBeTypeOf("function"));

    const pending = confirm({
      title: "Delete Pepper?",
      body: "This cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    await vi.waitFor(() => expect(document.querySelector("[role='alertdialog']")).toBeTruthy());
    expect(document.querySelector("#confirm-dialog-title")?.textContent).toBe("Delete Pepper?");
    (document.querySelector("[data-confirm-action]") as HTMLButtonElement).click();
    await expect(pending).resolves.toBe(true);

    const cancelled = confirm({ title: "Leave?", confirmLabel: "Leave", tone: "neutral" });
    await vi.waitFor(() => expect(document.querySelector("[role='alertdialog']")).toBeTruthy());
    const cancel = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='alertdialog'] button")).find((button) => button.textContent === "Cancel");
    cancel!.click();
    await expect(cancelled).resolves.toBe(false);
  });

  it("queues a second confirm behind the first", async () => {
    let confirm!: ReturnType<typeof useConfirm>;
    mount(createElement(Probe, { onReady: (fn) => { confirm = fn; } }));
    await vi.waitFor(() => expect(confirm).toBeTypeOf("function"));

    const first = confirm({ title: "First?", confirmLabel: "Yes" });
    const second = confirm({ title: "Second?", confirmLabel: "Yes" });
    await vi.waitFor(() => expect(document.querySelector("#confirm-dialog-title")?.textContent).toBe("First?"));
    (document.querySelector("[data-confirm-action]") as HTMLButtonElement).click();
    await expect(first).resolves.toBe(true);
    await vi.waitFor(() => expect(document.querySelector("#confirm-dialog-title")?.textContent).toBe("Second?"));
    (document.querySelector("[data-confirm-action]") as HTMLButtonElement).click();
    await expect(second).resolves.toBe(true);
  });

  it("exposes confirmAsync for non-hook callers once mounted", async () => {
    let ready = false;
    function Ready() {
      useEffect(() => { ready = true; }, []);
      return null;
    }
    mount(createElement(Ready));
    await vi.waitFor(() => expect(ready).toBe(true));
    const pending = confirmAsync({ title: "Report?", body: "Send a copy.", confirmLabel: "Send", tone: "neutral" });
    await vi.waitFor(() => expect(document.querySelector("[role='alertdialog']")).toBeTruthy());
    (document.querySelector("[data-confirm-action]") as HTMLButtonElement).click();
    await expect(pending).resolves.toBe(true);
  });

  it("builds the shared discard request", () => {
    const request = discardConfirmRequest();
    expect(request.title).toBe("Close without saving?");
    expect(request.body).toBe("Your changes will be lost.");
    expect(request.confirmLabel).toBe("Discard");
    expect(request.tone).toBe("danger");
    setLocale("fr");
    expect(discardConfirmRequest().title).toBe("Fermer sans enregistrer ?");
  });
});
