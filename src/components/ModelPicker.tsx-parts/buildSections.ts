// Model list sections for the picker window and composer menu (#1383).
import { localModelSubtext } from "@/lib/local-model-label";
import { isDesktopModelId, localModelRows, localRowUnavailable } from "@/lib/local-models";
import { modelOn } from "../../../shared/offered-models";
import { needsCli, needsSignIn } from "../EngineSetup";
import type { ModelMenuRow, ModelMenuSection } from "../ModelMenu";
import { equivalentOfferedModel } from "../../../shared/payable-model";
import { t } from "@/lib/i18n";
import { orgEngineState } from "@/lib/model-payers";
import type { MyEngine } from "@/lib/perspicax-org";
import { favoriteKey } from "@/lib/model-favorites";
import { engineRuns, modelUsable } from "@/lib/model-health";
import { effortLabel } from "@/lib/effort-label";
import { effortForModel, fastBaseOf, fastTwinOf, modelDefaultEffort } from "../../../shared/model-capabilities";
import type { InstanceInfo, ModelSelection, Bot } from "@/state/store";
import type { ModelSwitches } from "../../../shared/offered-models";
import type { ModelOption } from "./helpers";
import { modelLabel } from "./helpers";
import { providerCatalog } from "../../../shared/provider-catalog";
import { canonicalModelId, COMPUTER_PROVIDER_ID, providerOfModel, splitEngine, type ProviderRef } from "../../../shared/model-provider";
import { autoOptimizeOf } from "../../../shared/model-auto-optimize";
import { isModelServerOption } from "../../../shared/model-server-option";

export type MyEnginesState = readonly MyEngine[] | null | undefined;

export interface ModelPickerSectionsInput {
  orgMode: boolean;
  accountModels: Map<string, ReadonlySet<string>>;
  selection: ModelSelection;
  switches: ModelSwitches;
  autoOn: boolean;
  follows: boolean | undefined;
  selectedVariantLabel: string | undefined;
  fallback: { instanceId: string; requested: string; actual: string; actualInstanceId?: string } | undefined;
  instances: readonly InstanceInfo[];
  selectable: InstanceInfo[];
  viewerLocal: boolean;
  /** Pick-only surfaces: a leading row (for example "Keep current model"). */
  keepRow?: ModelMenuRow;
  autoPreview: { modelLabel: string } | null | undefined;
  autoRecord: { modelLabel: string } | null | undefined;
  profile: Bot;
  botModelInstance: InstanceInfo | undefined;
  botModelName: string;
  health: { orgMode: boolean; myEngines: MyEnginesState };
  myEngines: MyEnginesState;
  ranOnName: (ran: { instanceId: string; actual: string; actualInstanceId?: string }) => string;
  /** #2106: starred model row keys, shown as a Favorites section in the flat list. */
  favoriteKeys?: readonly string[];
}

export interface ModelPickerSections {
  menuSections: ModelMenuSection[];
}

export function buildModelPickerSections(input: ModelPickerSectionsInput): ModelPickerSections {
  const {
    orgMode, accountModels, selection, switches, autoOn, follows, selectedVariantLabel,
    fallback, instances, selectable, viewerLocal, keepRow, autoPreview, autoRecord, profile,
    botModelInstance, botModelName, health, myEngines, ranOnName, favoriteKeys = [],
  } = input;

  // An engine's models under two headings. Local: models on this machine
  // (solo) or on the person's own computer (organization server), and a
  // local server's models (`server::model`). Cloud: everything else the
  // engine offers. On an organization server the server's own custom models
  // are never listed, except an OpenAI-compatible server's own list
  // (2026-10-30: Azure AI Foundry, vLLM, a gateway: what its /models
  // answers is that provider's catalog, not a model typed on this machine).
  // A signed-out engine (solo) offers its local models only: its cloud ones
  // wait for the sign-in.
  const catalogOf = (instance: InstanceInfo) => {
    const options = instance.models.options;
    const localRows = localModelRows(options, orgMode);
    const localIds = new Set(localRows.map((option) => option.id));
    const isLocal = (option: ModelOption) => localIds.has(option.id) || Boolean(option.custom && option.id.includes("::"));
    // The person's own session lists fewer models than the server's catalog
    // (#1154): a model it cannot run is not offered, except the one already
    // picked, which stays and says so (modelRow's warning).
    const mine = orgMode ? accountModels.get(instance.instanceId) : undefined;
    const runnable = (option: ModelOption) => (!mine || option.custom || mine.has(option.id)
      || (instance.instanceId === selection.instanceId && option.id === selection.model))
      // 2026-10-30 (lot 2): a model turned off (Settings > Models, or the
      // organization in Perspicax) is listed nowhere, except the one picked
      && (modelOn(switches, instance.instanceId, option.id) || (instance.instanceId === selection.instanceId && option.id === selection.model));
    const endpointList = instance.driverKind === "openai-compat";
    // #2963: a Perspicax model server's models (pi, `px-org-*` / `px-own-*`)
    // are offered everywhere: the server resolves their key per turn.
    const offered = (orgMode ? options.filter((option) => !option.custom || isDesktopModelId(option.id)
      || isModelServerOption(option)
      // #3085: a pi model a key of the person (or the organization's) pays for
      || option.keyPaid === true
      || (endpointList && !option.local && !option.id.includes("::"))) : options).filter(runnable);
    const localOptions = offered.filter(isLocal);
    const signInFirst = !orgMode && needsSignIn(instance);
    const cloudOf = (list: ModelOption[]) => (signInFirst ? list.filter(isModelServerOption) : list);
    const unavailable = (id: string): string | undefined => {
      if (!localIds.has(id)) return undefined;
      const reason = localRowUnavailable(instance.driverKind, id, localRows.find((option) => option.id === id)?.anthropic);
      if (!reason) return undefined;
      return reason === "anthropic" ? t("model.localUnavailable.anthropic") : t("model.localUnavailable.engine", { engine: instance.displayName });
    };
    return {
      cloud: cloudOf(offered.filter((option) => !isLocal(option))),
      // Loaded local models first, as the old local list did.
      local: [...localOptions.filter((option) => option.loaded), ...localOptions.filter((option) => !option.loaded)],
      unavailable,
    };
  };

  // A row reads "name" then, muted, what a pick would run it with: the
  // effort kept on the same engine, the variant of the current model, Fast.
  // #4329: the provider's heading names where the model comes from (a
  // vendor, a server, this computer), so the row does not. In a thread, the bot's own model is the
  // row above the engines ("<bot>'s model"), not a tag here.
  // The effort shown is the one a pick would run (Cursor's "Grok 4.7 High"):
  // the level kept when this model takes it, else the model's own default.
  // A folded row (`twin`) stands for a model and its fast twin and says
  // Fast while the bot runs the twin.
  const modelRow = (instance: InstanceInfo, option: ModelOption, local: boolean, unavailable: string | undefined, twin?: ModelOption): ModelMenuRow => {
    const sameEngine = instance.instanceId === selection.instanceId;
    const onTwin = Boolean(twin && sameEngine && selection.model === twin.id);
    const runs = onTwin && twin ? twin : option;
    const current = !autoOn && follows !== true && sameEngine && selection.model === runs.id;
    const variant = sameEngine && selection.model === runs.id ? selectedVariantLabel : undefined;
    // The engine ran the last turn on another model than this pick: say so on the row.
    const ranOn = sameEngine && fallback?.requested === runs.id ? fallback : undefined;
    const mine = orgMode ? accountModels.get(instance.instanceId) : undefined;
    const notMine = Boolean(mine && !option.custom && !mine.has(runs.id));
    // #1154: the model the person's turns use instead (the server's same rule).
    const insteadId = notMine && mine ? equivalentOfferedModel(runs.id, [...mine]) : null;
    const instead = insteadId ? instance.models.options.find((o) => o.id === insteadId)?.label ?? insteadId : null;
    const levels = instance.capabilities?.effortLevels;
    const effortLevel = instance.capabilities?.modelVariants ? undefined
      : effortForModel(sameEngine ? selection.effort : undefined, runs, levels) ?? modelDefaultEffort(runs, levels);
    const runsWith = [variant ?? (effortLevel ? effortLabel(effortLevel) : undefined), onTwin ? t("model.fastTag") : undefined].filter(Boolean).join(" ");
    const detail = runsWith || undefined;
    return {
      key: favoriteKey(instance.instanceId, option.id),
      kind: "model",
      instanceId: instance.instanceId,
      modelId: runs.id,
      label: option.label,
      detail,
      subtext: local ? localModelSubtext(option) : undefined,
      title: [option.label, detail, runs.id].filter(Boolean).join(" · "),
      tags: [
        option.id === instance.models.default ? t("model.defaultTag") : undefined,
        option.loaded ? t("model.loadedTag") : undefined,
      ].filter((tag): tag is string => Boolean(tag)),
      current,
      unavailable,
      ...(ranOn ? { warning: t("model.ranOn", { model: ranOnName(ranOn) }) }
        : notMine ? { warning: instead ? t("model.notOnAccountRunsOn", { model: instead }) : t("model.notOnAccount") } : {}),
      keywords: [instance.displayName, twin?.label, twin?.id].filter(Boolean).join(" "),
    };
  };
  // A fast twin rides its model's row (the menu has the Fast switch).
  const rowsOf = (instance: InstanceInfo) => {
    const catalog = catalogOf(instance);
    const options = instance.models.options;
    const shown = (option: ModelOption) => !fastBaseOf(options, option.id);
    const twinOf = (option: ModelOption) => {
      const id = fastTwinOf(options, option.id);
      return id ? options.find((candidate) => candidate.id === id) : undefined;
    };
    return {
      cloud: catalog.cloud.filter(shown).map((option) => modelRow(instance, option, false, undefined, twinOf(option))),
      local: catalog.local.filter(shown).map((option) => modelRow(instance, option, true, catalog.unavailable(option.id), twinOf(option))),
    };
  };

  // The rows above the engines: Auto (the bot's choice; a shared bot's
  // viewer pins their own model, the owner's Auto stays the owner's) and,
  // in a thread, the bot's own model. #2106: Auto's detail names the
  // Optimize preference (Intelligence / Balance / Cost).
  const autoShown = autoPreview ?? autoRecord;
  const optimize = autoOptimizeOf(selection.autoOptimize);
  const autoDetail = autoOn
    ? (autoShown ? `${t(`model.auto.optimize.${optimize}`)} · ${autoShown.modelLabel}` : t(`model.auto.optimize.${optimize}`))
    : t("model.auto.rowHint");
  const topRows: ModelMenuRow[] = [
    ...(keepRow ? [keepRow] : []),
    ...(!viewerLocal ? [{
      key: "auto", kind: "auto" as const, label: t("model.auto.label"), current: autoOn,
      detail: autoDetail,
    }] : []),
    ...(follows !== undefined ? [{
      key: "follow", kind: "follow" as const, label: t("model.useBotModel", { name: profile.name }),
      detail: modelLabel(botModelInstance, profile.modelSelection.model), keywords: botModelName, current: follows,
      warning: botModelInstance && !modelUsable(botModelInstance, profile.modelSelection.model, health) ? t("model.notResponding") : undefined,
    }] : []),
  ];

  // The menu lists every engine the bot can use: its own first, then the
  // others the server allows. An engine to install or blocked by a policy
  // stays out; on an organization server an engine nothing pays for yet
  // stays out too, unless it is the bot's.
  const menuInstances = [
    ...selectable.filter((instance) => instance.instanceId === selection.instanceId),
    ...selectable.filter((instance) => instance.instanceId !== selection.instanceId),
  ].filter((instance) => {
    if (instance.policy || needsCli(instance)) return false;
    if (!orgMode || instance.instanceId === selection.instanceId) return true;
    const engine = myEngines?.find((candidate) => candidate.instanceId === instance.instanceId);
    return !engine || orgEngineState(engine) === "connected";
  });
  // The bot's own engine when it cannot run (not installed, blocked): the
  // composer's menu still shows the model in use, with its warning.
  const currentEngineHidden = autoOn || follows === true ? [] : selectable.filter((instance) =>
    instance.instanceId === selection.instanceId && !menuInstances.includes(instance) && !engineRuns(instance, health));
  const engines = [...currentEngineHidden, ...menuInstances];

  // #4329 lot 3: the menu is grouped by provider (shared/model-provider.ts,
  // the one grouping), in the provider catalog's order. Each engine's rows
  // land under the provider that gives the model: a vendor's tool and its
  // API key under the vendor, a pi or OpenCode row under the vendor before
  // the slash of its id, a server added by address under its own name, a
  // model of this computer under "This computer" whatever engine runs it.
  // The accounts and engines of one provider are pooled: one model is one
  // row, the others ride on it as its alternatives ("Runs with").
  const order = providerCatalog({ instances: engines, place: orgMode ? "organization" : "solo" }).providers.map((provider) => provider.id);
  const computer: ProviderRef = { id: COMPUTER_PROVIDER_ID, label: t("model.computerProvider"), kind: "computer" };
  const localTag = t("model.localGroup");
  interface Pool { ref: ProviderRef; models: Map<string, ModelMenuRow[]>; instances: InstanceInfo[] }
  const pools = new Map<string, Pool>();
  // the vendor's own engines first, so a model reads as its vendor names it
  const byRole = [...engines].sort((a, b) => Number(splitEngine(a.driverKind)) - Number(splitEngine(b.driverKind)));
  for (const instance of byRole) {
    const { cloud, local } = rowsOf(instance);
    const rows = [...cloud, ...local];
    const localKeys = new Set(local.map((row) => row.key));
    const ownCurrent = !autoOn && follows !== true && instance.instanceId === selection.instanceId;
    const runsOf = (row: ModelMenuRow) => row.modelId !== undefined && modelUsable(instance, row.modelId, health);
    // The menu lists only the models that can run a turn now
    // (src/lib/model-health.ts, 2026-10-14). The model in use stays,
    // checked, saying it does not respond.
    const shown = rows.filter((row) => (row.current && ownCurrent) || runsOf(row));
    if (ownCurrent && !shown.some((row) => row.current)) {
      // a signed-out engine's catalog drops its cloud models: the one in use comes back
      const option = instance.models.options.find((candidate) => candidate.id === selection.model);
      if (option) shown.unshift(modelRow(instance, option, false, undefined));
    }
    for (const row of shown) {
      const marked = row.current && !runsOf(row) ? { ...row, warning: t("model.notResponding") } : row;
      const option = instance.models.options.find((candidate) => favoriteKey(instance.instanceId, candidate.id) === row.key)
        ?? instance.models.options.find((candidate) => candidate.id === row.modelId)
        ?? { id: row.modelId ?? row.key, label: row.label };
      const isLocal = localKeys.has(row.key);
      const ref = isLocal ? computer : providerOfModel(instance, option);
      const id = isLocal ? option.id : canonicalModelId(instance, option);
      let pool = pools.get(ref.id);
      if (!pool) {
        pool = { ref, models: new Map(), instances: [] };
        pools.set(ref.id, pool);
      }
      if (!pool.instances.includes(instance)) pool.instances.push(instance);
      // the provider's heading already says Local
      const entry: ModelMenuRow = { ...marked, harness: instance.driverKind,
        ...(isLocal ? { tags: marked.tags?.filter((tag) => tag !== localTag && tag.toLowerCase() !== "local") } : {}) };
      const same = pool.models.get(id);
      if (same) same.push(entry);
      else pool.models.set(id, [entry]);
    }
  }
  // The row a model is drawn with: the one in use, else the one on the bot's
  // engine, else one on the same kind of engine (a pick keeps what runs the
  // bot), else the vendor's own engine.
  const selectedDriver = instances.find((instance) => instance.instanceId === selection.instanceId)?.driverKind;
  const lead = (candidates: readonly ModelMenuRow[]): ModelMenuRow =>
    candidates.find((row) => row.current)
      ?? candidates.find((row) => row.instanceId === selection.instanceId)
      ?? (selectedDriver ? candidates.find((row) => row.harness === selectedDriver) : undefined)
      ?? candidates[0]!;
  const rank = (id: string) => {
    const at = order.indexOf(id);
    return at < 0 ? order.length : at;
  };
  const providerSections: ModelMenuSection[] = [...pools.values()]
    .sort((a, b) => rank(a.ref.id) - rank(b.ref.id))
    .map((pool) => ({
      key: pool.ref.id,
      label: pool.ref.label,
      // every engine behind it waits for a sign-in
      note: pool.instances.every((instance) => needsSignIn(instance)) ? t("model.signInRequired") : undefined,
      rows: [...pool.models.values()].map((candidates) => {
        const shownRow = lead(candidates);
        const others = candidates.filter((row) => row !== shownRow);
        if (others.length === 0) return shownRow;
        return {
          ...shownRow,
          alternatives: others,
          keywords: [shownRow.keywords, ...others.map((row) => row.keywords)].filter(Boolean).join(" "),
        };
      }),
    }))
    .filter((section) => section.rows.length > 0);

  // #2106: Favorites sit under Auto in the same list. A model starred on
  // an engine now pooled under another row still shows, as starred.
  const shownRows = providerSections.flatMap((section) => section.rows);
  const pooledRows = shownRows.flatMap((row) => row.alternatives ?? []);
  const favoriteRows = favoriteKeys.flatMap((key) => [...shownRows, ...pooledRows].filter((row) => row.key === key).slice(0, 1));
  const menuSections: ModelMenuSection[] = [
    { key: "top", rows: topRows },
    ...(favoriteRows.length > 0 ? [{ key: "favorites", label: t("model.favorites"), rows: favoriteRows }] : []),
    ...providerSections,
  ];

  return { menuSections };
}
