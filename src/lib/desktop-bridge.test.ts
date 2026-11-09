// What the app says about where bots work (src/lib/desktop-bridge.ts) and
// how the transcript names a tool that ran on the person's computer.
import { describe, expect, it } from "vitest";

import { computerChoices, currentDesktop, loadDesktopBridge, myDevices, readWorkplace, sameDesktopBridgeStatus, setComputerAccess, workplaceNotice, writeWorkplace, type DesktopBridgeStatus, type MyDevice } from "./desktop-bridge";
import { toolExecutionTarget } from "../../shared/execution-target";
import { USER_PREFERENCE_KEYS } from "../../shared/user-preferences";
import { BOT_WORKPLACE_PREFERENCE } from "../../shared/bot-workplace";

const status = (connected: boolean): DesktopBridgeStatus => ({ connected, tunnel: connected, desktops: [], workplace: { place: "computer", routines: false, network: "all" }, activity: [] });

describe("where bots work, as the app says it", () => {
  it("speaks only when the bot works on the person's computer, and says when it is not connected", () => {
    expect(workplaceNotice(status(false), "computer")).toBe("fallback");
    expect(workplaceNotice(status(true), "computer")).toBe("computer");
    expect(workplaceNotice(status(true), "server")).toBeNull();
    expect(workplaceNotice(status(false), null)).toBeNull();
    expect(workplaceNotice(null, "computer")).toBeNull();
  });

  it("a solo server has no bridge; a failure is not 'no bridge'", async () => {
    expect(await loadDesktopBridge(async () => new Response("{}", { status: 404 }))).toBeNull();
    // #3043: the probe header's quiet answer on a solo server
    let sent: HeadersInit | undefined;
    expect(await loadDesktopBridge(async (_url, init) => { sent = init?.headers; return new Response(JSON.stringify({ offered: false }), { status: 200 }); })).toBeNull();
    expect(sent).toEqual({ "x-sagax-org-probe": "1" });
    await expect(loadDesktopBridge(async () => new Response("{}", { status: 502 }))).rejects.toThrow();
  });

  it("the preference is one synced key", () => {
    expect(USER_PREFERENCE_KEYS).toContain(BOT_WORKPLACE_PREFERENCE);
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
    expect(readWorkplace(storage)).toEqual({ place: "computer", routines: false, network: "all" });
    writeWorkplace({ place: "server", routines: true, network: "lan" }, storage);
    expect(readWorkplace(storage)).toEqual({ place: "server", routines: true, network: "lan" });
  });

  it("treats an equal bridge payload as the same status", () => {
    const first = status(true);
    const copy = JSON.parse(JSON.stringify(first)) as DesktopBridgeStatus;
    expect(sameDesktopBridgeStatus(first, copy)).toBe(true);
    expect(sameDesktopBridgeStatus(first, status(false))).toBe(false);
    expect(sameDesktopBridgeStatus(null, null)).toBe(true);
    expect(sameDesktopBridgeStatus(first, null)).toBe(false);
  });

  it("names a sagax-desktop tool as the person's computer", () => {
    expect(toolExecutionTarget("mcp__sagax-desktop__run_command")).toBe("user-desktop");
    expect(toolExecutionTarget("sagax-desktop__read_file")).toBe("user-desktop");
    expect(toolExecutionTarget("mcp__sagax-environment__run_command")).toBe("user-sandbox");
  });
});

describe("the person's devices, as the app lists them", () => {
  const desktop = (id: string, name: string, access: "always" | "ask" | "never", lastSeenAt: number) => ({
    id, name, platform: "darwin", connectedAt: 1, lastSeenAt, online: true, busy: false, capabilities: { localVm: true }, access,
  }) as DesktopBridgeStatus["desktops"][number];

  it("Never allow takes a computer out of the Computer menu; Ask every time keeps it", () => {
    const next = { ...status(true), desktops: [desktop("a", "Mac mini", "never", 3), desktop("b", "Work MacBook", "ask", 2)] };
    expect(computerChoices(next).map((choice) => choice.key)).toEqual(["server", "desktop:b"]);
    expect(currentDesktop(next)?.name).toBe("Work MacBook");
  });

  it("reads the server's list, else the desktops of an older server", () => {
    const devices: MyDevice[] = [{ key: "phone-0", name: "iPhone", kind: "phone", platform: "ios", online: false, lastSeenAt: 1, access: null, current: false, desktopId: null }];
    expect(myDevices({ ...status(true), devices })).toBe(devices);
    expect(myDevices({ ...status(true), desktops: [desktop("a", "Mac mini", "ask", 3)] }).map((device) => [device.name, device.kind, device.access])).toEqual([["Mac mini", "computer", "ask"]]);
    expect(myDevices(null)).toEqual([]);
  });

  it("sets the access of one computer, and says why when the server refuses", async () => {
    const calls: Array<[string, string]> = [];
    const ok = (async (url: string, init: RequestInit) => { calls.push([url, String(init.body)]); return new Response("{}"); }) as unknown as typeof fetch;
    await setComputerAccess("Mac mini", "ask", ok);
    expect(calls).toEqual([["/api/me/desktop-bridge/computers/access", JSON.stringify({ computer: "Mac mini", access: "ask" })]]);
    const refused = (async () => new Response(JSON.stringify({ error: "That computer is not in your list", code: "computer_unknown" }), { status: 404 })) as unknown as typeof fetch;
    await expect(setComputerAccess("Nope", "never", refused)).rejects.toMatchObject({ code: "computer_unknown" });
  });
});
