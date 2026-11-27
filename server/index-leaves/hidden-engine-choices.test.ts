// D-20261126-018 (#5351): a provider the organization hid is no new choice,
// while what is already on it keeps it. run_with_engine's list
// (relayEnginesFor) and a conversation's switch (checkedTaskModelSwitch, the
// limit failover's return) with faked hosts; the real checkedModelSelection.
import { describe, expect, it } from "vitest";

import type { ModelSelection } from "../contracts.ts";
import { createCheckedModelSelection } from "./checkedModelSelection.ts";
import { createCheckedTaskModelSwitch } from "./checkedTaskModelSwitch.ts";
import { modelChangeCurrent } from "./modelChangeCurrent.ts";
import { createRelayEnginesFor } from "./relayEnginesFor.ts";

const HIDDEN = "Your organization does not offer this model provider for a new choice. A bot already on it keeps it.";
const engine = (instanceId: string) => ({
  instanceId, driverKind: "nimbusAgent", enabled: true,
  adapter: { capabilities: { effortLevels: [] } },
  models: { default: "deep", options: [{ id: "deep", label: "Deep" }] },
});
const engines = ["nimbus", "cirrus", "stratus"].map(engine);

function host(hidden: readonly string[]) {
  const value: Record<string, unknown> = {
    IDENTITY: { kind: "solo" },
    registry: { instances: () => engines, get: (id: string) => engines.find((candidate) => candidate.instanceId === id), entries: () => engines },
    providerInstancesChanging: new Set<string>(),
    engineProbes: new Map(),
    policyModelRefusal: () => undefined,
    orgEngineTurnRefusal: () => undefined,
    orgEngineAllowRefusal: () => undefined,
    orgEngineHidden: (id: string) => hidden.includes(id),
    orgEngineHiddenRefusal: (id: string) => (hidden.includes(id) ? HIDDEN : undefined),
    modelSwitchesFor: () => ({ org: [], mine: [] }),
    modelSwitchRefusal: () => undefined,
    effectiveBotOwner: () => "pr_ada",
    engineDisplayName: (instance: { instanceId: string }) => instance.instanceId,
    personalProviderInstances: { ownerOf: () => undefined },
    isAutoOptimize: () => true,
    engineInstalled: () => true,
    threadBusy: () => false,
    activeGroupTurnForBot: () => null,
  };
  value.checkedModelSelection = createCheckedModelSelection(() => value);
  return value;
}

describe("run_with_engine never offers a hidden provider to a bot that is not on it", () => {
  it("leaves it out for another bot, keeps it for the bot on it", () => {
    const relay = createRelayEnginesFor(() => host(["cirrus"])) as (bot: unknown, speaker: unknown) => Array<{ instanceId: string }>;
    const ids = (instanceId: string) => relay({ id: "b1", modelSelection: { instanceId, model: "deep" } }, { origin: "person" }).map((row) => row.instanceId);
    expect(ids("nimbus")).toEqual(["nimbus", "stratus"]);
    expect(ids("cirrus")).toEqual(["nimbus", "cirrus", "stratus"]);
    // nothing hidden: every engine, as before
    const all = createRelayEnginesFor(() => host([])) as (bot: unknown, speaker: unknown) => Array<{ instanceId: string }>;
    expect(all({ id: "b1", modelSelection: { instanceId: "nimbus", model: "deep" } }, { origin: "person" }).map((row) => row.instanceId)).toEqual(["nimbus", "cirrus", "stratus"]);
  });
});

describe("a conversation goes back to the hidden provider it is already on", () => {
  // Ada's bot runs on cirrus, which the organization hid; this conversation
  // went to stratus (a backup, a limit failover)
  const setup = () => {
    const value = host(["cirrus", "nimbus"]);
    const profile = { id: "b1", threadId: "t-main", modelSelection: { instanceId: "cirrus", model: "deep" } as ModelSelection };
    value.store = { bot: () => profile };
    const thread = { id: "b1", threadId: "t-2", modelSelection: { instanceId: "stratus", model: "deep" } as ModelSelection, approvalGrant: undefined };
    const switchTo = createCheckedTaskModelSwitch(() => value) as (current: unknown, raw: unknown, updateBotDefault: boolean, requireAvailableModel?: boolean, options?: { returning?: boolean }) => { ok: boolean; error?: string };
    return { thread, switchTo };
  };

  it("its bot's own engine is no new choice", () => {
    const { thread, switchTo } = setup();
    expect(switchTo(thread, { instanceId: "cirrus", model: "deep" }, false, true)).toMatchObject({ ok: true });
  });

  it("another hidden provider is refused, unless it is the engine the conversation returns to", () => {
    const { thread, switchTo } = setup();
    expect(switchTo(thread, { instanceId: "nimbus", model: "deep" }, false, true)).toMatchObject({ ok: false, error: HIDDEN });
    expect(switchTo(thread, { instanceId: "nimbus", model: "deep" }, false, true, { returning: true })).toMatchObject({ ok: true });
  });
});

describe("the three model-change routes let a conversation on a backup go back to its bot's hidden engine", () => {
  // Same shape the three routes used to call checkedModelSelection without
  // alsoOn (bots-core-task-patch, bots-mutate-patch-build-profile,
  // bots-mutate-patch-commit). modelChangeCurrent is what they pass now.
  const setup = () => {
    const value = host(["cirrus"]);
    const profile = { id: "b1", threadId: "t-main", modelSelection: { instanceId: "cirrus", model: "deep" } as ModelSelection };
    value.store = { bot: () => profile };
    const thread = { id: "b1", threadId: "t-backup", modelSelection: { instanceId: "stratus", model: "deep" } as ModelSelection };
    const check = createCheckedModelSelection(() => value) as (
      raw: unknown,
      current?: { selection: ModelSelection; busy: boolean; alsoOn?: readonly string[] },
      requireAvailableModel?: boolean,
    ) => { ok: boolean; error?: string };
    return { value, thread, check, profile };
  };

  it("bots-core-task-patch: composer route current carries the profile engine", () => {
    const { value, thread, check } = setup();
    const without = check({ instanceId: "cirrus", model: "deep" }, { selection: thread.modelSelection, busy: false }, true);
    expect(without).toMatchObject({ ok: false, error: HIDDEN });
    expect(check({ instanceId: "cirrus", model: "deep" }, modelChangeCurrent(value, thread), true)).toMatchObject({ ok: true });
  });

  it("bots-mutate-patch-build-profile: selectedTask current carries the profile engine", () => {
    const value = host(["cirrus", "nimbus"]);
    const profile = { id: "b1", threadId: "t-main", modelSelection: { instanceId: "cirrus", model: "deep" } as ModelSelection };
    value.store = { bot: () => profile };
    const thread = { id: "b1", threadId: "t-backup", modelSelection: { instanceId: "stratus", model: "deep" } as ModelSelection };
    const check = createCheckedModelSelection(() => value) as (
      raw: unknown,
      current?: { selection: ModelSelection; busy: boolean; alsoOn?: readonly string[] },
      requireAvailableModel?: boolean,
    ) => { ok: boolean; error?: string };
    expect(check({ instanceId: "cirrus", model: "deep" }, modelChangeCurrent(value, thread), true)).toMatchObject({ ok: true });
    // another hidden provider is still a new choice: refused
    expect(check({ instanceId: "nimbus", model: "deep" }, modelChangeCurrent(value, thread), true)).toMatchObject({ ok: false, error: HIDDEN });
  });

  it("bots-mutate-patch-commit: projected conversation current carries the profile engine", () => {
    const { value, thread, check } = setup();
    expect(check({ instanceId: "cirrus", model: "deep" }, modelChangeCurrent(value, thread), false)).toMatchObject({ ok: true });
  });
});
