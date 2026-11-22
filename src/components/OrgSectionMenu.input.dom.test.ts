// @vitest-environment happy-dom
// Renaming a sidebar section in place (#5065): the field shows the stored
// name, Enter and a click outside save it, Escape leaves the old name.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SectionNameInput } from "./OrgSectionMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
});

async function mount(onSave: (name: string) => Promise<string | null>, onCancel: () => void) {
  await act(async () => {
    root.render(createElement(SectionNameInput, { initial: "External", onSave, onCancel }));
  });
  return host.querySelector("input")!;
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    valueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("section rename field", () => {
  it("shows the stored name, not a capitalised display label", async () => {
    const input = await mount(async () => null, () => {});
    expect(input.value).toBe("External");
    expect(input.className.split(/\s+/)).not.toContain("uppercase");
  });

  it("saves the new name when the field loses focus", async () => {
    const onSave = vi.fn(async () => null);
    const onCancel = vi.fn();
    const input = await mount(onSave, onCancel);
    await type(input, "Vendors");
    await act(async () => { input.blur(); });
    expect(onSave).toHaveBeenCalledWith("Vendors");
    const savedAt = onSave.mock.invocationCallOrder[0] ?? 0;
    const cancelledAt = onCancel.mock.invocationCallOrder[0];
    // closing the field may follow the save; it must not replace it
    expect(cancelledAt === undefined || cancelledAt > savedAt).toBe(true);
  });

  it("saves the new name on Enter", async () => {
    const onSave = vi.fn(async () => null);
    const onCancel = vi.fn();
    const input = await mount(onSave, onCancel);
    await type(input, "Vendors");
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onSave).toHaveBeenCalledWith("Vendors");
  });

  it("leaves the old name on Escape", async () => {
    const onSave = vi.fn(async () => null);
    const onCancel = vi.fn();
    const input = await mount(onSave, onCancel);
    await type(input, "Vendors");
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
