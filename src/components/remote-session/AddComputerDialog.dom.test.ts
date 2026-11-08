// @vitest-environment happy-dom
// "+ Add computer" (#2723): a modal, OS then mode then the exact command;
// assisted mode hands the work to the main bot.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const calls = vi.hoisted(() => ({ issued: [] as unknown[], dispatched: [] as unknown[] }));
vi.mock("@/state/store", () => ({
  useStore: () => ({
    state: { bots: [{ id: "b-helper", name: "Helper", hidden: false }, { id: "b-chief", name: "Ember", chiefOfStaff: true, hidden: false }] },
    dispatch: (action: unknown) => { calls.dispatched.push(action); },
  }),
}));
vi.mock("./remote-hosts-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./remote-hosts-client")>()),
  createHostInstallCode: async (options: unknown) => {
    calls.issued.push(options);
    return {
      code: "K7QM", enrollUrl: "https://example.org/e/K7QM", org: "Acme", scope: "view-only", expiresAt: null,
      installCommand: "sudo posix", installCommands: { macos: "sudo mac", linux: "sudo linux", windows: "irm win | iex" },
    };
  },
}));
const { AddComputerDialog } = await import("./AddComputerDialog");

let root: Root;
let el: HTMLDivElement;
const onClose = vi.fn();
beforeEach(() => {
  setLocale("en"); calls.issued.length = 0; calls.dispatched.length = 0; onClose.mockReset();
  el = document.createElement("div"); document.body.append(el); root = createRoot(el);
});
afterEach(() => { act(() => root.unmount()); el.remove(); });
const mount = async () => { await act(async () => { root.render(createElement(AddComputerDialog, { onClose })); }); };
const click = async (selector: string) => { await act(async () => { document.querySelector<HTMLElement>(selector)!.click(); }); };

describe("AddComputerDialog", () => {
  it("asks for the OS first, with no device list and no drag", async () => {
    await mount();
    expect(document.querySelector('[data-add-computer="os"]')).not.toBeNull();
    expect([...document.querySelectorAll("[data-add-computer-os]")].map((b) => b.getAttribute("data-add-computer-os"))).toEqual(["macos", "windows", "linux"]);
    expect(document.querySelector("[data-my-devices]")).toBeNull();
    expect(document.body.textContent?.toLowerCase()).not.toContain("drag");
  });

  it("gives the exact Windows command after the unattended step", async () => {
    await mount();
    await click('[data-add-computer-os="windows"]');
    await click("[data-add-computer-next]");
    expect(document.querySelector('[data-add-computer="mode"]')).not.toBeNull();
    await act(async () => {
      const input = document.querySelector<HTMLInputElement>("[data-add-computer-consent]")!;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "CW-12");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("[data-add-computer-generate]");
    expect(calls.issued).toEqual([{ scope: "full-control", consentRef: "CW-12" }]);
    expect(document.querySelector('[data-add-computer="done"]')).not.toBeNull();
    const text = document.body.textContent ?? "";
    expect(text).toContain("irm win | iex");
    expect(text).not.toContain("sudo mac");
    expect(text).toContain("https://example.org/e/K7QM");
    expect(text).toContain("PowerShell");
  });

  it("hands assisted mode to the main bot", async () => {
    await mount();
    await click('[data-add-computer-os="linux"]');
    await click("[data-add-computer-next]");
    await click('[data-add-computer-mode="assisted"]');
    expect(document.querySelector("[data-add-computer-ask]")?.textContent).toBe("Ask Ember");
    await click("[data-add-computer-ask]");
    expect(calls.dispatched[0]).toMatchObject({ type: "send", botId: "b-chief" });
    expect((calls.dispatched[0] as { text: string }).text).toContain("Linux");
    expect(calls.dispatched[1]).toEqual({ type: "select", id: "b-chief" });
    expect(onClose).toHaveBeenCalled();
    expect(calls.issued).toHaveLength(0);
  });
});
