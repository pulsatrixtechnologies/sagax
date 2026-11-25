// The console's "Change model" of a bot (#5323): the reasoning level rides the
// same check as any model selection (checkedModelSelection, the real one
// here), and a call that names no level does exactly what it did before.
import { describe, expect, it } from "vitest";

import type { ModelSelection } from "../contracts.ts";
import { createCheckedModelSelection } from "./checkedModelSelection.ts";
import { createOrgAdminBots } from "./orgAdminBots.ts";
import { createOrgAdminSetModel } from "./orgAdminSetModel.ts";
import { ConsoleRefusal } from "../org/org-admin-console.ts";
import { effortAcceptedByModel } from "../../shared/model-capabilities.ts";
import { effortAcceptedByEngine } from "../../shared/ultracode-effort.ts";

function setup(selection: ModelSelection = { instanceId: "nimbus", model: "deep", effort: "high", auto: true }) {
  const bot = { id: "b1", threadId: "t1", name: "Ada", modelSelection: selection as ModelSelection, approvalGrant: undefined as unknown };
  const patches: Array<{ modelSelection: ModelSelection }> = [];
  const engine = {
    instanceId: "nimbus",
    adapter: { capabilities: { effortLevels: ["low", "medium", "high", "xhigh"] } },
    models: {
      default: "deep",
      options: [
        { id: "deep", label: "Deep", effortLevels: ["low", "medium", "high", "xhigh"], defaultEffort: "medium" },
        { id: "light", label: "Light", effortLevels: ["low", "medium"] },
        { id: "plain", label: "Plain", effortLevels: [] },
      ],
    },
  };
  let busy = false;
  const host: Record<string, unknown> = {
    IDENTITY: { kind: "solo" },
    personalProviderInstances: { ownerOf: () => undefined },
    orgEngineAllowRefusal: () => false,
    modelSwitchRefusal: () => undefined,
    isAutoOptimize: () => true,
    registry: { get: (id: string) => (id === "nimbus" ? engine : undefined), entries: () => [{ instanceId: "nimbus" }] },
    providerInstancesChanging: new Set<string>(),
    effortAcceptedByEngine,
    effortAcceptedByModel,
    engineInstalled: (id: string) => id === "nimbus",
    consoleEngineAllowed: () => true,
    threadBusy: () => busy,
    store: {
      bot: (id: string) => (id === bot.id ? bot : undefined),
      patchBot: (_id: string, patch: { modelSelection: ModelSelection }) => { patches.push(patch); bot.modelSelection = patch.modelSelection; },
    },
  };
  host.checkedModelSelection = createCheckedModelSelection(() => host);
  const setModel = createOrgAdminSetModel(() => host) as (botId: string, input: { engineInstanceId?: string; model: string | null; effort?: string | null }) => void;
  const refusal = (run: () => void): ConsoleRefusal | null => {
    try { run(); return null; } catch (error) { if (error instanceof ConsoleRefusal) return error; throw error; }
  };
  return { bot, patches, host, setModel, refusal, work: (value: boolean) => { busy = value; } };
}

describe("the console sets a bot's model", () => {
  it("without a level: exactly what it stored before the level existed", () => {
    const { setModel, patches } = setup();
    setModel("b1", { model: "light" });
    setModel("b1", { engineInstanceId: "nimbus", model: null });
    // before #5323 the selection written was the engine and the model, nothing else: the same now
    expect(patches).toEqual([
      { modelSelection: { instanceId: "nimbus", model: "light" } },
      { modelSelection: { instanceId: "nimbus", model: "light" } },
    ]);
  });

  it("with a level the model takes: stored with the model", () => {
    const { setModel, patches } = setup();
    setModel("b1", { model: "light", effort: "low" });
    expect(patches.at(-1)).toEqual({ modelSelection: { instanceId: "nimbus", model: "light", effort: "low" } });
  });

  it("a level alone keeps the rest of the bot's selection; null takes the level off", () => {
    const { setModel, patches } = setup();
    setModel("b1", { model: "deep", effort: "low" });
    setModel("b1", { engineInstanceId: "nimbus", model: null, effort: null });
    expect(patches).toEqual([
      { modelSelection: { instanceId: "nimbus", model: "deep", auto: true, effort: "low" } },
      { modelSelection: { instanceId: "nimbus", model: "deep", auto: true } },
    ]);
    // with another model the selection is that model and the level, as a model change always wrote it
    setModel("b1", { model: "light", effort: null });
    expect(patches.at(-1)).toEqual({ modelSelection: { instanceId: "nimbus", model: "light" } });
  });

  it("a level may change while the bot works, on the model it runs", () => {
    const { setModel, patches, work, refusal } = setup();
    work(true);
    setModel("b1", { model: "deep", effort: "xhigh" });
    expect(patches.at(-1)!.modelSelection).toEqual({ instanceId: "nimbus", model: "deep", auto: true, effort: "xhigh" });
    expect(refusal(() => setModel("b1", { model: "light", effort: "low" }))).toMatchObject({ status: 409, code: "busy" });
  });

  it("refuses a level the model does not take, an unknown level, and writes nothing", () => {
    const { setModel, patches, refusal } = setup();
    // the engine takes xhigh, this model does not
    expect(refusal(() => setModel("b1", { model: "light", effort: "xhigh" }))).toMatchObject({ status: 400, code: "effort_not_offered" });
    // a model with no reasoning control takes none
    expect(refusal(() => setModel("b1", { model: "plain", effort: "low" }))).toMatchObject({ status: 400, code: "effort_not_offered" });
    expect(refusal(() => setModel("b1", { model: "deep", effort: "turbo" }))).toMatchObject({ status: 400, code: "bad_request" });
    expect(patches).toEqual([]);
  });
});

describe("a console bot row says its reasoning", () => {
  it("the level it runs at, the levels its model takes and the model's default", () => {
    const { host, setModel } = setup();
    Object.assign(host, {
      approvalModeFor: () => "ask", attachmentExists: () => false, resolveEngineAccess: () => ({ ok: true, via: "server" }), sectionKey: () => "",
      botFacts: () => ({ ownerPrincipalId: "pr_ada", grants: [] }), engineOfBot: () => ({ instanceId: "nimbus", driver: "nimbusAgent" }),
      adminPerson: (id: string) => ({ principalId: id, sub: null, name: id }), adminBotEngine: (engine: unknown) => engine, engineInstalled: () => true,
      driverDisplayName: () => "Nimbus", wireGrants: () => [], describeGrantTarget: () => "", botOwnerOrgRole: () => "member", botThreadIds: () => ["t1"],
      botLook: () => ({}), botPersona: () => ({}), orgBotReach: () => ({ ownerPrincipalId: "pr_ada", grantTargets: [], sectionMemberTargets: [] }),
    });
    (host.store as Record<string, unknown>).bots = [(host.store as { bot(id: string): unknown }).bot("b1")];
    (host.store as Record<string, unknown>).tasks = () => [];
    const rows = createOrgAdminBots(() => host) as () => Array<{ bot: { reasoning?: unknown } }>;
    expect(rows()[0]!.bot.reasoning).toEqual({ effort: "high", levels: ["low", "medium", "high", "xhigh"], default: "medium" });
    setModel("b1", { model: "light" });
    expect(rows()[0]!.bot.reasoning).toEqual({ effort: null, levels: ["low", "medium"], default: null });
    setModel("b1", { model: "plain" });
    expect(rows()[0]!.bot.reasoning).toEqual({ effort: null, levels: [], default: null });
  });
});
