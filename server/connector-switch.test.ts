import { describe, expect, it } from "vitest";

import { connectorSwitchText, pickConnectorSwitch, type SwitchEngine } from "./connector-switch.ts";

const grok: SwitchEngine = { instanceId: "grok", engineLabel: "Grok", models: [{ id: "grok-4.7", price: 18 }], defaultModel: "grok-4.7", reach: [] };
const claude = (connectors: string[], extra: Partial<SwitchEngine> = {}): SwitchEngine => ({
  instanceId: "claude", engineLabel: "Claude",
  models: [{ id: "haiku", price: 6 }, { id: "sonnet", price: 18 }, { id: "opus", price: 30 }], defaultModel: "sonnet",
  reach: connectors.map((name) => ({ connector: name })), ...extra,
});
const base = { model: "grok-4.7", price: 18 };

describe("2026-10-29: a person's two Grok accounts", () => {
  const team: SwitchEngine = { ...grok, reach: [], accountKind: "team" };
  const personal: SwitchEngine = { ...grok, engineLabel: "Grok (personal account)", reach: [{ connector: "Microsoft Teams" }, { connector: "Outlook (Exchange)" }], account: "second", accountKind: "personal" };

  it("moves a request to the other sign-in of the same engine when that one has the connector", () => {
    expect(pickConnectorSwitch({ need: { capability: "teams", hint: "Teams" }, current: team, base, candidates: [personal] }))
      .toEqual({ instanceId: "grok", model: "grok-4.7", engineLabel: "Grok (personal account)", connector: "Microsoft Teams", account: "second" });
    // the same sign-in again is no switch
    expect(pickConnectorSwitch({ need: { capability: "teams", hint: "Teams" }, current: personal, base, candidates: [personal] })).toBeNull();
  });

  it("a personal connector the team account also has still goes to the personal account", () => {
    const teamWithTeams = { ...team, reach: [{ connector: "Microsoft Teams" }] };
    expect(pickConnectorSwitch({ need: { capability: "teams", hint: "Teams" }, current: teamWithTeams, base, candidates: [claude(["Microsoft 365"]), personal] }))
      .toMatchObject({ engineLabel: "Grok (personal account)", account: "second" });
    // no personal account with it: the team account keeps it
    expect(pickConnectorSwitch({ need: { capability: "teams", hint: "Teams" }, current: teamWithTeams, base, candidates: [claude(["Microsoft 365"])] })).toBeNull();
    // a connector that is not personal stays where it is
    const teamWithSharePoint = { ...team, reach: [{ connector: "SharePoint" }] };
    expect(pickConnectorSwitch({ need: { capability: "files", hint: "SharePoint" }, current: teamWithSharePoint, base, candidates: [{ ...personal, reach: [{ connector: "SharePoint" }] }] })).toBeNull();
  });

  it("among several engines that have it, the personal account comes first for a personal connector", () => {
    const current = { ...grok, reach: [], accountKind: "team" as const };
    expect(pickConnectorSwitch({ need: { capability: "mail", hint: "Outlook" }, current, base, candidates: [claude(["Microsoft 365"]), personal] }))
      .toMatchObject({ engineLabel: "Grok (personal account)", connector: "Outlook (Exchange)" });
  });
});

describe("switching a request to the engine that has its connector (Owner 2026-10-21)", () => {
  it("switches when the bot's engine lacks it and another engine of this person has it", () => {
    expect(pickConnectorSwitch({ need: { capability: "mail", hint: "Gmail" }, current: grok, base, candidates: [claude(["Gmail"])] }))
      .toEqual({ instanceId: "claude", model: "sonnet", engineLabel: "Claude", connector: "Gmail" });
  });

  it("stays when the bot's engine already reaches it", () => {
    const current = { ...grok, reach: [{ connector: "Outlook (Exchange)" }] };
    expect(pickConnectorSwitch({ need: { capability: "mail" }, current, base, candidates: [claude(["Gmail"])] })).toBeNull();
    expect(pickConnectorSwitch({ need: { capability: "mail", hint: "Outlook" }, current, base, candidates: [claude(["Microsoft 365"])] })).toBeNull();
  });

  it("never switches while the bot's own engine's reach is unknown (cold cache, review of #943)", () => {
    expect(pickConnectorSwitch({ need: { capability: "mail" }, current: { ...grok, reach: null }, base, candidates: [claude(["Gmail"])] })).toBeNull();
  });

  it("never switches to an engine whose reach is unknown", () => {
    expect(pickConnectorSwitch({ need: { capability: "mail" }, current: grok, base, candidates: [claude([], { reach: null })] })).toBeNull();
  });

  it("follows the service the person named", () => {
    const current = { ...grok, reach: [{ connector: "Outlook (Exchange)" }] };
    expect(pickConnectorSwitch({ need: { capability: "mail", hint: "Gmail" }, current, base, candidates: [claude(["Gmail"])] })?.connector).toBe("Gmail");
    expect(pickConnectorSwitch({ need: { capability: "teams", hint: "Teams" }, current: grok, base, candidates: [claude(["Microsoft 365"])] })?.connector).toBe("Microsoft 365");
    expect(pickConnectorSwitch({ need: { capability: "mail", hint: "Gmail" }, current: grok, base, candidates: [claude(["Microsoft 365"])] })).toBeNull();
  });

  it("no switch when no engine has it, when nothing is needed, or with no usable model", () => {
    expect(pickConnectorSwitch({ need: { capability: "teams" }, current: grok, base, candidates: [claude(["Gmail"])] })).toBeNull();
    expect(pickConnectorSwitch({ need: null, current: grok, base, candidates: [claude(["Gmail"])] })).toBeNull();
    expect(pickConnectorSwitch({ need: { capability: "mail" }, current: grok, base, candidates: [claude(["Gmail"], { models: [], defaultModel: undefined })] })).toBeNull();
  });

  it("never a model that costs more than the bot's own (review of #943)", () => {
    // the default costs more: the strongest model at or under the bot's price
    expect(pickConnectorSwitch({ need: { capability: "mail" }, current: grok, base: { model: "grok-4.7", price: 10 }, candidates: [claude(["Gmail"])] })?.model).toBe("haiku");
    // nothing at or under it: no switch
    expect(pickConnectorSwitch({ need: { capability: "mail" }, current: grok, base: { model: "grok-mini", price: 2 }, candidates: [claude(["Gmail"])] })).toBeNull();
    // the bot's price unknown while the engine's are known: no switch
    expect(pickConnectorSwitch({ need: { capability: "mail" }, current: grok, base: { model: "custom" }, candidates: [claude(["Gmail"])] })).toBeNull();
    // no price known anywhere: the engine's default
    const unpriced = claude(["Gmail"], { models: [{ id: "sonnet" }, { id: "opus" }] });
    expect(pickConnectorSwitch({ need: { capability: "mail" }, current: grok, base: { model: "custom" }, candidates: [unpriced] })?.model).toBe("sonnet");
  });

  it("keeps the bot's effort when the engine accepts it", () => {
    expect(pickConnectorSwitch({ need: { capability: "mail" }, current: grok, base: { ...base, effort: "high" }, candidates: [claude(["Gmail"], { effortLevels: ["low", "high"] })] })?.effort).toBe("high");
    expect(pickConnectorSwitch({ need: { capability: "mail" }, current: grok, base: { ...base, effort: "max" }, candidates: [claude(["Gmail"], { effortLevels: ["low", "high"] })] })?.effort).toBeUndefined();
  });

  it("one line, in plain words", () => {
    expect(connectorSwitchText({ engine: "Claude", connector: "Gmail" })).toBe("Switched to Claude for Gmail.");
    // #3149: the line follows the conversation's language
    expect(connectorSwitchText({ engine: "Claude", connector: "Gmail" }, "fr")).toBe("Passé à Claude pour Gmail.");
    expect(connectorSwitchText({ engine: "Claude", connector: "Gmail" }, "fr-CA")).toBe("Passé à Claude pour Gmail.");
    expect(connectorSwitchText({ engine: "Claude", connector: "Gmail" }, "en")).toBe("Switched to Claude for Gmail.");
  });
});
