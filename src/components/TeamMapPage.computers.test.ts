// @vitest-environment happy-dom
// The Computers panel is the person's own: a member without the admin scope
// sees the button, the Unattended computer entry and the panel. Only the
// Local VM entry (the server's own machine) stays with the admins.
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
vi.mock("./CanvasComputers", () => ({ CanvasComputers: (props: { open: boolean; cloud?: boolean }) => props.open ? createElement("aside", { "data-computers-panel": "", "data-cloud": String(props.cloud) }) : null }));
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

describe("Team map Computers panel for a member", () => {
  it("shows the Computers button, the Unattended computer entry and the panel without admin", async () => {
    const root = await render();
    const button = host.querySelector<HTMLButtonElement>(`button[aria-label="Computers"], button[aria-expanded]`);
    expect(button).not.toBeNull();
    expect(host.querySelector("[data-team-map-unattended]")).not.toBeNull();
    await act(async () => { button!.click(); });
    const panel = host.querySelector("[data-computers-panel]");
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute("data-cloud")).toBe("false");
    expect(initialState).toBeDefined();
    act(() => root.unmount());
  });

  it("an admin also gets the server-wide cloud computers", async () => {
    fixture.session = { kind: "session", id: "s", label: "Mac", scopes: ["admin", "client"], expiresAt: 1 };
    const root = await render();
    await act(async () => { host.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click(); });
    expect(host.querySelector("[data-computers-panel]")!.getAttribute("data-cloud")).toBe("true");
    act(() => root.unmount());
  });
});
