// #4329 lot 6 (#4384): "Runs with", what runs a bot with its provider, read
// off the provider catalog (shared/provider-catalog.ts) through the same
// functions the server's resolver writes with (shared/harness-choices.ts),
// so the screen lists exactly what a pick will run. Pure: the words, the
// order and the choices; src/components/RunsWith.tsx draws them and writes
// the data of #4382 (the bot's `harness`, the person's `harnessByProvider`).
import { HARNESS_TOOL_NAME, harnessRole, type HarnessPlace, type HarnessRole } from "../../shared/harness-matrix";
import { botHarnessView, providerHarnessView } from "../../shared/harness-choices";
import type { ModelSelection } from "../../shared/model-selection";
import { providerCatalog, type CatalogInstance } from "../../shared/provider-catalog";
import { t } from "./i18n";

/** One value of "Runs with". */
export interface RunsWithChoice {
  /** The engine (a driver kind). */
  key: string;
  /** The first-level word: "Its own tool", "pi", "OpenCode", "Built in". */
  label: string;
  /** One grey line in the opened list: the tool by its name, or what it is. */
  hint?: string;
  recommended?: boolean;
  current: boolean;
  onPick: () => void;
}

const ROLE_ORDER: readonly HarnessRole[] = ["own", "builtin", "pi", "opencode", "tool"];

/** A value as the opened list says it: "Its own tool (recommended)". */
export function runsWithOptionLabel(choice: Pick<RunsWithChoice, "label" | "recommended">): string {
  return choice.recommended ? t("model.runsWith.recommended", { value: choice.label }) : choice.label;
}

/** Drawn only with a choice to make: hidden where one value is possible. */
export function runsWithShown(choices: readonly RunsWithChoice[] | undefined): choices is readonly RunsWithChoice[] {
  return Boolean(choices && choices.length > 1);
}

/** The words of one engine for a provider (design of #4329, B5 and C): the
 * tool's name only in the grey line of the opened list. */
export function runsWithWords(harness: string, vendor: string | undefined): { label: string; hint?: string } {
  const tool = HARNESS_TOOL_NAME[harness] ?? harness;
  switch (harnessRole(harness, vendor)) {
    case "own": return { label: t("model.runsWith.own"), hint: t("model.runsWith.ownHint", { tool }) };
    case "builtin": return { label: t("model.runsWith.builtin"), hint: t("model.runsWith.builtinHint") };
    case "pi":
    case "opencode": return { label: tool, hint: t("model.runsWith.openHint") };
    default: return { label: tool };
  }
}

/** The choices in the person's order (own tool, built in, pi, OpenCode,
 * another tool). */
export function runsWithChoices({ harnesses, current, recommended, vendor, onPick }: {
  harnesses: readonly string[];
  current: string | null;
  recommended: string | null;
  vendor: string | undefined;
  onPick: (harness: string) => void;
}): RunsWithChoice[] {
  const rank = (harness: string) => ROLE_ORDER.indexOf(harnessRole(harness, vendor));
  return [...harnesses].sort((a, b) => rank(a) - rank(b)).map((harness) => {
    return {
      key: harness,
      ...runsWithWords(harness, vendor),
      recommended: harness === recommended,
      current: harness === current,
      onPick: () => onPick(harness),
    };
  });
}

/** The engines the catalog may count on: ready ones, and the bot's own even when it is not. */
function catalogOf(instances: readonly CatalogInstance[], place: HarnessPlace, keep?: string) {
  return providerCatalog({
    place,
    instances: instances.filter((instance) => instance.instanceId === keep
      || (instance.snapshot.state === "available" && instance.snapshot.authenticated !== false)),
  });
}

/** "Runs with" for a bot: the engines its model may run on here, the one
 * that runs it now checked (the bot's own choice while the server writes
 * it). Empty on Auto and for a model in no provider. */
export function botRunsWith({ instances, place, selection, chosen, onPick }: {
  instances: readonly CatalogInstance[];
  place: HarnessPlace;
  selection: Pick<ModelSelection, "instanceId" | "model" | "auto">;
  /** The bot's own choice (`bot.harness`). */
  chosen?: string | null;
  onPick: (harness: string) => void;
}): RunsWithChoice[] {
  if (selection.auto === true || !selection.instanceId || !selection.model) return [];
  const view = botHarnessView(catalogOf(instances, place, selection.instanceId), place, selection);
  if (!view) return [];
  const current = chosen && view.choices.includes(chosen) ? chosen : view.current;
  return runsWithChoices({ harnesses: view.choices, current, recommended: view.recommended, vendor: view.provider.id, onPick });
}

/** "Runs with" on a provider's page: the person's default for it (else
 * the recommended engine) checked, every engine one of its connections runs. */
export function providerRunsWith({ instances, place, providerId, defaults, onPick }: {
  instances: readonly CatalogInstance[];
  place: HarnessPlace;
  providerId: string;
  /** The person's `harnessByProvider` (GET /api/me/models). */
  defaults: Readonly<Record<string, string>>;
  onPick: (harness: string) => void;
}): RunsWithChoice[] {
  const view = providerHarnessView(catalogOf(instances, place), place, providerId);
  if (!view) return [];
  const saved = defaults[providerId];
  const current = saved && view.choices.includes(saved) ? saved : view.recommended;
  return runsWithChoices({ harnesses: view.choices, current, recommended: view.recommended, vendor: providerId, onPick });
}
