// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";

vi.mock("@/lib/app-links", () => ({ openExternalLink: vi.fn(() => Promise.resolve()) }));
const { AccountConnectorPage } = await import("./AccountConnectorPage");
const { AccountMark } = await import("./HarnessConnectorGroups");
const { openExternalLink } = await import("@/lib/app-links");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = { key: "codex:Sites", engine: "codex" as const, provider: "ChatGPT", name: "Sites", status: "connected" as const, manageUrl: "https://chatgpt.example.test/apps", category: "other" as const, capabilities: [] as never[] };

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { setLocale("en"); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async (node: unknown) => { await act(async () => { root.render(node as never); }); return host; };

describe("a connector an engine account brought", () => {
  it("has a page that says what the account says and offers Manage on the provider, never an empty page", async () => {
    const view = await render(createElement(AccountConnectorPage, { row, onBack: vi.fn(), trail: [{ label: "Connectors", onSelect: vi.fn() }] }));
    expect(view.querySelector("[data-plugins-detail-name]")?.textContent).toBe("Sites");
    expect(view.querySelector("[data-plugins-detail-meta]")?.textContent).toContain("ChatGPT");
    expect(view.querySelector("[data-account-facts]")?.textContent).toContain("ChatGPT");
    expect(view.querySelector("[data-account-facts]")?.textContent).toContain("Connected");
    const manage = view.querySelector<HTMLButtonElement>("[data-account-manage]")!;
    expect(manage.textContent).toContain("Manage on ChatGPT");
    await act(async () => { manage.click(); });
    expect(openExternalLink).toHaveBeenCalledWith("https://chatgpt.example.test/apps");
    expect(view.querySelector("[data-plugins-back-label]")?.textContent).toBe("Connectors");
  });
  it("shows the provider's own logo small at the corner of a generic plug, and the connector's own mark when the data has one", async () => {
    const generic = await render(createElement(AccountMark, { row: { engine: "codex", name: "Unknown Thing" }, className: "size-12" }));
    expect(generic.querySelector("[data-account-provider-mark='codex']")).not.toBeNull();
    const known = await render(createElement(AccountMark, { row: { engine: "codex", name: "Gmail" }, className: "size-12" }));
    expect(known.querySelector("[data-account-provider-mark]")).toBeNull();
  });
});
