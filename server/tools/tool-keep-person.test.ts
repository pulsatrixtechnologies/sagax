// #4527 lot E review: whose list a bot's tool keeping reads and changes, and
// what the tool selection card says is left out, per engine family.
import { describe, expect, it } from "vitest";

import { actorForTurn } from "../../shared/bot-act.ts";
import { engineLeavesOut } from "./tool-keep-listing.ts";
import { toolKeepEngine, toolKeepPersonFor } from "./tool-keep-person.ts";

const deps = (organization: boolean, principal: string | null) => ({
  organization,
  sessionPrincipal: () => principal,
  effectiveBotOwner: () => "pr_owner",
});

describe("toolKeepPersonFor", () => {
  it("is the signed-in person on an organization server, and nobody for a caller who is no signed-in person", () => {
    expect(toolKeepPersonFor(deps(true, "pr_alice"), {}, {})).toBe("pr_alice");
    // never the owner's list in someone else's name
    expect(toolKeepPersonFor(deps(true, null), {}, {})).toBeNull();
    expect(toolKeepPersonFor(deps(true, "  "), {}, {})).toBeNull();
  });

  it("is the bot's owner on a personal server", () => {
    expect(toolKeepPersonFor(deps(false, null), {}, {})).toBe("pr_owner");
  });

  it("a bot's sagax_settings write runs as the person whose turn it is, and a guest's turn writes nothing", () => {
    // the act runs on that person's own session (performBotActRoute), so
    // toolKeepPersonFor reads that person: their own list only
    expect(actorForTurn({ automation: false, guest: false, requestUsable: true, senderUnproven: false, provenPerson: "pr_bob", sharedServer: true }))
      .toEqual({ kind: "person", personKey: "pr_bob" });
    // a guest on a shared bot: no act at all, so the owner's list never moves
    expect(actorForTurn({ automation: false, guest: true, requestUsable: true, senderUnproven: false, provenPerson: "pr_guest", sharedServer: true }))
      .toEqual({ kind: "none", reason: "guest" });
    // a routine acts for its owner, on the owner's list
    expect(actorForTurn({ automation: true, guest: false, requestUsable: true, senderUnproven: false, provenPerson: null, sharedServer: true, routineOwner: "pr_owner" }))
      .toMatchObject({ kind: "person", personKey: "pr_owner" });
  });
});

describe("what the card says is left out, per engine family", () => {
  it.each([
    ["codex", false], ["grokAgent", false], ["geminiAgent", false], ["museCode", false], ["piAgent", false], ["openai-compat", false], ["mistral", false],
  ])("%s leaves out the agents tools only, a connector's stay listed", (driverKind) => {
    const engine = toolKeepEngine({ modelSelection: { model: "cloud-model" } }, driverKind, {});
    expect(engine.compactPrompt).toBe(false);
    expect(engineLeavesOut("agents/run_routine", engine)).toBe(true);
    expect(engineLeavesOut("crm/old_report", engine)).toBe(false);
  });

  it("Claude Code and a compact prompt leave out a connector's tools too", () => {
    expect(engineLeavesOut("crm/old_report", toolKeepEngine({}, "claudeAgent", {}))).toBe(true);
    expect(engineLeavesOut("crm/old_report", { driverKind: "piAgent", compactPrompt: true })).toBe(true);
    expect(engineLeavesOut("not an id", { driverKind: "claudeAgent", compactPrompt: true })).toBe(false);
  });
});
