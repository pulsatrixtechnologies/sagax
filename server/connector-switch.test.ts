import { describe, expect, it } from "vitest";

import { connectorSwitchText, pickConnectorSwitch, type SwitchEngine } from "./connector-switch.ts";

const grok: SwitchEngine = { instanceId: "grok", engineLabel: "Grok", models: [{ id: "grok-4.7", price: 18 }], defaultModel: "grok-4.7", reach: [] };
const claude = (connectors: string[], extra: Partial<SwitchEngine> = {}): SwitchEngine => ({
  instanceId: "claude", engineLabel: "Claude",
  models: [{ id: "haiku", price: 6 }, { id: "sonnet", price: 18 }, { id: "opus", price: 30 }], defaultModel: "sonnet",
  reach: connectors.map((name) => ({ connector: name })), ...extra,
});
const base = { model: "grok-4.7", price: 18 };

describe("switching a request to the engine that has its connector (JC 2026-10-21)", () => {
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
  });
});
