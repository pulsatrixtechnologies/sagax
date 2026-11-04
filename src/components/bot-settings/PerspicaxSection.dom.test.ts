// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { PerspicaxSection, type PerspicaxAnswer } from "./PerspicaxSection";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", async (original) => ({ ...await original<typeof import("@/state/store")>(), api: (...args: unknown[]) => fixture.api(...args) }));

let host: HTMLDivElement;
let root: Root;
const answer = (): PerspicaxAnswer => ({ selected: [], available: [], canEdit: true, actsAs: null, identities: { supported: true, profiles: [{ slug: "private-bot-slug", name: "Bot attribution", explicit_only: true }] } });

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await setLocale("en");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  fixture.api.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("starts with no identity, shows human names and saves only the explicitly chosen slug", async () => {
  let stored = answer();
  fixture.api.mockImplementation(async (_path: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      stored = { ...stored, actsAs: body.actsAs ? { slug: body.actsAs, name: "Bot attribution" } : null };
    }
    return stored;
  });
  await act(async () => root.render(createElement(PerspicaxSection, { bot: { id: "test-bot" } })));
  const select = host.querySelector("select")!;
  expect(select.value).toBe("");
  expect(select.textContent).toContain("Bot attribution");
  expect(host.textContent).not.toContain("private-bot-slug");
  await act(async () => { select.value = "private-bot-slug"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => { Array.from(host.querySelectorAll("button")).at(-1)!.click(); });
  expect(fixture.api.mock.calls.at(-1)).toEqual(["/api/bots/test-bot/perspicax", { method: "PUT", body: JSON.stringify({ profiles: [], actsAs: "private-bot-slug" }) }]);
  await act(async () => { select.value = ""; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => { Array.from(host.querySelectorAll("button")).at(-1)!.click(); });
  expect(stored.actsAs).toBeNull();
});

it("silently omits the choice for older Perspicax servers", async () => {
  fixture.api.mockResolvedValue({ ...answer(), identities: { supported: false, profiles: [] } });
  await act(async () => root.render(createElement(PerspicaxSection, { bot: { id: "old-server" } })));
  expect(host.querySelector("select")).toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
