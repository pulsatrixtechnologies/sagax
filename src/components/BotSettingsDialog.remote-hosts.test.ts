// Placement of remote computers (2026-11-01 the owner):
// - Unattended hosts: Computer place picker only (attach/detach in its menu).
// - Temporary attended sessions: on Activity, below Upcoming (#2125), only while active.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("bot panel: remote hosts placement", () => {
  it("puts temporary sessions on Activity below Upcoming and hosts in the Computer picker", () => {
    const details = read("./BotSettingsDialog.tsx");
    expect(details).toMatch(/RemoteSessionsSection/);
    expect(details).toMatch(/remote-session\/RemoteSessions/);
    // #4208: the old computer side panel is gone; the Computer section
    // (ComputerCard) holds the hosts.
    expect(details).toMatch(/<ComputerCard/);
    const remoteAt = details.indexOf("<RemoteSessionsSection");
    // #2624: the routines left the panel; Suggested now heads Activity.
    const routinesAt = details.indexOf("<SuggestionsSection");
    expect(remoteAt).toBeGreaterThan(-1);
    expect(routinesAt).toBeGreaterThan(-1);
    expect(routinesAt).toBeLessThan(remoteAt);

    // #4208: the hosts a bot can work on are the Computer section's menu
    // (ComputerCard), since the old computer side panel is gone.
    const card = read("./bot-settings/ComputerCard.tsx");
    expect(card).toMatch(/useBotHostComputer/);
    expect(card).toMatch(/<HostChoiceItem/);
  });
});
