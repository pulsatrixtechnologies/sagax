// Model list sections for the picker window and composer menu (#1383).
import { localModelSubtext } from "@/lib/local-model-label";
import { isDesktopModelId, localModelRows, localRowUnavailable } from "@/lib/local-models";
import { modelOn } from "../../../shared/offered-models";
import { SIGN_IN_FAMILY_LABEL, signInFamily } from "@/lib/engine-rail";
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
  autoPreview: { modelLabel: string } | null | undefined;
  autoRecord: { modelLabel: string } | null | undefined;
  profile: Bot;
  botModelInstance: InstanceInfo | undefined;
  botModelName: string;
  health: { orgMode: boolean; myEngines: MyEnginesState };
  myEngines: MyEnginesState;
  ranOnName: (ran: { instanceId: string; actual: string; actualInstanceId?: string }) => string;
}

export interface ModelPickerSections {
  flatSections: ModelMenuSection[];
  menuSections: ModelMenuSection[];
}

export function buildModelPickerSections(input: ModelPickerSectionsInput): ModelPickerSections {
  const {
    orgMode, accountModels, selection, switches, autoOn, follows, selectedVariantLabel,
    fallback, instances, selectable, viewerLocal, autoPreview, autoRecord, profile,
    botModelInstance, botModelName, health, myEngines, ranOnName,
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
    const offered = (orgMode ? options.filter((option) => !option.custom || isDesktopModelId(option.id)
      || (endpointList && !option.local && !option.id.includes("::"))) : options).filter(runnable);
    const localOptions = offered.filter(isLocal);
    const signInFirst = !orgMode && needsSignIn(instance);
    const unavailable = (id: string): string | undefined => {
      if (!localIds.has(id)) return undefined;
      const reason = localRowUnavailable(instance.driverKind, id, localRows.find((option) => option.id === id)?.anthropic);
      if (!reason) return undefined;
      return reason === "anthropic" ? t("model.localUnavailable.anthropic") : t("model.localUnavailable.engine", { engine: instance.displayName });
    };
    return {
      official: options.filter((option) => !option.custom),
      cloud: signInFirst ? [] : offered.filter((option) => !isLocal(option)),
      // Loaded local models first, as the old local list did.
      local: [...localOptions.filter((option) => option.loaded), ...localOptions.filter((option) => !option.loaded)],
      signInFirst,
      unavailable,
    };
  };

  // A row reads "name" then, muted, what a pick would run it with: the
  // provider (OpenRouter), the effort kept on the same engine, the variant
  // of the current model, Local. In a thread, the bot's own model is the
  // row above the engines ("<bot>'s model"), not a tag here.
  // The effort shown is the one a pick would run (Cursor's "Grok 4.7 High"):
  // the level kept when this model takes it, else the model's own default.
  // A folded row (`twin`, the composer's menu) stands for a model and its
  // fast twin and says Fast while the bot runs the twin.
  const modelRow = (instance: InstanceInfo, option: ModelOption, local: boolean, unavailable: string | undefined, saysLocal: boolean, twin?: ModelOption): ModelMenuRow => {
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
    const detail = [option.provider, runsWith || undefined, local && saysLocal ? t("model.localGroup") : undefined].filter(Boolean).join(" · ") || undefined;
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
  // Under an engine's own heading a local model says Local; under Cloud
  // and Local headings (the window's engine mode) the heading says it.
  // `fold`: a fast twin rides its model's row (the composer's menu, which
  // has the Fast switch); the window lists both.
  const rowsOf = (instance: InstanceInfo, saysLocal: boolean, fold = false) => {
    const catalog = catalogOf(instance);
    const options = instance.models.options;
    const shown = (option: ModelOption) => !fold || !fastBaseOf(options, option.id);
    const twinOf = (option: ModelOption) => {
      const id = fold ? fastTwinOf(options, option.id) : undefined;
      return id ? options.find((candidate) => candidate.id === id) : undefined;
    };
    return {
      catalog,
      cloud: catalog.cloud.filter(shown).map((option) => modelRow(instance, option, false, undefined, saysLocal, twinOf(option))),
      local: catalog.local.filter(shown).map((option) => modelRow(instance, option, true, catalog.unavailable(option.id), saysLocal, twinOf(option))),
    };
  };

  // The rows above the engines: Auto (the bot's choice; a shared bot's
  // viewer pins their own model, the owner's Auto stays the owner's) and,
  // in a thread, the bot's own model.
  const autoShown = autoPreview ?? autoRecord;
  const topRows: ModelMenuRow[] = [
    ...(!viewerLocal ? [{
      key: "auto", kind: "auto" as const, label: t("model.auto.label"), current: autoOn,
      detail: autoOn && autoShown ? autoShown.modelLabel : t("model.auto.rowHint"),
    }] : []),
    ...(follows !== undefined ? [{
      key: "follow", kind: "follow" as const, label: t("model.useBotModel", { name: profile.name }),
      detail: modelLabel(botModelInstance, profile.modelSelection.model), keywords: botModelName, current: follows,
      warning: botModelInstance && !modelUsable(botModelInstance, profile.modelSelection.model, health) ? t("model.notResponding") : undefined,
    }] : []),
  ];

  // The menu and the window's Auto mode list every engine the bot can use:
  // its own first, then the others the server allows. An engine to install
  // or blocked by a policy stays in the window; on an organization server
  // an engine nothing pays for yet stays there too, unless it is the bot's.
  const engineLabel = (instance: InstanceInfo) => {
    const family = signInFamily(instance);
    return family && selectable.filter((candidate) => signInFamily(candidate) === family).length === 1
      ? SIGN_IN_FAMILY_LABEL[family] : instance.displayName;
  };
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
  // Models that run on this computer get their own section, whatever engine
  // runs them (2026-10-14): never mixed into "Claude" or another provider.
  const LOCAL_SECTION_KEY = "local:this-computer";
  // Every engine offers the same local models (DwarfStar through Claude, Grok,
  // Codex, pi...): list each model once. Rows come in engine order with the
  // bot's own engine first, so the first one kept is the engine already in use.
  // The "Local" tag goes: the section already says it. The label is the model
  // name alone (2026-10-26); a server shows only as a detail when two servers
  // of one computer share a name (`option.server`).
  const uniqueLocalRows = (rows: readonly ModelMenuRow[]): ModelMenuRow[] => {
    const seen = new Map<string, ModelMenuRow>();
    for (const row of rows) {
      const id = row.modelId ?? row.key;
      const kept = seen.get(id);
      if (kept && !(row.current && !kept.current)) continue;
      const localTag = t("model.localGroup");
      seen.set(id, {
        ...row,
        tags: row.tags?.filter((tag) => tag !== localTag && tag.toLowerCase() !== "local"),
      });
    }
    return [...seen.values()];
  };
  const sectionsOf = (fold: boolean): ModelMenuSection[] => {
    const localRows: ModelMenuRow[] = [];
    const engineSections = menuInstances.map((instance) => {
      const { catalog, cloud, local } = rowsOf(instance, true, fold);
      localRows.push(...local.filter((row) => Boolean(row.modelId && modelOn(switches, instance.instanceId, row.modelId) && modelUsable(instance, row.modelId, health) && !row.unavailable)));
      return { key: instance.instanceId, label: engineLabel(instance), note: catalog.signInFirst ? t("model.signInRequired") : undefined, rows: cloud };
    }).filter((section) => section.rows.length > 0 || section.note);
    return [
      { key: "top", rows: topRows },
      ...engineSections,
      ...(localRows.length > 0 ? [{ key: LOCAL_SECTION_KEY, label: t("model.localGroup"), rows: uniqueLocalRows(localRows) }] : []),
    ];
  };
  const allSections = sectionsOf(false);
  const flatSections = allSections.map((section) => ({ ...section, rows: section.rows.filter((row) => row.kind !== "model" || Boolean(row.instanceId && row.modelId && modelOn(switches, row.instanceId, row.modelId) && modelUsable(instances.find((instance) => instance.instanceId === row.instanceId)!, row.modelId, health) && !row.unavailable)) })).filter((section) => section.rows.length > 0);
  // The composer's menu lists only the models that can run a turn now
  // (src/lib/model-health.ts, 2026-10-14): a provider left with none
  // goes. The model in use stays, checked, saying it does not respond.
  const menuLocalRows: ModelMenuRow[] = [];
  const menuSections: ModelMenuSection[] = [
    { key: "top", rows: topRows },
    ...[...currentEngineHidden, ...menuInstances].map((instance) => {
      const { cloud, local } = rowsOf(instance, true, true);
      const rows = [...cloud, ...local];
      const localKeys = new Set(local.map((row) => row.key));
      const ownCurrent = !autoOn && follows !== true && instance.instanceId === selection.instanceId;
      const runsOf = (row: ModelMenuRow) => row.modelId !== undefined && modelUsable(instance, row.modelId, health);
      const shown = rows.filter((row) => (row.current && ownCurrent) || runsOf(row));
      if (ownCurrent && !shown.some((row) => row.current)) {
        // a signed-out engine's catalog drops its cloud models: the one in use comes back
        const option = instance.models.options.find((candidate) => candidate.id === selection.model);
        if (option) shown.unshift(modelRow(instance, option, false, undefined, true));
      }
      const marked = shown.map((row) => (row.current && !runsOf(row) ? { ...row, warning: t("model.notResponding") } : row));
      menuLocalRows.push(...marked.filter((row) => localKeys.has(row.key)));
      return {
        key: instance.instanceId,
        label: engineLabel(instance),
        rows: marked.filter((row) => !localKeys.has(row.key)),
      };
    }).filter((section) => section.rows.length > 0),
  ];
  if (menuLocalRows.length > 0) menuSections.push({ key: LOCAL_SECTION_KEY, label: t("model.localGroup"), rows: uniqueLocalRows(menuLocalRows) });

  return { flatSections, menuSections };
}
