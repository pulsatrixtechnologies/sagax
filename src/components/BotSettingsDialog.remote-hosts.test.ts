// Placement of remote computers (2026-11-01 JC):
// - Unattended hosts: Computer place picker only (attach/detach in its menu).
// - Temporary attended sessions: Details above Routines, only while active.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("bot panel: remote hosts placement", () => {
  it("puts temporary sessions in Details above routines and hosts in the Computer picker", () => {
    const details = read("./BotSettingsDialog.tsx");
    expect(details).toMatch(/RemoteSessionsSection/);
    expect(details).toMatch(/remote-session\/RemoteSessions/);
    expect(details).toMatch(/ComputerPanel/);
    const remoteAt = details.indexOf("<RemoteSessionsSection");
    const routinesAt = details.indexOf('data-bot-settings-section="routines"');
    expect(remoteAt).toBeGreaterThan(-1);
    expect(routinesAt).toBeGreaterThan(-1);
    expect(remoteAt).toBeLessThan(routinesAt);

    const computer = read("./ComputerPanel.tsx");
    expect(computer).not.toMatch(/BotRemoteHostsSection/);
    expect(computer).toMatch(/OrgComputerTab/);
    expect(computer).toMatch(/remoteHosts=\{remoteHostRows\}/);
    expect(computer).toMatch(/remoteCatalog=\{catalogHosts\}/);
    expect(computer).toMatch(/onAttachRemoteHost/);
    expect(computer).toMatch(/onDetachRemoteHost/);
    expect(computer).toMatch(/activeRemoteSessions/);

    const hostsHook = read("./ComputerPanel.tsx-parts/useRemoteHosts.ts");
    expect(hostsHook).toMatch(/filter\(\(row\) => row\.state === "connected"\)/);
  });
});
