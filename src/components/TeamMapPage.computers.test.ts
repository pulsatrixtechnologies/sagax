// @vitest-environment happy-dom
// The Team map computer button opens the same Add computer modal as Remote
// sessions (AddComputerDialog). The old side panel is gone.
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialState } from "@/state/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = vi.hoisted(() => ({ session: { kind: "session", id: "s", label: "Phone", scopes: ["client"], expiresAt: 1 } as Record<string, unknown> }));
vi.mock("@/lib/session", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/session")>()), readSessionState: async () => fixture.session }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, bots: [] }, dispatch: vi.fn() }), api: vi.fn(async () => ({ collaborations: [], queued: [], running: [] })) };
});
vi.mock("@/lib/perspicax-org", () => ({ usePerspicaxOrg: () => ({ id: "org" }) }));
vi.mock("./remote-session/AddComputerDialog", () => ({ AddComputerDialog: (props: { onClose: () => void }) => createElement("div", { "data-add-computer-dialog": "", role: "dialog" }, createElement("button", { "data-close": "", onClick: props.onClose })) }));
vi.mock("./remote-session/remote-hosts-client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./remote-session/remote-hosts-client")>()), fetchRemoteHosts: async () => ({ available: true, hosts: [] }) }));
vi.mock("./TeamCanvas", () => ({ TeamCanvas: () => null }));

const { TeamMapPage } = await import("./TeamMapPage");

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } })));
});
afterEach(() => { host.remove(); vi.unstubAllGlobals(); });

async function render() {
  const root = createRoot(host);
  await act(async () => { root.render(createElement(TeamMapPage)); });
  await act(async () => { await Promise.resolve(); });
  return root;
}

describe("Team map computer button", () => {
  it("opens the Add computer modal and renders no side panel", async () => {
    const root = await render();
    const button = host.querySelector<HTMLButtonElement>(`button[aria-label="Computers"]`);
    expect(button).not.toBeNull();
    expect(host.querySelector("[data-add-computer-dialog]")).toBeNull();
    await act(async () => { button!.click(); });
    expect(host.querySelector("[data-add-computer-dialog]")).not.toBeNull();
    expect(host.querySelector("[data-computers-panel]")).toBeNull();
    expect(host.querySelector("aside")).toBeNull();
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-close]")!.click(); });
    expect(host.querySelector("[data-add-computer-dialog]")).toBeNull();
    expect(initialState).toBeDefined();
    act(() => root.unmount());
  });

  it("the Add menu Unattended computer entry opens the same modal", async () => {
    const root = await render();
    const entry = host.querySelector<HTMLElement>("[data-team-map-unattended]");
    expect(entry).not.toBeNull();
    await act(async () => { entry!.click(); });
    expect(host.querySelector("[data-add-computer-dialog]")).not.toBeNull();
    act(() => root.unmount());
  });
});
