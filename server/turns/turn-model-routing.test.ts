import { describe, expect, it } from "vitest";
import type { ModelSelection } from "../../shared/wire.ts";
import { routeTurnModel, type TurnModelRoutingInput } from "./turn-model-routing.ts";

const GROK: ModelSelection = { instanceId: "grok", model: "grok-4.7", effort: "xhigh" };
const CLAUDE: ModelSelection = { instanceId: "claude", model: "claude-opus-5" };
const CODEX: ModelSelection = { instanceId: "codex", model: "gpt-5.5" };

/** A person who can pay for the engines in `pays`, whose Grok session offers `grok`. */
function input(over: Partial<TurnModelRoutingInput> & { pays?: string[]; grok?: string[] | null } = {}): TurnModelRoutingInput {
  const pays = new Set(over.pays ?? ["grok"]);
  const grok = over.grok === undefined ? ["grok-4.7", "grok-4.6"] : over.grok;
  return {
    requested: GROK,
    ownerSpeaks: false,
    speakerPays: true,
    access: (selection) => pays.has(selection.instanceId),
    offered: (selection) => (selection.instanceId === "grok" ? grok : null),
    exempt: () => false,
    effortOn: (selection, model) => (model === "grok-4.5" && selection.effort === "xhigh" ? undefined : selection.effort),
    starred: [],
    equivalent: () => (pays.has("claude") ? CLAUDE : null),
    ...over,
  };
}

describe("routeTurnModel (#1154): each turn runs on a model its payer can pay for", () => {
  it("keeps the bot's model when the person's session offers it", () => {
    expect(routeTurnModel(input())).toBeNull();
  });

  it("keeps the bot's model when the session's list is unknown (no guess)", () => {
    expect(routeTurnModel(input({ grok: null }))).toBeNull();
  });

  it("runs on the nearest model the person's own session offers on the same engine", () => {
    expect(routeTurnModel(input({ grok: ["grok-4.6", "grok-4.5"] }))).toEqual({
      selection: { instanceId: "grok", model: "grok-4.6", effort: "xhigh" },
      requested: GROK,
      reason: "not-offered",
    });
  });

  it("drops an effort the replacement does not take", () => {
    expect(routeTurnModel(input({ grok: ["grok-4.5"] }))?.selection).toEqual({ instanceId: "grok", model: "grok-4.5" });
  });

  it("goes to the person's own model for the bot, then their starred one, then the same tier elsewhere", () => {
    const own = routeTurnModel(input({ pays: ["codex", "claude"], ownPick: CODEX, starred: [CLAUDE] }));
    expect(own).toMatchObject({ selection: CODEX, reason: "own-pick" });
    const starred = routeTurnModel(input({ pays: ["claude"], ownPick: CODEX, starred: [CODEX, CLAUDE] }));
    expect(starred).toMatchObject({ selection: CLAUDE, reason: "starred" });
    const equivalent = routeTurnModel(input({ pays: ["claude"] }));
    expect(equivalent).toEqual({ selection: CLAUDE, requested: GROK, reason: "equivalent" });
  });

  it("answers null (the access card) when the person can pay for nothing", () => {
    expect(routeTurnModel(input({ pays: [], starred: [CLAUDE] }))).toBeNull();
  });

  it("never leaves the owner's model when the owner pays for the people who write", () => {
    expect(routeTurnModel(input({ pays: ["claude"], speakerPays: false, starred: [CLAUDE] }))).toBeNull();
    // the owner's own session still runs the nearest model it offers
    expect(routeTurnModel(input({ speakerPays: false, grok: ["grok-4.6"] }))?.selection.model).toBe("grok-4.6");
  });

  it("serves the owner's own turn like anyone else's", () => {
    expect(routeTurnModel(input({ pays: ["claude"], ownerSpeaks: true, speakerPays: false }))).toMatchObject({ selection: CLAUDE, reason: "equivalent" });
  });

  it("never replaces a custom or local row", () => {
    expect(routeTurnModel(input({ grok: ["grok-4.6"], exempt: () => true }))).toBeNull();
  });
});
