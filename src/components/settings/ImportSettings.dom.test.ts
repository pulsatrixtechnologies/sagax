// @vitest-environment happy-dom
// Settings > Import (port of OpenMausBot #3073): a shared Grok Bot's export
// file (shared/fixtures/grok-import/) becomes the usual team preview, the
// event routine is listed under Left out, and Add sends a package to the
// teams import route. A link is read through the server's x.ai-only route.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn(), dispatch: vi.fn() }));
vi.mock("@/state/store", () => ({
  api: fixture.api,
  useStore: () => ({ state: { bots: [], sections: [] }, dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/analytics", () => ({ track: () => {} }));

import { ImportSettings } from "./ImportSettings";

const EXPORT = readFileSync(join(import.meta.dirname, "..", "..", "..", "shared", "fixtures", "grok-import", "shared-grok-bot.json"), "utf8");

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  fixture.api.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

describe("Settings > Import a Grok Bot", () => {
  it("turns a shared Grok Bot's file into the team preview, lists what was left out, and adds it", async () => {
    fixture.api.mockResolvedValue({ bots: [{ id: "b1", name: "Inbox Triage" }], routines: [] });
    act(() => root.render(createElement(ImportSettings)));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([EXPORT], "inbox-triage.json", { type: "application/json" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
    await flush();
    const preview = container.querySelector("[data-grok-import-preview]");
    expect(preview?.textContent).toContain("Inbox Triage");
    const leftOut = container.querySelector("[data-grok-left-out]");
    expect(leftOut?.textContent).toContain("On new email");
    expect(leftOut?.textContent).toContain("it starts on an event");
    await act(async () => { (container.querySelector("[data-template-add]") as HTMLButtonElement).click(); });
    await flush();
    const [path, init] = fixture.api.mock.calls.at(-1)!;
    expect(path).toBe("/api/teams/import?mode=add");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.format).toBe("openmaus.package");
    expect(body.package.agents[0]).toMatchObject({ name: "Inbox Triage", soul: expect.stringContaining("Never send anything") });
    expect(body.package.routines).toEqual([expect.objectContaining({ name: "Morning triage", enabledAfterInstall: false, schedule: { type: "cron", expression: "30 8 * * 1-5", timeZone: "America/Toronto" } })]);
    expect(body.package.requirements.apps.map((app: { slug: string }) => app.slug)).toEqual(["gmail", "googlecalendar"]);
    expect(body.package.author.url).toBe("https://x.ai/bot/d8OshqLZvtcKDcNluPuyo");
    expect(container.textContent).toContain("Inbox Triage was added.");
  });

  it("reads a link through the server and offers to start from the description", async () => {
    fixture.api.mockResolvedValue({ shareId: "d8OshqLZvtcKDcNluPuyo", name: "DOGE", creator: "Avid", description: "Audits bots.", url: "https://x.ai/bot/d8OshqLZvtcKDcNluPuyo" });
    act(() => root.render(createElement(ImportSettings)));
    const link = container.querySelector("#grok-import-link") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(link, "https://x.ai/bot/d8OshqLZvtcKDcNluPuyo");
      link.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { (link.form as HTMLFormElement).requestSubmit(); });
    await flush();
    expect(fixture.api).toHaveBeenCalledWith("/api/team-library/grok", expect.objectContaining({ method: "POST" }));
    expect(container.querySelector("[data-grok-card]")?.textContent).toContain("by Avid");
    await act(async () => { (container.querySelector("[data-grok-card] button") as HTMLButtonElement).click(); });
    await flush();
    expect(container.querySelector("[data-grok-import-preview]")?.textContent).toContain("DOGE");
  });

  it("refuses a link that is not Grok Bot's without calling the server", async () => {
    act(() => root.render(createElement(ImportSettings)));
    const link = container.querySelector("#grok-import-link") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(link, "https://evil.example/bot/x");
      link.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { (link.form as HTMLFormElement).requestSubmit(); });
    expect(fixture.api).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Paste a Grok Bot link");
  });
});
