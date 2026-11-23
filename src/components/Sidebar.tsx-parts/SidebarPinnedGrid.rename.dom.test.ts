// @vitest-environment happy-dom
// Rename the bot on the Primary Bot's large tile (#4847): the same menu
// action that opens a field on a row opens one on the tile.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

import { SidebarPinnedGrid } from "./SidebarPinnedGrid";
import type { SidebarState } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const primary = {
  id: "nova",
  name: "Nova",
  title: "Desk",
  chiefOfStaff: true,
  threadId: "t-nova",
  description: "",
  color: "green",
  notifications: true,
  unread: false,
  modelSelection: { instanceId: "test", model: "m" },
  messages: [],
} as Bot;

const state = { activeView: "chat", selectedId: "", groups: [], bots: [], config: null, instances: [], pendingQueued: {}, sections: [] } as unknown as SidebarState;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
});

async function draw(renameBotId: string | null, dispatch = vi.fn()) {
  await act(async () => {
    root.render(createElement(SidebarPinnedGrid, {
      pinnedBots: [primary],
      density: "comfortable",
      state,
      viewerId: "local-owner",
      showThreads: false,
      dispatch,
      setMenu: () => {},
      renameBotId,
      onRenameStarted: () => {},
    }));
  });
  return dispatch;
}

describe("rename on the Primary Bot tile", () => {
  it("opens a name field when Rename the bot is chosen on the large tile", async () => {
    await draw("nova");
    const input = host.querySelector("input");
    expect(input).not.toBeNull();
    expect(input!.value).toBe("Nova");
    expect(host.querySelector("[data-testid='primary-bot-badge']")).not.toBeNull();
  });

  it("keeps the name as text until rename is asked", async () => {
    await draw(null);
    expect(host.querySelector("input")).toBeNull();
    expect(host.textContent).toContain("Nova");
  });

  it("saves the new name from the tile field", async () => {
    const dispatch = await draw("nova");
    const input = host.querySelector("input")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, "Nimbus");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "updateBot", botId: "nova", patch: { name: "Nimbus" } });
  });
});
