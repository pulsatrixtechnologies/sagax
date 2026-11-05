import { describe, expect, it } from "vitest";

import { botNames, botSourceLink, isLinked, pxFolderLink, teamFolderLink } from "./memory-folders";

const bots = [
  { id: "ember", name: "Ember", color: "orange", section: "" },
  { id: "kat", name: "Osprey", section: "built-in" },
  { id: "old", name: "Old", hidden: true, section: "" },
];
const routines = [{ name: "Morning tidy", botId: "ember" }, { name: "Report", botId: "kat" }];

describe("memory folder links", () => {
  it("links a bot's memory to the bot, with its routines", () => {
    const link = botSourceLink({ id: "bot:ember", kind: "bot", name: "Ember", mayWrite: true, botId: "ember", linked: true }, bots, routines);
    expect(isLinked(link)).toBe(true);
    expect(botNames(link)).toBe("Ember");
    expect(link.routines).toEqual(["Morning tidy"]);
    // the server's word stands when the page does not hold the bot
    expect(isLinked(botSourceLink({ id: "bot:far", kind: "bot", name: "Far", mayWrite: true, botId: "far" }, bots, routines))).toBe(true);
  });

  it("leaves a temporary agent's memory unlinked", () => {
    expect(isLinked(botSourceLink({ id: "bot:perf", kind: "bot", name: "perf-test-061", mayWrite: true, botId: "perf", linked: false }, bots, routines))).toBe(false);
  });

  it("links a Perspicax sagax-<bot> folder to that bot while it exists", () => {
    expect(botNames(pxFolderLink("sagax-osprey", bots, routines))).toBe("Osprey");
    expect(isLinked(pxFolderLink("sagax-old", bots, routines))).toBe(false);
    expect(isLinked(pxFolderLink("notes", bots, routines))).toBe(false);
  });

  it("says which bots read a team section's folders, none owning them", () => {
    const link = teamFolderLink("built-in", bots);
    expect(isLinked(link)).toBe(false);
    expect(link.readBy).toEqual(["Osprey"]);
    expect(teamFolderLink("", bots).readBy).toEqual(["Ember"]);
  });
});
