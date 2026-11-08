// @vitest-environment happy-dom
// The bot zip in the app: the bot's "..." menu "Export the bot (.zip)" downloads
// with the chosen parts, New bot's "Import from zip" opens the import, and
// the import shows the server's preview before anything is created.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn(), dispatch: vi.fn(), state: {} as Record<string, unknown> }));
vi.mock("@/state/store", async (importOriginal) => {
  const store = await importOriginal<typeof import("@/state/store")>();
  return { ...store, api: fixture.api, useStore: () => ({ state: { ...store.initialState, ...fixture.state }, dispatch: fixture.dispatch }) };
});
vi.mock("@/lib/perspicax-org", () => ({ useOrgPeople: () => new Map() }));
vi.mock("./BotProfileAvatarCard", () => ({ BotProfileAvatarCard: () => null }));

import { BotZipImportPanel } from "./BotZipImport";
import { BotActionsMenu } from "./bot-settings/BotActionsMenu";
import { StartingRole, startOptions } from "./NewBotDialog";
import { botZipExportUrl, botZipLineText } from "@/lib/bot-zip";
import type { Bot } from "@/state/store";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  fixture.api.mockReset();
  fixture.dispatch.mockReset();
  fixture.state = {};
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const click = (selector: string) => act(() => { (container.querySelector(selector) as HTMLElement).click(); });

const preview = {
  kind: "zip", name: "Atlas", importName: "Atlas 2", appVersion: "0.4.15", exportedAt: 1_790_000_000_000,
  includes: { conversations: 2 }, hasConversations: true, hasSharing: false,
  created: [{ part: "memory", detail: "3 memory file(s)", key: "botZip.line.memory", params: { count: 3 } }],
  skipped: [{ part: "host", detail: "Not for a member's copy: Computer.", key: "botZip.line.hostSkipped", params: { names: "Computer" } }],
  needsAction: [{ part: "marketplace", detail: "acme needs a token", key: "botZip.line.marketplaceToken", params: { name: "acme", source: "acme/private" } }],
};

describe("import from zip", () => {
  it("uploads the file, shows the preview, then imports with the chosen parts", async () => {
    fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/bots/import/upload") {
        expect(init?.headers).toMatchObject({ "content-type": "application/zip" });
        return { id: "11111111-2222-4333-8444-555555555555", preview };
      }
      if (path === "/api/bots/import/11111111-2222-4333-8444-555555555555") {
        expect(JSON.parse(String(init?.body))).toEqual({ name: "Atlas 2", conversations: true, sharing: false });
        return { botId: "new-bot", name: "Atlas 2", warnings: [], bot: { id: "new-bot", name: "Atlas 2" } };
      }
      return {};
    });
    const onImported = vi.fn();
    act(() => { root.render(createElement(BotZipImportPanel, { onImported })); });
    expect(container.querySelector("[data-bot-zip-pick]")?.textContent).toContain("Choose a .sagaxbot.zip file");
    // nothing staged, nothing created, before a file is chosen
    expect(fixture.api).not.toHaveBeenCalled();
    const input = container.querySelector("[data-bot-zip-file]") as HTMLInputElement;
    const file = new File([new Uint8Array([0x50, 0x4b])], "atlas.sagaxbot.zip", { type: "application/zip" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
    expect(container.querySelector("[data-bot-zip-preview]")?.getAttribute("data-bot-zip-preview")).toBe("zip");
    expect((container.querySelector("[data-bot-zip-name]") as HTMLInputElement).value).toBe("Atlas 2");
    expect(container.querySelector("[data-bot-zip-lines=created]")?.textContent).toContain("3 memory file(s)");
    expect(container.querySelector("[data-bot-zip-lines=needs]")?.textContent).toContain("acme (acme/private) was read with a token");
    expect(container.querySelector("[data-bot-zip-lines=skipped]")?.textContent).toContain("Not for a member's copy: Computer.");
    expect(container.querySelector("[data-bot-zip-sharing]")).toBeNull();
    expect(container.querySelector("[data-bot-zip-conversations]")?.getAttribute("aria-checked")).toBe("false");
    click("[data-bot-zip-conversations]");
    click("[data-bot-zip-confirm]");
    await flush();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "botAdded", bot: { id: "new-bot", name: "Atlas 2" } });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "select", id: "new-bot" });
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ botId: "new-bot" }));
  });

  it("shows the server's refusal and creates nothing", async () => {
    fixture.api.mockRejectedValue(new Error("This file is neither a bot zip nor a Sagax package."));
    act(() => { root.render(createElement(BotZipImportPanel, {})); });
    const input = container.querySelector("[data-bot-zip-file]") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File(["x"], "x.zip")], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
    expect(container.querySelector("[data-bot-zip-error]")?.textContent).toContain("neither a bot zip");
    expect(container.querySelector("[data-bot-zip-preview]")).toBeNull();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("New bot offers Import from zip in Start from, next to Browse templates", async () => {
    fixture.api.mockResolvedValue({ presets: [] });
    const draft = { preset: undefined, patch: vi.fn(), choosePreset: vi.fn(), uploadAvatar: vi.fn() };
    act(() => { root.render(createElement(StartingRole, { draft: draft as never, defaultsMode: false })); });
    await flush();
    // the Start from pill (#596) lists the other ways to start after the roles
    expect(container.querySelector("[data-new-bot-start]")).not.toBeNull();
    const other = startOptions([], false, true).filter(option => option.value.startsWith("action:"));
    expect(other.map(option => option.label)).toEqual(["Template from the catalog…", "Zip file…", "Grok Bot, Claude Code or Hermes…"]);
    expect(new Set(other.map(option => option.group)).size).toBe(1);
    expect(draft.patch).not.toHaveBeenCalled();
    // the installation's defaults are not a bot: no import there
    expect(startOptions([], true, true).some(option => option.value === "action:import-zip")).toBe(false);
    // without the right to import, the option is not drawn
    expect(startOptions([], false, false).some(option => option.value === "action:import-zip")).toBe(false);
    // the agent import (the reference app, Claude Code) follows the same right
    expect(startOptions([], true, true).some(option => option.value === "action:import-agent")).toBe(false);
    expect(startOptions([], false, false).some(option => option.value === "action:import-agent")).toBe(false);
  });
});

describe("export as zip", () => {
  it("the bot's \"...\" menu downloads the zip with the parts chosen", () => {
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.getAttribute("href") ?? ""); });
    const bot = { id: "atlas", name: "Atlas", title: "", description: "", color: "purple", messages: [], modelSelection: { instanceId: "fixture", model: "m" }, grants: [{ target: "user:x", level: "use" }] } as unknown as Bot;
    act(() => { root.render(createElement(BotActionsMenu, { bot, anchor: { x: 0, y: 0 }, onAnchor: vi.fn(), onRename: vi.fn() })); });
    const inBody = (selector: string) => act(() => { (document.querySelector(selector) as HTMLElement).click(); });
    inBody("[data-menu-item=export-zip]");
    expect(document.querySelector("[data-bot-zip-export]")?.textContent).toContain("Secrets and tokens never leave");
    inBody("[data-bot-zip-conversations]");
    inBody("[data-bot-zip-sharing]");
    inBody("[data-bot-zip-download]");
    expect(clicked).toEqual(["/api/bots/atlas/export.zip?conversations=1&sharing=1"]);
    expect(document.querySelector("[data-bot-zip-export] [role=status]")?.textContent).toBe("The download has started.");
  });

  it("names the parts in the URL and translates the preview lines", () => {
    expect(botZipExportUrl("a b", { conversations: false, sharing: false })).toBe("/api/bots/a%20b/export.zip");
    expect(botZipLineText({ part: "memory", detail: "fallback", key: "botZip.line.memory", params: { count: 2 } })).toBe("2 memory file(s)");
    expect(botZipLineText({ part: "x", detail: "fallback", key: "botZip.line.unknown" })).toBe("fallback");
  });
});
