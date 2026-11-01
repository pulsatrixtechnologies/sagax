// Remote sessions live in the Computer tab (2026-11-01), not Details.
// Details must not keep showing temporary/ended sessions via RemoteSessionsSection.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("bot panel: remote hosts placement", () => {
  it("keeps RemoteSessionsSection out of Details and wires hosts in Computer", () => {
    const details = read("./BotSettingsDialog.tsx");
    expect(details).not.toMatch(/RemoteSessionsSection/);
    expect(details).not.toMatch(/remote-session\/RemoteSessions/);
    expect(details).toMatch(/ComputerPanel/);

    const computer = read("./ComputerPanel.tsx");
    expect(computer).toMatch(/BotRemoteHostsSection/);
    expect(computer).toMatch(/OrgComputerTab/);
    expect(computer).toMatch(/remoteHosts=\{remoteHostRows\}/);
    expect(computer).toMatch(/activeRemoteSessions/);
    // Only connected sessions feed the place screen.
    expect(computer).toMatch(/filter\(\(row\) => row\.state === "connected"\)/);
  });
});
