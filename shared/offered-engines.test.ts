import { describe, expect, it } from "vitest";
import { engineHidden, engineOffer, offeredEngines, orgEngineMoveLine, ownAccountOnly, type EngineOfferContext } from "./offered-engines.ts";
import { offeredModels } from "./offered-models.ts";

const engines = [{ instanceId: "claude" }, { instanceId: "codex" }, { instanceId: "grok" }];
const ids = (rows: readonly { instanceId: string }[]) => rows.map((row) => row.instanceId);
const org = (allowedEngines: EngineOfferContext["allowedEngines"], mine?: EngineOfferContext["mine"]): EngineOfferContext => ({ organization: true, allowedEngines, mine });

describe("the engines offered to a person (2026-10-18)", () => {
  it("solo: every engine, whatever a stray list says", () => {
    const solo = { organization: false, allowedEngines: [] as string[] };
    expect(ids(offeredEngines(engines, solo))).toEqual(["claude", "codex", "grok"]);
    expect(engineOffer(solo, "codex")).toBe("offered");
  });

  it("organization: null or absent is every engine, a list keeps its own, [] is none (Sagax 0.5.12+)", () => {
    expect(ids(offeredEngines(engines, org(null)))).toEqual(["claude", "codex", "grok"]);
    expect(ids(offeredEngines(engines, org(undefined)))).toEqual(["claude", "codex", "grok"]);
    expect(ids(offeredEngines(engines, org(["grok", "claude"])))).toEqual(["claude", "grok"]);
    expect(offeredEngines(engines, org([]))).toEqual([]);
    expect(engineOffer(org(["claude"]), "codex")).toBe("notAllowed");
  });

  it("2026-10-30: an engine the admin turned off is gone even for a person who pays for it themselves", () => {
    const mine = [
      { instanceId: "codex", orgNotAllowed: true, myTurns: "subscription" },
      { instanceId: "grok", orgNotAllowed: true, myTurns: "key" },
    ];
    expect(engineOffer(org(["claude"], mine), "codex")).toBe("notAllowed");
    expect(engineOffer(org(["claude"], mine), "grok")).toBe("notAllowed");
    expect(ids(offeredEngines(engines, org(["claude"], mine)))).toEqual(["claude"]);
    expect(ids(offeredEngines(engines, org(["claude"], mine), "settings"))).toEqual(["claude"]);
    expect(ownAccountOnly(org(["claude"], mine), "codex")).toBe(false);
  });

  it("with the organization's own-accounts setting, it comes back on the person's own account, said so (#1098)", () => {
    const mine = [
      { instanceId: "codex", orgNotAllowed: true, myTurns: "subscription" },
      { instanceId: "grok", orgNotAllowed: true, myTurns: "none" },
    ];
    const own = (list: EngineOfferContext["allowedEngines"], rows: EngineOfferContext["mine"]) => ({ ...org(list, rows), ownAccountsOutsideList: true });
    expect(engineOffer(own(["claude"], mine), "codex")).toBe("offered");
    expect(ownAccountOnly(own(["claude"], mine), "codex")).toBe(true);
    expect(ownAccountOnly(own(["claude"], mine), "claude")).toBe(false);
    expect(ids(offeredEngines(engines, own(["claude"], mine)))).toEqual(["claude", "codex"]);
    // nothing of theirs serves it yet: in Settings to connect their own account, not to pick
    expect(engineOffer(own(["claude"], mine), "grok")).toBe("notGiven");
    expect(ids(offeredEngines(engines, own(["claude"], mine), "settings"))).toEqual(["claude", "codex", "grok"]);
    // the organization's key never makes it offered, nor an expired sign-in, and an unlisted one stays hidden
    expect(engineOffer(own(["claude"], [{ instanceId: "codex", myTurns: "org-key" }]), "codex")).toBe("notAllowed");
    expect(engineOffer(own(["claude"], [{ instanceId: "codex", orgNotAllowed: true, myTurns: "expired" }]), "codex")).toBe("notGiven");
    expect(engineOffer(own(["claude"], null), "codex")).toBe("notAllowed");
  });

  it("an engine the organization pays for but did not give the person: not to pick, still in Settings", () => {
    const mine = [
      { instanceId: "grok", orgKeyNotGiven: true, myTurns: "none" },
      { instanceId: "codex", orgKeyNotGiven: true, myTurns: "subscription" },
    ];
    expect(engineOffer(org(null, mine), "grok")).toBe("notGiven");
    // their own subscription serves it: offered
    expect(engineOffer(org(null, mine), "codex")).toBe("offered");
    expect(ids(offeredEngines(engines, org(null, mine)))).toEqual(["claude", "codex"]);
    expect(ids(offeredEngines(engines, org(null, mine), "settings"))).toEqual(["claude", "codex", "grok"]);
    // not known yet (loading): nothing is dropped for it
    expect(engineOffer(org(null, null), "grok")).toBe("offered");
  });

  it("D-20261126-018: a provider the organization hid is in no list for a new choice, and stays where it is already the choice", () => {
    const hidden = { ...org(null), hiddenEngines: ["codex"] };
    expect(engineHidden(hidden, "codex")).toBe(true);
    expect(engineHidden(hidden, "claude")).toBe(false);
    // hidden is not off: what already runs on it is still offered
    expect(engineOffer(hidden, "codex")).toBe("offered");
    expect(ids(offeredEngines(engines, hidden))).toEqual(["claude", "grok"]);
    expect(ids(offeredEngines(engines, hidden, "settings"))).toEqual(["claude", "grok"]);
    // the engine a bot is on stays in that bot's own list
    expect(ids(offeredEngines(engines, hidden, "pick", "codex"))).toEqual(["claude", "codex", "grok"]);
    expect(ids(offeredEngines(engines, hidden, "pick", ["codex"]))).toEqual(["claude", "codex", "grok"]);
    expect(ids(offeredEngines(engines, hidden, "pick", "claude"))).toEqual(["claude", "grok"]);
    const withModels = engines.map((engine) => ({ ...engine, models: { default: "m", options: [{ id: "m" }] } }));
    expect(ids(offeredModels(withModels, hidden, null))).toEqual(["claude", "grok"]);
    expect(ids(offeredModels(withModels, hidden, null, "pick", "codex"))).toEqual(["claude", "codex", "grok"]);
    // keeping it never lifts the organization's list
    expect(ids(offeredEngines(engines, { ...org(["claude"]), hiddenEngines: ["codex"] }, "pick", "codex"))).toEqual(["claude"]);
    // a solo server has no organization to hide anything
    const solo = { organization: false, allowedEngines: null, hiddenEngines: ["codex"] };
    expect(engineHidden(solo, "codex")).toBe(false);
    expect(ids(offeredEngines(engines, solo))).toEqual(["claude", "codex", "grok"]);
  });

  it("the moved bot's plain line", () => {
    expect(orgEngineMoveLine({ from: "Codex", to: "Claude" })).toBe("Your organization no longer offers Codex. This bot now uses Auto, starting on Claude.");
  });
});
