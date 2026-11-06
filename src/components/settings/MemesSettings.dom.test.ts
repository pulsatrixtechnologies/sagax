// @vitest-environment happy-dom
// Providers > Other services > Memes (#2295): a compact row. With a saved key
// the key field stays closed behind "Change key"; without one it shows.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = vi.hoisted(() => ({ view: {} as Record<string, unknown> }));

vi.mock("@/lib/memes", () => ({
  loadMemeSettings: vi.fn(async () => fixture.view),
  saveMemeSettings: vi.fn(async () => fixture.view),
  removeMemeSettings: vi.fn(async () => ({ keyConfigured: false, ready: false })),
}));

const { MemesSettings } = await import("./MemesSettings");

let host: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => { root.render(createElement(MemesSettings as (props: { bare?: boolean }) => ReturnType<typeof MemesSettings>, { bare: true })); });
  for (let i = 0; i < 3; i += 1) await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("MemesSettings", () => {
  it("keeps the key field behind Change key when a key is saved", async () => {
    fixture.view = { provider: "giphy", keyConfigured: true, last4: "AB12", ready: true };
    await render();
    expect(host.querySelector("[data-memes-form]")).toBeNull();
    expect(host.textContent).toContain("AB12");
    const change = host.querySelector<HTMLButtonElement>("[data-memes-change-key]");
    expect(change?.textContent).toBe("Change key");
    expect(host.textContent).toContain("Remove");
    await act(async () => { change?.click(); });
    expect(host.querySelector('[data-memes-form="giphy"] input[type="password"]')).not.toBeNull();
    expect(host.textContent).toContain("Cancel");
  });

  it("shows the key field when the service has no key", async () => {
    fixture.view = { provider: "giphy", keyConfigured: false, ready: false };
    await render();
    expect(host.querySelector('[data-memes-form="giphy"]')).not.toBeNull();
    expect(host.querySelector("[data-memes-change-key]")).toBeNull();
  });
});
