// @vitest-environment happy-dom
// Enrolled unattended hosts as Computer places (2026-11-01): beside Cloud,
// the person's Mac and Browser; attach/detach live in the place menu.
// Temporary sessions never linger as the live screen.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopBridgeStatus } from "@/lib/desktop-bridge";
import type { UnattendedHostRow } from "../../../shared/remote-unattended-host";
import type { RemoteSessionView } from "../../../shared/remote-session";
import { hostPlaceKey } from "../../../shared/remote-bot-hosts";
import { OrgComputerTab } from "./OrgComputerTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../remote-session/RemoteScreenCard", () => ({
  RemoteScreenCard: ({ view }: { view: { id: string; hostname?: string } }) =>
    createElement("div", { "data-remote-screen-stub": "", "data-session-id": view.id }, view.hostname ?? ""),
}));

const HOST = `h_${"ab".repeat(16)}`;
const OTHER = `h_${"cd".repeat(16)}`;
const bridge: DesktopBridgeStatus = {
  connected: true, tunnel: false, activity: [], workplace: { place: "computer", routines: false, network: "all" },
  desktops: [{ id: "d1", name: "Mac de Owner", platform: "darwin", online: true, busy: false, lastSeenAt: 1, capabilities: { localVm: true }, system: { os: "macOS", arch: "arm64", cpus: 8, cpuModel: "M3", cpuPercent: 1, memoryGb: 16, memoryUsedGb: 8, diskGb: 500, diskFreeGb: 200 } }],
};

const enrolled = (over: Partial<UnattendedHostRow> = {}): UnattendedHostRow => ({
  hostId: HOST,
  hostname: "PC-A",
  org: null,
  scope: "full-control",
  installedBy: null,
  enrolledAt: "2026-10-01T00:00:00.000Z",
  expiresAt: "2026-12-30T00:00:00.000Z",
  lastSeenAt: null,
  revokedAt: null,
  state: "enrolled",
  ...over,
});

const session = (over: Partial<RemoteSessionView> = {}): RemoteSessionView => ({
  id: "sess1",
  code: "K7QMNP",
  state: "connected",
  os: "windows",
  elevated: false,
  endAt: "2026-11-01T20:00:00.000Z",
  hostname: "PC-A",
  suggestions: [],
  ...over,
});

let host: HTMLDivElement;
let root: Root;
let onPickRemoteHost: ReturnType<typeof vi.fn<(hostId: string) => void>>;
let onAttachRemoteHost: ReturnType<typeof vi.fn<(hostId: string) => Promise<boolean>>>;
let onDetachRemoteHost: ReturnType<typeof vi.fn<(hostId: string) => Promise<boolean>>>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  onPickRemoteHost = vi.fn<(hostId: string) => void>();
  onAttachRemoteHost = vi.fn(async () => true);
  onDetachRemoteHost = vi.fn(async () => true);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(opts: {
  remoteHosts?: UnattendedHostRow[];
  remoteCatalog?: UnattendedHostRow[];
  remoteSessions?: RemoteSessionView[];
  browser?: boolean;
} = {}) {
  act(() => root.render(createElement(ConfirmProvider, null, createElement(OrgComputerTab, {
    bridge,
    place: "auto",
    computerOff: false,
    botName: "Luna",
    botId: "wren",
    threadId: "t1",
    remoteHosts: opts.remoteHosts ?? [enrolled()],
    remoteCatalog: opts.remoteCatalog ?? [enrolled(), enrolled({ hostId: OTHER, hostname: "PC-B" })],
    remoteSessions: opts.remoteSessions ?? [],
    onPickRemoteHost,
    onAttachRemoteHost,
    onDetachRemoteHost,
    browser: opts.browser ? createElement("div", { "data-browser-stub": "" }) : null,
  }))));
}

const pickerButton = () => host.querySelector<HTMLButtonElement>("[data-computer-picker-button]")!;
const options = () => Array.from(host.querySelectorAll<HTMLElement>('[role="option"]'));
const shown = () => host.querySelector("[data-org-computer]")?.getAttribute("data-org-computer");

describe("Computer tab: enrolled host as a place", () => {
  it("lists attached and attachable enrolled hosts in the place dropdown", () => {
    mount({ browser: true });
    expect(pickerButton()).toBeTruthy();
    act(() => pickerButton().click());
    expect(options().map((option) => option.dataset.computerChoice)).toEqual([
      "server",
      "desktop:d1",
      hostPlaceKey(HOST),
      hostPlaceKey(OTHER),
      "browser",
    ]);
    const attached = options().find((option) => option.dataset.computerChoice === hostPlaceKey(HOST))!;
    expect(attached.textContent).toContain("PC-A");
    expect(attached.getAttribute("data-host-attached")).toBe("1");
    const addable = options().find((option) => option.dataset.computerChoice === hostPlaceKey(OTHER))!;
    expect(addable.textContent).toContain("PC-B");
    expect(addable.getAttribute("data-host-attached")).toBe("0");
  });

  it("attaches an unattached host from the place menu", async () => {
    mount({ remoteHosts: [] });
    act(() => pickerButton().click());
    const hostOption = options().find((option) => option.dataset.computerChoice === hostPlaceKey(HOST))!;
    act(() => hostOption.querySelector<HTMLButtonElement>("[data-computer-place-menu]")!.click());
    const attach = host.querySelector<HTMLButtonElement>("[data-computer-host-attach]")!;
    expect(attach).toBeTruthy();
    await act(async () => { attach.click(); await Promise.resolve(); });
    expect(onAttachRemoteHost).toHaveBeenCalledWith(HOST);
  });

  it("selecting an attached host calls open and shows the pending place until a connected session exists", () => {
    mount();
    act(() => pickerButton().click());
    const hostOption = options().find((option) => option.dataset.computerChoice === hostPlaceKey(HOST))!;
    act(() => hostOption.click());
    expect(onPickRemoteHost).toHaveBeenCalledWith(HOST);
    expect(shown()).toBe("remote-host");
    expect(host.querySelector("[data-remote-host-pending]")).toBeTruthy();
    expect(host.querySelector("[data-remote-host-screen]")).toBeNull();
  });

  it("selecting an unattached host attaches it", async () => {
    mount({ remoteHosts: [] });
    act(() => pickerButton().click());
    const hostOption = options().find((option) => option.dataset.computerChoice === hostPlaceKey(OTHER))!;
    await act(async () => { hostOption.click(); await Promise.resolve(); });
    expect(onAttachRemoteHost).toHaveBeenCalledWith(OTHER);
    expect(onPickRemoteHost).not.toHaveBeenCalled();
  });

  it("shows the live screen only for a connected session matching the host; ended ones never linger", () => {
    mount({
      remoteSessions: [
        session({ id: "ended", state: "ended", hostname: "PC-A" }),
        session({ id: "live", state: "connected", hostname: "PC-A" }),
      ],
    });
    act(() => pickerButton().click());
    act(() => options().find((option) => option.dataset.computerChoice === hostPlaceKey(HOST))!.click());
    expect(shown()).toBe("remote-host");
    const screen = host.querySelector("[data-remote-screen-stub]");
    expect(screen).toBeTruthy();
    expect(screen?.getAttribute("data-session-id")).toBe("live");
  });

  it("ignores an ended-only session: the host place stays pending, never active", () => {
    mount({ remoteSessions: [session({ id: "old", state: "ended", hostname: "PC-A" })] });
    act(() => pickerButton().click());
    act(() => options().find((option) => option.dataset.computerChoice === hostPlaceKey(HOST))!.click());
    expect(host.querySelector("[data-remote-host-pending]")).toBeTruthy();
    expect(host.querySelector("[data-remote-screen-stub]")).toBeNull();
  });
});
