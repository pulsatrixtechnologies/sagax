// @ts-nocheck
/** checkedModelSelection (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCheckedModelSelection(getHost: () => Host): any {
function checkedModelSelection(
  raw: unknown,
  current?: { selection: ModelSelection; busy: boolean },
  requireAvailableModel = false,
  /** #1098: the person choosing, who may pick an engine outside the
   * organization's list that they pay for themselves. */
  payer?: string | null,
): { ok: true; selection: ModelSelection } | { ok: false; status: number; error: string } {
  const host = getHost();

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, status: 400, error: "modelSelection must be an object" };
  }
  const value = raw as { instanceId?: unknown; model?: unknown; effort?: unknown; variant?: unknown; auto?: unknown; fast?: unknown; autoOptimize?: unknown };
  if (typeof value.instanceId !== "string" || !value.instanceId.trim()) {
    return { ok: false, status: 400, error: "modelSelection.instanceId is required" };
  }
  if (typeof value.model !== "string" || !value.model.trim()) {
    return { ok: false, status: 400, error: "modelSelection.model is required" };
  }
  const selection: ModelSelection = {
    instanceId: value.instanceId.trim(),
    model: value.model.trim()
  };
  if (host.hostedModels && !host.hostedModels.allows(selection)) return { ok: false, status: 400, error: host.hostedModels.error() };
  // The organization's allowed providers; the engine a bot already runs on
  // stays writable (its effort) until the fallback moves it.
  if ((!current || current.selection.instanceId !== selection.instanceId) && host.orgEngineAllowRefusal(selection.instanceId, payer)) {
    return { ok: false, status: 403, error: host.ORG_ENGINE_NOT_ALLOWED };
  }
  // 2026-10-30 (lot 2): a model turned off is never picked by name (Auto
  // then starts from a model still on); the one a bot already runs stays
  // writable until applyModelSwitches moves it.
  const modelRefusal = value.auto === true || (current && current.selection.instanceId === selection.instanceId && current.selection.model === selection.model)
    ? undefined : host.modelSwitchRefusal(selection.instanceId, selection.model, payer);
  if (modelRefusal) return { ok: false, status: 403, error: modelRefusal };
  // Auto (docs/plans/2026-10-08-auto-model.md): only true is stored.
  if (value.auto !== undefined && value.auto !== true && value.auto !== false) {
    return { ok: false, status: 400, error: "modelSelection.auto must be a boolean" };
  }
  if (value.auto === true) selection.auto = true;
  // #2106: Auto's Optimize preference (Intelligence / Balance / Cost), kept only with Auto.
  if (value.autoOptimize !== undefined && value.autoOptimize !== null) {
    if (!host.isAutoOptimize(value.autoOptimize)) {
      return { ok: false, status: 400, error: "modelSelection.autoOptimize must be intelligence, balance or cost" };
    }
    if (value.auto === true) selection.autoOptimize = value.autoOptimize;
  }
  // The fast model (#1209): a model the engine lists, kept only with Auto.
  if (value.fast !== undefined && value.fast !== null) {
    const fast = value.fast as { instanceId?: unknown; model?: unknown };
    if (typeof fast !== "object" || typeof fast.instanceId !== "string" || !fast.instanceId.trim() || typeof fast.model !== "string" || !fast.model.trim()) {
      return { ok: false, status: 400, error: "modelSelection.fast needs an instanceId and a model" };
    }
    if (value.auto === true) {
      const fastSelection = { instanceId: fast.instanceId.trim(), model: fast.model.trim() };
      const refusal = host.modelSwitchRefusal(fastSelection.instanceId, fastSelection.model, payer);
      if (refusal) return { ok: false, status: 403, error: refusal };
      selection.fast = fastSelection;
    }
  }
  if (value.effort !== undefined) {
    if (!isEffortLevel(value.effort)) {
      return { ok: false, status: 400, error: `effort "${String(value.effort)}" is not recognized` };
    }
    selection.effort = value.effort;
  }
  if (value.variant !== undefined) {
    if (!isModelVariant(value.variant)) {
      return { ok: false, status: 400, error: "variant must be a non-empty model variant ID" };
    }
    if (value.effort !== undefined) {
      return { ok: false, status: 400, error: "choose either a model variant or an effort level" };
    }
    selection.variant = value.variant;
  }
  const changed = current && (
    selection.instanceId !== current.selection.instanceId ||
    selection.model !== current.selection.model ||
    selection.auto !== current.selection.auto ||
    selection.autoOptimize !== current.selection.autoOptimize ||
    selection.effort !== current.selection.effort ||
    selection.variant !== current.selection.variant
  );
  if (current?.busy && changed) {
    return { ok: false, status: 409, error: "the bot is working — stop it before changing models" };
  }
  const target = host.registry.get(selection.instanceId);
  if (host.providerInstancesChanging.has(selection.instanceId)) {
    return { ok: false, status: 409, error: "this provider account is being updated — try again shortly" };
  }
  // Model IDs remain free-form at the app's general API boundary. Custom
  // engines can accept IDs that are not in their discovery catalog, and
  // several drivers only learn the final catalog when a turn starts. The
  // MCP tool applies a stricter discovered-model policy for its own calls.
  if (requireAvailableModel) {
    if (!target) {
      return { ok: false, status: 400, error: `model instance "${selection.instanceId}" is unavailable` };
    }
    const offered =
      selection.model === target.models.default ||
      target.models.options.some((option) => option.id === selection.model);
    if (!offered) {
      return {
        ok: false,
        status: 400,
        error: `model "${selection.model}" is not offered by instance "${selection.instanceId}"`
      };
    }
  }
  const allowed = target?.adapter.capabilities.effortLevels ?? [];
  if (target && selection.effort !== undefined && !host.effortAcceptedByEngine(selection.effort, allowed)) {
    return { ok: false, status: 400, error: `effort "${selection.effort}" is not offered by this bot's engine` };
  }
  // A level the engine takes but this model does not (grok-4.5 and xhigh):
  // the model's own default runs instead. A client from before per-model
  // levels keeps the level across a model change; refusing would strand it.
  if (target && selection.effort !== undefined &&
    !host.effortAcceptedByModel(selection.effort, target.models.options.find((option) => option.id === selection.model), allowed)) {
    delete selection.effort;
  }
  if (target && selection.variant !== undefined && !target.adapter.capabilities.modelVariants) {
    return { ok: false, status: 400, error: "model variants are not offered by this bot's engine" };
  }
  return { ok: true, selection };

}
  return checkedModelSelection;
}
