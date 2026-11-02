// @vitest-environment happy-dom
// Details tab: temporary attended sessions above Routines, only while active.
// Unattended host sessions (hostname match on an attached host) stay out.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RemoteSessionView } from "../../../shared/remote-session";
import type { UnattendedHostRow } from "../../../shared/remote-unattended-host";
import { setLocale } from "@/lib/i18n";
import { StoreProvider, type Bot } from "@/state/store";

const HOST = `h_${"ab".repeat(16)}`;

const enrolled: UnattendedHostRow = {
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
};

const session = (over: Partial<RemoteSessionView> = {}): RemoteSessionView => ({
  id: "8f2a0c1d2e3f",
  code: "TP2T2G",
  state: "connected",
  os: "windows",
  elevated: false,
  endAt: "2026-10-22T15:02:00.000Z",
  hostname: "Laptop-Guest",
  suggestions: [],
  ...over,
});

const fetchBotRemoteHosts = vi.fn();
const sessionState: { rows: RemoteSessionView[] } = { rows: [] };

vi.mock("./bot-remote-hosts-client", () => ({
  fetchBotRemoteHosts: (...args: unknown[]) => fetchBotRemoteHosts(...args),
}));

vi.mock("./use-remote-sessions", () => ({
  useRemoteSessions: () => ({ rows: sessionState.rows, reload: vi.fn() }),
}));

vi.mock("./RemoteScreenCard", () => ({
  remoteControllable: () => false,
  RemoteTakeover: () => null,
  STOP_CONFIRM_MS: 1000,
}));

vi.mock("./RemoteSessionActions", () => ({
  RemoteSessionActions: () => createElement("div", { "data-remote-actions-stub": "" }),
}));

vi.mock("./RemoteSessionThumb", () => ({
  RemoteSessionThumb: () => createElement("div", { "data-remote-thumb-stub": "" }),
}));

import { RemoteSessionsSection } from "./RemoteSessionsSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  sessionState.rows = [];
  fetchBotRemoteHosts.mockReset();
  fetchBotRemoteHosts.mockResolvedValue({
    available: true,
    hosts: [enrolled],
    catalog: [enrolled],
    attached: [HOST],
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setLocale("en");
});

async function mount() {
  await act(async () => {
    root.render(createElement(StoreProvider, null, createElement(RemoteSessionsSection, {
      bot: { id: "melonie" } as Bot,
    })));
  });
  await act(async () => { await Promise.resolve(); });
}

describe("Details: temporary remote sessions", () => {
  it("renders nothing when no temporary session is active", async () => {
    sessionState.rows = [];
    await mount();
    expect(host.querySelector("[data-remote-sessions]")).toBeNull();
  });

  it("shows a temporary attended session and hides one that belongs to an attached host", async () => {
    sessionState.rows = [
      session({ id: "guest", hostname: "Laptop-Guest" }),
      session({ id: "host", hostname: "PC-A" }),
    ];
    await mount();
    const section = host.querySelector("[data-remote-sessions]");
    expect(section).toBeTruthy();
    const titles = Array.from(host.querySelectorAll("[data-remote-row-title]")).map((node) => node.textContent);
    expect(titles).toEqual(["Laptop-Guest"]);
    expect(host.textContent).not.toContain(HOST);
  });
});
