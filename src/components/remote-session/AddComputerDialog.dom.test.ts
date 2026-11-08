// @vitest-environment happy-dom
// "+ Add computer" (#2723): a modal, OS then mode then the exact command;
// assisted mode hands the work to the main bot.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale, t } from "@/lib/i18n";
import type { UnattendedHostRow } from "../../../shared/remote-unattended-host";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const calls = vi.hoisted(() => ({ issued: [] as unknown[], dispatched: [] as unknown[], bots: [] as unknown[] }));
const fakeStore = () => ({
  state: { bots: [{ id: "b-helper", name: "Helper", hidden: false }, { id: "b-chief", name: "Ember", chiefOfStaff: true, hidden: false }], config: {} },
  dispatch: (action: unknown) => { calls.dispatched.push(action); },
});
vi.mock("@/state/store", () => ({ useStore: fakeStore, useStoreOptional: fakeStore }));
vi.mock("./remote-hosts-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./remote-hosts-client")>()),
  createHostInstallCode: async (options: unknown) => {
    calls.issued.push(options);
    return {
      code: "K7QM", enrollUrl: "https://example.org/e/K7QM", org: "Acme", scope: "view-only", expiresAt: null,
      installCommand: "sudo posix", installCommands: { macos: "sudo mac", linux: "sudo linux", windows: "irm win | iex" },
    };
  },
  setRemoteHostBots: async (hostId: string, botIds: string[] | null) => { calls.bots.push([hostId, botIds]); return { bots: botIds }; },
}));
const { AddComputerDialog } = await import("./AddComputerDialog");

let root: Root;
let el: HTMLDivElement;
const onClose = vi.fn();
beforeEach(() => {
  setLocale("en"); calls.issued.length = 0; calls.dispatched.length = 0; calls.bots.length = 0; onClose.mockReset();
  el = document.createElement("div"); document.body.append(el); root = createRoot(el);
});
afterEach(() => { act(() => root.unmount()); el.remove(); });
type Props = Parameters<typeof AddComputerDialog>[0];
const render = async (props: Partial<Props> = {}) => { await act(async () => { root.render(createElement(AddComputerDialog, { onClose, ...props })); }); };
const mount = () => render();
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

  // #2956: a real stepper, the command on one line, Copy inside the block.
  it("shows three steps and never cuts the command in the middle of a word", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { written.push(text); } } });
    await mount();
    const steps = () => [...document.querySelectorAll("[data-add-computer-step]")].map((li) => li.getAttribute("data-step-state"));
    expect(document.querySelector("[data-add-computer-steps]")).not.toBeNull();
    expect(steps()).toEqual(["current", "todo", "todo"]);
    await click('[data-add-computer-os="macos"]');
    await click("[data-add-computer-next]");
    expect(steps()).toEqual(["done", "current", "todo"]);
    await click("[data-add-computer-generate]");
    expect(steps()).toEqual(["done", "done", "current"]);

    const command = document.querySelector<HTMLElement>('code[data-unattended-value="command"]')!;
    expect(command.textContent).toBe("sudo mac");
    expect(command.className).toContain("whitespace-nowrap");
    expect(command.className).toContain("overflow-x-auto");
    expect(command.className).not.toContain("break-all");
    expect(command.className).not.toContain("break-words");
    // the Copy button lives inside the same block as its value
    const block = command.closest("[data-copy-block]")!;
    const copy = block.querySelector<HTMLButtonElement>('[data-unattended-copy="command"]')!;
    expect(copy).not.toBeNull();
    await click('[data-unattended-copy="command"]');
    expect(written).toEqual(["sudo mac"]);
    expect(copy.getAttribute("title")).toBe(t("addComputer.copied"));
    await click('[data-unattended-copy="code"]');
    expect(written).toEqual(["sudo mac", "K7QM"]);
    expect(document.querySelector('code[data-unattended-value="code"]')?.textContent).toBe("K7QM");
    expect(document.querySelector("[data-add-computer-done]")).not.toBeNull();
  });

  // #2957: the bots allowed on the new computer, chosen before the code is made.
  it("waits for the computer, then says Connected and applies the bots chosen", async () => {
    const onIssued = vi.fn();
    await render({ hosts: [], onIssued });
    await click('[data-add-computer-os="linux"]');
    await click("[data-add-computer-next]");
    expect(document.querySelector("[data-add-computer-bots]")?.getAttribute("data-add-computer-bots")).toBe("all");
    expect([...document.querySelectorAll("[data-host-bot]")].map((input) => input.getAttribute("data-host-bot"))).toEqual(["b-helper", "b-chief"]);
    await click('[data-host-bot="b-helper"]');
    expect(document.querySelector("[data-add-computer-bots]")?.getAttribute("data-add-computer-bots")).toBe("b-helper");
    await click("[data-add-computer-generate]");
    expect(onIssued).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-add-computer-state="waiting"]')).not.toBeNull();
    expect(document.querySelector('[data-add-computer-state="connected"]')).toBeNull();
    expect(document.body.textContent).toContain("1 bot");

    const fresh: UnattendedHostRow = {
      hostId: `h_${"ab".repeat(16)}`, hostname: "MBP-JULIE", org: "Acme", scope: "view-only", installedBy: null,
      enrolledAt: "2026-11-08T18:00:00.000Z", expiresAt: "2027-11-08T18:00:00.000Z", lastSeenAt: null, revokedAt: null, state: "enrolled", os: "linux",
    };
    await render({ hosts: [fresh], onIssued });
    expect(document.querySelector('[data-add-computer-state="connected"]')).not.toBeNull();
    expect(document.querySelector("[data-add-computer-connected]")).not.toBeNull();
    expect(document.body.textContent).toContain("MBP-JULIE");
    expect(calls.bots).toEqual([[fresh.hostId, ["b-helper"]]]);
  });
});
