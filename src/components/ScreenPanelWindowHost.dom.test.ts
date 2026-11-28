// @vitest-environment happy-dom
// The window Detach / Expand opens from the screen panel is the one of the
// place on screen (M-20261127-180): the browser's, the VM's (the server
// environment's desktop) or the remote computer's, never the browser's for all.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const opened = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/screen-panel-window", () => ({ closeScreenPanelWindow: vi.fn(), useScreenPanelWindow: () => opened.current }));
vi.mock("@/state/store-selector", () => ({
  useStoreSelector: (pick: (state: unknown) => unknown) => pick({ bots: [{ id: "ada", name: "Ada" }] }),
}));
vi.mock("./BrowserPanel", () => ({ BrowserWindow: () => createElement("div", { "data-window": "browser" }) }));
vi.mock("./computer/SandboxDesktopModal", () => ({ SandboxDesktopModal: ({ title }: { title: string }) => createElement("div", { "data-window": "vm" }, title) }));
vi.mock("./remote-session/RemoteScreenCard", () => ({ RemoteTakeover: ({ view }: { view: { id: string } }) => createElement("div", { "data-window": "remote" }, view.id) }));
import { ScreenPanelWindowHost } from "./ScreenPanelWindowHost";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); opened.current = null; });

const shown = (window: unknown) => {
  opened.current = window;
  act(() => root.render(createElement(ScreenPanelWindowHost)));
  return host.querySelector("[data-window]");
};

describe("ScreenPanelWindowHost", () => {
  it("opens the window of the place the panel showed", () => {
    expect(shown({ botId: "ada", mode: "expand", kind: "browser" })?.getAttribute("data-window")).toBe("browser");
    const vm = shown({ botId: "ada", mode: "detach", kind: "vm" });
    expect(vm?.getAttribute("data-window")).toBe("vm");
    expect(vm?.textContent).toBe("Ada’s VM");
    const remote = shown({ botId: "ada", mode: "expand", kind: "remote", remote: { id: "r2" } });
    expect(remote?.getAttribute("data-window")).toBe("remote");
    expect(remote?.textContent).toBe("r2");
  });

  it("opens nothing for a bot that is gone or with no window open", () => {
    expect(shown(null)).toBeNull();
    expect(shown({ botId: "gone", mode: "expand", kind: "browser" })).toBeNull();
  });
});
