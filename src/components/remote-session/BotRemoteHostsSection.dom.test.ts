// @vitest-environment happy-dom
// Computer tab endpoints: add / list / revoke enrolled hosts on a bot
// (2026-11-01). Temporary sessions are out of scope here.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UnattendedHostRow } from "../../../shared/remote-unattended-host";
import { setLocale, t } from "@/lib/i18n";

const HOST = `h_${"ab".repeat(16)}`;
const OTHER = `h_${"cd".repeat(16)}`;

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

const fetchBotRemoteHosts = vi.fn();
const attachBotRemoteHost = vi.fn();
const detachBotRemoteHost = vi.fn();
const openBotRemoteHost = vi.fn();
const revokeUnattendedHost = vi.fn();

vi.mock("./bot-remote-hosts-client", () => ({
  fetchBotRemoteHosts: (...args: unknown[]) => fetchBotRemoteHosts(...args),
  attachBotRemoteHost: (...args: unknown[]) => attachBotRemoteHost(...args),
  detachBotRemoteHost: (...args: unknown[]) => detachBotRemoteHost(...args),
  openBotRemoteHost: (...args: unknown[]) => openBotRemoteHost(...args),
}));

vi.mock("./use-remote-sessions-admin", () => ({
  revokeUnattendedHost: (...args: unknown[]) => revokeUnattendedHost(...args),
}));

import { BotRemoteHostsSection } from "./BotRemoteHostsSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let onChanged: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  onChanged = vi.fn<() => void>();
  fetchBotRemoteHosts.mockReset();
  attachBotRemoteHost.mockReset();
  detachBotRemoteHost.mockReset();
  openBotRemoteHost.mockReset();
  revokeUnattendedHost.mockReset();
  fetchBotRemoteHosts.mockResolvedValue({
    available: true,
    hosts: [],
    catalog: [enrolled(), enrolled({ hostId: OTHER, hostname: "PC-B" })],
    attached: [],
  });
  attachBotRemoteHost.mockResolvedValue({ ok: true, remoteHosts: [HOST] });
  detachBotRemoteHost.mockResolvedValue({ ok: true, remoteHosts: [] });
  openBotRemoteHost.mockResolvedValue({ ok: true, code: "K7QMNP" });
  revokeUnattendedHost.mockResolvedValue({ ok: true });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setLocale("en");
});

async function mount() {
  await act(async () => {
    root.render(createElement(BotRemoteHostsSection, { botId: "melonie", onChanged }));
  });
  // flush the fetch effect
  await act(async () => { await Promise.resolve(); });
}

describe("BotRemoteHostsSection", () => {
  it("lets the person add an enrolled host as an endpoint on the bot", async () => {
    await mount();
    expect(host.querySelector("[data-bot-remote-hosts]")).toBeTruthy();
    act(() => host.querySelector<HTMLButtonElement>("[data-bot-remote-hosts-toggle]")!.click());
    expect(host.textContent).toContain(t("botRemoteHosts.empty"));
    const add = host.querySelectorAll<HTMLButtonElement>("[data-bot-remote-host-attach]");
    expect(add).toHaveLength(2);
    expect(add[0]!.textContent).toContain("PC-A");

    fetchBotRemoteHosts.mockResolvedValueOnce({
      available: true,
      hosts: [enrolled()],
      catalog: [enrolled(), enrolled({ hostId: OTHER, hostname: "PC-B" })],
      attached: [HOST],
    });
    await act(async () => { add[0]!.click(); await Promise.resolve(); });
    expect(attachBotRemoteHost).toHaveBeenCalledWith("melonie", HOST);
    expect(onChanged).toHaveBeenCalled();
    expect(host.querySelector("[data-bot-remote-hosts-list]")).toBeTruthy();
    expect(host.querySelector("[data-bot-remote-host]")?.textContent).toContain("PC-A");
  });

  it("detaches an attached host from the bot", async () => {
    fetchBotRemoteHosts.mockResolvedValue({
      available: true,
      hosts: [enrolled()],
      catalog: [enrolled()],
      attached: [HOST],
    });
    await mount();
    act(() => host.querySelector<HTMLButtonElement>("[data-bot-remote-hosts-toggle]")!.click());
    fetchBotRemoteHosts.mockResolvedValueOnce({
      available: true,
      hosts: [],
      catalog: [enrolled()],
      attached: [],
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-bot-remote-host-detach]")!.click();
      await Promise.resolve();
    });
    expect(detachBotRemoteHost).toHaveBeenCalledWith("melonie", HOST);
    expect(onChanged).toHaveBeenCalled();
  });
});
