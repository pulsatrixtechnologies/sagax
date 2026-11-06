// Bring-your-own engine: any agent CLI that speaks ACP over stdio plugs in
// as an instance of this driver — no code, one config entry:
//
//   { "instances": { "my-agent": {
//       "driver": "customAcp",
//       "displayName": "My Agent",
//       "config": { "cli": "my-agent acp" } } } }
//
// The `cli` string carries the whole command (wrapper strings resolve via
// splitCliString, so "npx -y some-agent acp" works too). There is no auth
// story on purpose: the user's CLI is expected to be signed in from a
// terminal already, exactly like the qwen harness. Each bot picks a model
// and a thinking level from the agent's live ACP catalog (Re-detect), or
// from an optional static `models` / `effortLevels` list in config.json.
import { isEffortLevel, type EffortLevel } from "../../../shared/wire.ts";
import { createAcpDriver, type AcpConfig, type AcpSupport } from "./core.ts";
import { resolveCustomAcpModels } from "./custom-model-catalog.ts";

const PASSTHROUGH = {
  default: "agent-default",
  options: [{ id: "agent-default", label: "Agent default", custom: true }],
};

function customCatalog(raw: unknown): AcpConfig["models"] | undefined {
  const models = raw && typeof raw === "object" ? (raw as { models?: unknown }).models : undefined;
  if (!Array.isArray(models)) return undefined;
  const options = models.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const id = typeof (row as { id?: unknown }).id === "string" ? (row as { id: string }).id.trim() : "";
    if (!id) return [];
    const labelRaw = (row as { label?: unknown }).label;
    const label = typeof labelRaw === "string" && labelRaw.trim() ? labelRaw.trim() : id;
    return [{ id, label, custom: true as const }];
  });
  return options.length ? { default: options[0]!.id, options } : undefined;
}

function customEffort(raw: unknown): EffortLevel[] | undefined {
  const levels = raw && typeof raw === "object" ? (raw as { effortLevels?: unknown }).effortLevels : undefined;
  if (!Array.isArray(levels)) return undefined;
  const kept = levels.filter((level): level is EffortLevel => isEffortLevel(level));
  return kept.length ? kept : undefined;
}

const CONFIGURE_HINT =
  'a custom ACP engine needs its command — add "config": { "cli": "<your-agent> acp" } to this instance in config.json, or use Settings → Engines → Set CLI…';

const support: AcpSupport = {
  driverKind: "customAcp",
  displayName: "Custom (ACP)",
  access: "custom",
  models: PASSTHROUGH,
  defaultCli: "",
  nativeSource: "custom.acp",
  loginNote: CONFIGURE_HINT,
  // Mode-entering args ride the cli string itself ("fx acp"), so nothing
  // extra here.
  spawnArgs: () => [],
  pickAuthMethod: () => null,
  authFailure: "continue",
  isAuthenticated: () => true,
  resolveModelsOnCreate: false,
  resolveModels(env, config, instanceId) {
    // Static config.json models (Sagax) win over live discovery.
    if (config.models?.options?.length) {
      return {
        default: config.models.default,
        options: config.models.options.map((option) => ({ ...option, custom: true })),
      };
    }
    return resolveCustomAcpModels(env, config, instanceId);
  },
  selectModel: { configId: "model", agentDefault: "agent-default", allowLegacy: true },
  modelVariants: true,
  // Static effortLevels (no ACP thought_level) still apply over the wire.
  async configureSession(ctx) {
    const effort = ctx.turn.effort;
    if (!effort || ctx.turn.variant !== undefined) return;
    const option = ctx.configOptions.find((entry) =>
      entry?.id === "effort" || entry?.id === "thought_level" || entry?.id === "thinking" || entry?.category === "thought_level");
    if (typeof option?.id !== "string" || option.currentValue === effort) return;
    await ctx.request("session/set_config_option", { sessionId: ctx.sessionId, configId: option.id, value: effort });
  },
};

const base = createAcpDriver(support);

export const CustomAcpDriver: typeof base = {
  ...base,
  // decodeAcpConfig never throws (a missing cli falls back to defaultCli,
  // which is empty here). Turn every blank-command path into the same
  // teaching shadow row instead of a bare spawn ENOENT at first send.
  decodeConfig(raw) {
    const decoded = base.decodeConfig(raw);
    if (!decoded.cli.trim()) throw new Error(CONFIGURE_HINT);
    const models = customCatalog(raw);
    const effortLevels = customEffort(raw);
    return { ...decoded, ...(models ? { models } : {}), ...(effortLevels ? { effortLevels } : {}) };
  },
  async create(input) {
    if (!input.config.cli.trim()) throw new Error(CONFIGURE_HINT);
    const instance = await base.create(input);
    // Static catalog / effort: apply now. Live discovery stays on Refresh
    // (resolveModelsOnCreate: false) so create does not spawn the CLI.
    if (input.config.models || input.config.effortLevels?.length) {
      await instance.refreshModels?.();
      if (input.config.effortLevels?.length) {
        instance.adapter.capabilities.effortLevels = [...input.config.effortLevels];
        // Static effort uses EffortRow, not opaque ACP variants.
        instance.adapter.capabilities.modelVariants = false;
      }
    }
    return instance;
  },
};
