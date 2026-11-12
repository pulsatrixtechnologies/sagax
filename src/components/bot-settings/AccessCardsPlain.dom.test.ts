// @vitest-environment happy-dom
// The bot's profile page (#2313), Model & tools > Access and General > Shared
// vault under the plain surface: the background brief, the shared vault and
// the tool access cards each carry their own grey label, rows are drawn like
// the page's Channels and Access rows (icon, 14px name over a 12px
// subtitle), fields are filled and actions are plain pills. Nothing is
// bordered, underlined or a primary pill; every label and action stays.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";
import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: (...args: unknown[]) => fixture.api(...args),
}));

const { SettingsSurfaceProvider } = await import("../SettingsPrimitives");
const { BotEditorContext } = await import("./BotEditorContext");
const { BackgroundBriefCard } = await import("./BackgroundBriefCard");
const { TeamBotVaultSection } = await import("./TeamBotVaultSection");
const { BotToolAccess } = await import("./BotToolAccess");

const BORDER = /\bborder(-\[|-border|-hairline|-accent)/;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  setLocale("en");
  fixture.api.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function renderPlain(child: ReactNode) {
  await act(async () => { root.render(createElement(SettingsSurfaceProvider, { surface: "plain", children: child })); });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  // HelpTip popovers keep their own outline (a floating surface, not a card).
  for (const popover of host.querySelectorAll(".popover-surface")) popover.remove();
  return host;
}
function expectReferenceLook(node: HTMLElement) {
  for (const element of node.querySelectorAll("*")) {
    const classes = element.getAttribute("class") ?? "";
    expect(classes, element.outerHTML.slice(0, 160)).not.toMatch(BORDER);
    expect(classes).not.toContain("underline");
    expect(classes).not.toContain("ui-button-primary");
  }
}
const button = (node: HTMLElement, text: string) => [...node.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === text);

describe("Access cards on the profile page (plain surface)", () => {
  it("draws the background brief as one row with its time, switch, queue and Read pill", async () => {
    const request = vi.fn(async () => ({ apps: 2, settings: { enabled: true, at: "07:30" }, suggestions: [{ id: "s1", text: "Reply to the supplier", status: "pending" }] }));
    const node = await renderPlain(createElement(BotEditorContext.Provider, { value: { request: request as never }, children: createElement(BackgroundBriefCard, { botId: "bot-1" }) }));
    expect(node.textContent).toContain("Background brief");
    expect(node.textContent).toContain("Send the brief every day at");
    expect(node.textContent).toContain("It arrives in this conversation");
    expect(node.querySelector<HTMLInputElement>('input[type="time"]')?.value).toBe("07:30");
    expect(node.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
    expect(node.textContent).toContain("Reply to the supplier");
    expect(button(node, "Read connectors and MCP servers")?.className).toContain("ui-button");
    expectReferenceLook(node);
  });

  it("lists the shared vault's logins as reference rows, with Add and Remove pills", async () => {
    fixture.api.mockResolvedValue({ items: [{ id: "v1", kind: "login", name: "Supplier portal", domains: ["portal.example.test"], hasPassword: true, hasTotp: false, hasApiKey: false, hasNotes: false }] });
    const node = await renderPlain(createElement(TeamBotVaultSection, { botId: "bot-1", botName: "Scout" }));
    const card = node.querySelector<HTMLElement>('[data-settings-group="botTeamVault"]')!;
    expect(card.textContent).toContain("Shared vault");
    expect(card.textContent).toContain("Supplier portal");
    expect(card.textContent).toContain("portal.example.test");
    expect(button(card, "Add shared login")?.className).toContain("ui-button");
    expect(card.querySelector('button[aria-label="Remove"]')?.className).toContain("ui-button");
    expect(card.querySelector("li svg")?.getAttribute("class")).toContain("size-5 shrink-0 text-ink-secondary");
    expectReferenceLook(node);
    await act(async () => { button(card, "Add shared login")!.click(); });
    expect(card.querySelectorAll("input").length).toBe(4);
    expect(card.querySelector("input")?.className).toContain("bg-inset");
    expectReferenceLook(node);
  });

  it("lists the bot's tool access with its grant form and Revoke pills", async () => {
    fixture.api.mockResolvedValue({ grants: [{ id: "g1", subject: { kind: "bot", id: "bot-1" }, scope: "agents:write", grantedBy: "owner", grantedAt: 1, state: "active" }], mayGrantAdmin: false, adminOnlyAreas: [] });
    const node = await renderPlain(createElement(BotToolAccess, { bot: { id: "bot-1", name: "Scout" } as unknown as Bot }));
    expect(node.textContent).toContain("Tool access");
    expect(node.textContent).toContain("agents:write");
    expect(button(node, "Revoke")?.className).toContain("ui-button");
    expectReferenceLook(node);
  });
});
