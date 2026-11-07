// @vitest-environment happy-dom
// #2092: the readable tool list. One switch per group (engine tools, each
// MCP server), an expander with the per-tool exceptions, the raw selectors
// behind Advanced, and the same `toolScope` PATCH as before.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";
import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/mcp-servers", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/mcp-servers")>(),
  useMcpServers: () => ({ servers: [{ name: "mail", enabled: true }, { name: "github", enabled: true }], error: false, refresh: async () => [] }),
}));

const { ToolSelectionCard } = await import("./ToolSelectionCard");
const { BotEditorContext } = await import("./BotEditorContext");
const { SettingsSurfaceProvider } = await import("../SettingsPrimitives");

const bot = (over: Partial<Bot> = {}) => ({ id: "bot-1", name: "Scout", mcpServers: null, ...over }) as unknown as Bot;

let host: HTMLDivElement;
let root: Root;
const flush = async () => { for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); }); };
async function render(current: Bot) {
  await act(async () => {
    root.render(createElement(BotEditorContext.Provider, { value: { request: fixture.api as never } },
      createElement(ToolSelectionCard, { bot: current, engineKind: "grokAgent" })));
  });
  await flush();
}
const $ = (selector: string) => host.querySelector<HTMLElement>(selector);
const click = async (selector: string) => {
  const target = $(selector);
  expect(target, selector).not.toBeNull();
  await act(async () => { target!.click(); });
  await flush();
};
const deny = () => (host.querySelector('textarea[aria-label="Exclude (one per line)"]') as HTMLTextAreaElement).value;
const allow = () => (host.querySelector('textarea[aria-label="Allow (one per line)"]') as HTMLTextAreaElement).value;
const saved = () => fixture.api.mock.calls.map((call) => JSON.parse((call[1] as { body: string }).body));

beforeEach(() => {
  setLocale("en");
  fixture.api = vi.fn(async () => ({}));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("ToolSelectionCard groups (#2092)", () => {
  it("lists the engine tools and each mounted server with human names", async () => {
    await render(bot({ toolScope: { deny: ["mcp:mail:send"] } } as Partial<Bot>));
    expect([...host.querySelectorAll("[data-tool-group]")].map((row) => row.getAttribute("data-tool-group"))).toEqual(["native", "mcp:mail", "mcp:github"]);
    expect($('[data-tool-group="mcp:github"]')?.textContent).toContain("GitHub");
    expect($('[data-tool-group="mcp:mail"]')?.textContent).toContain("Exceptions: 1");
    await click('[data-tool-group="mcp:mail"] button[aria-expanded]');
    expect($('[data-tool-row="mcp:mail:send"]')?.textContent).toContain("Send");
    expect($('[data-tool-row="mcp:mail:send"]')?.textContent).toContain("Blocked");
  });

  it("turns a whole server off and saves the same toolScope shape", async () => {
    await render(bot());
    await click('[data-tool-group="mcp:mail"] [role="switch"]');
    expect(deny()).toBe("mcp:mail:*");
    await click('[data-tool-group="mcp:mail"] [role="switch"]');
    // back to every tool: nothing custom left to save
    expect(deny()).toBe("");
    await click('[data-tool-group="mcp:github"] [role="switch"]');
    const save = [...host.querySelectorAll("button")].find((button) => button.textContent === "Save tool selection");
    await act(async () => { save!.click(); });
    await flush();
    expect(saved()).toEqual([{ toolScope: { deny: ["mcp:github:*"] } }]);
  });

  it("keeps an allow-list model when one is saved", async () => {
    await render(bot({ toolScope: { allow: ["native:*"] } } as Partial<Bot>));
    await click('[data-tool-group="mcp:mail"] [role="switch"]');
    expect(allow().split("\n")).toEqual(["native:*", "mcp:mail:*"]);
    await click('[data-tool-group="native"] [role="switch"]');
    expect(allow()).toBe("mcp:mail:*");
  });
});

// The bot's profile page (#2313): the tool selection card carries its own
// grey label; the groups, the exceptions, Advanced and Save are all there,
// drawn with filled fields and plain pills, never a border, an underline or
// a primary pill.
describe("ToolSelectionCard on the profile page (plain surface)", () => {
  const BORDER = /\bborder(-\[|-border|-hairline|-accent)/;
  const expectReferenceLook = () => {
    for (const popover of host.querySelectorAll(".popover-surface")) popover.remove();
    for (const element of host.querySelectorAll("*")) {
      const classes = element.getAttribute("class") ?? "";
      expect(classes, element.outerHTML.slice(0, 160)).not.toMatch(BORDER);
      expect(classes).not.toContain("underline");
      expect(classes).not.toContain("ui-button-primary");
    }
  };

  it("keeps every group, exception and action in the reference look", async () => {
    await act(async () => {
      root.render(createElement(SettingsSurfaceProvider, { surface: "plain", children:
        createElement(BotEditorContext.Provider, { value: { request: fixture.api as never } },
          createElement(ToolSelectionCard, { bot: bot({ toolScope: { deny: ["mcp:mail:send"] } } as Partial<Bot>), engineKind: "grokAgent" })) }));
    });
    await flush();
    expect(host.textContent).toContain("Tool selection");
    expect([...host.querySelectorAll("[data-tool-group]")].map((row) => row.getAttribute("data-tool-group"))).toEqual(["native", "mcp:mail", "mcp:github"]);
    await click('[data-tool-group="mcp:mail"] button[aria-expanded]');
    expect($('[data-tool-row="mcp:mail:send"]')?.textContent).toContain("Blocked");
    expect(host.textContent).toContain("Advanced");
    // Save appears once there is a change, as a plain pill.
    await click('[data-tool-group="mcp:github"] [role="switch"]');
    const save = [...host.querySelectorAll("button")].find((button) => button.textContent === "Save tool selection");
    expect(save?.className).toContain("ui-button");
    expectReferenceLook();
  });
});
