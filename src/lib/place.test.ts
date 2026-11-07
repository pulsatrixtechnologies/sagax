import { describe, expect, it } from "vitest";
import { effectivePlace, isComputerPlace, orgComputerFor, PLACES, placeLabelKey, placeOffered, toolPlace } from "./place";
import { toolSurfaceKind } from "../../shared/tool-surface";

describe("where a conversation works", () => {
  it("lets the conversation's pin win over the bot's Works on, and reads a saved Off as Auto", () => {
    expect(effectivePlace({ computer: "cloud" }, { surface: "browser" })).toBe("browser");
    expect(effectivePlace({ computer: undefined }, { surface: "vm" })).toBe("vm");
    expect(effectivePlace({ computer: "browser" }, { surface: "local" })).toBe("local");
    expect(effectivePlace({ computer: "off" }, { surface: "browser" })).toBe("browser");
    expect(effectivePlace({ computer: "off" }, null)).toBe("auto");
    expect(effectivePlace({ computer: "cloud" }, null)).toBe("cloud");
    expect(effectivePlace({ computer: undefined }, undefined)).toBe("auto");
  });

  it("offers every place on a desktop or self-hosted server, and Cloud only while Boat or VPS is on", () => {
    for (const config of [null, undefined, {}]) {
      expect(PLACES.filter((place) => placeOffered(place, config))).toEqual(["vm", "local", "browser"]);
    }
    for (const features of [{ boatComputer: true }, { vpsComputer: true }]) {
      expect(PLACES.filter((place) => placeOffered(place, { features }))).toEqual(["cloud", "vm", "local", "browser"]);
    }
  });

  it("names places with one label key each", () => {
    expect(placeLabelKey("cloud")).toBe("place.cloud");
    expect(placeLabelKey("auto")).toBe("place.auto");
    expect(isComputerPlace("vm")).toBe(true);
    expect(isComputerPlace("browser")).toBe(false);
    expect(isComputerPlace("auto")).toBe(false);
  });

  it("gives browser tools the browser, computer tools the conversation's computer, and other tools nothing", () => {
    expect(toolPlace("agent_browser_snapshot", "cloud")).toBe("browser");
    expect(toolPlace("mcp__browser__browser_click", "vm")).toBe("browser");
    expect(toolPlace("mcp__computer__screenshot", "cloud")).toBe("cloud");
    expect(toolPlace("click", "local")).toBe("local");
    expect(toolPlace("computer_exec", "vm")).toBe("vm");
    // the computer server's browser_click acts inside the desktop
    expect(toolPlace("browser_click", "cloud")).toBe("cloud");
    // an unpinned Auto conversation has no known computer yet
    expect(toolPlace("screenshot", "auto")).toBeNull();
    expect(toolPlace("screenshot", "browser")).toBeNull();
    for (const name of ["Bash", "Read", "list_bots", "recall", "propose_routine", "mcp__agents__ask_bot"]) {
      expect(toolPlace(name, "cloud"), name).toBeNull();
    }
  });

  it("classifies tool names without guessing computer for unrelated tools", () => {
    expect(toolSurfaceKind("agent_browser_open")).toBe("browser");
    expect(toolSurfaceKind("browser__snapshot")).toBe("browser");
    expect(toolSurfaceKind("computer__click")).toBe("computer");
    expect(toolSurfaceKind("hotkey")).toBe("computer");
    expect(toolSurfaceKind("Bash")).toBeNull();
    expect(toolSurfaceKind("mcp__agents__list_bots")).toBeNull();
  });

  it("names Cloud and Auto for what they are on an organization server, and maps each place to its computer", () => {
    expect(placeLabelKey("cloud", true)).toBe("place.cloudOrg");
    expect(placeLabelKey("auto", true)).toBe("place.autoOrg");
    expect(placeLabelKey("vm", true)).toBe("place.vm");
    expect(placeLabelKey("cloud")).toBe("place.cloud");
    expect(orgComputerFor("auto")).toBe("server");
    expect(orgComputerFor("cloud")).toBe("server");
    expect(orgComputerFor("vm")).toBe("computer");
    expect(orgComputerFor("local")).toBe("computer");
    expect(orgComputerFor("browser")).toBeNull();
    expect(orgComputerFor("off")).toBeNull();
  });
});
