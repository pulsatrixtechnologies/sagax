// #4329 lot 6 (#4384): "Runs with", one control in four places: the model
// menu's line (ModelMenuSettings.tsx), a provider's page (ProviderPage.tsx),
// a bot's row of Settings > Models > Bot models (BotModelsSettings.tsx) and
// the bot's Model tab (bot-settings/ModelSection.tsx). It reads and writes
// only the data of #4382: the bot's `harness` (PATCH /api/bots/:id, through
// the store's bot patch) and the person's `harnessByProvider` (GET/PUT
// /api/me/models). The server resolves either into the bot's model; the
// next turn runs on it. Drawn only with a choice to make. The values and
// their words come from src/lib/runs-with.ts.
import { useEffect, useState } from "react";

import { api, useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { useOfferedInstances } from "@/lib/offered-instances";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { readableError } from "@/lib/plain-error";
import { botRunsWith, providerRunsWith, runsWithOptionLabel, runsWithShown, type RunsWithChoice } from "@/lib/runs-with";
import type { HarnessPlace } from "../../shared/harness-matrix";
import { ChoiceLine } from "./MenuChoiceLine";
import { PillSelect } from "./SettingsPrimitives";

export { runsWithShown, type RunsWithChoice };

type RunsWithProps =
  /** The model menu's line: its value at the right (the plain word), the
   * choices open under it. */
  | { tone: "menu"; choices: readonly RunsWithChoice[]; disabled?: boolean; open: boolean; onToggle: () => void; onPicked?: () => void }
  /** A settings row or a table cell: the reference's pill menu. */
  | { tone: "settings"; choices: readonly RunsWithChoice[]; disabled?: boolean; fill?: boolean; ariaLabel?: string };

export function RunsWith(props: RunsWithProps) {
  const { choices } = props;
  if (!runsWithShown(choices)) return null;
  const current = choices.find((choice) => choice.current);
  if (props.tone === "menu") {
    return (
      <div data-model-settings-runs-with="" data-runs-with="menu">
        <ChoiceLine label={t("model.runsWith")} value={current?.label ?? ""}
          open={props.open} disabled={Boolean(props.disabled)} onToggle={props.onToggle}
          choices={choices.map((choice) => ({
            key: choice.key,
            label: runsWithOptionLabel(choice),
            hint: choice.hint,
            current: choice.current,
            onPick: () => {
              if (!choice.current) choice.onPick();
              props.onPicked?.();
            },
          }))}
          dataName="runs-with" />
      </div>
    );
  }
  return (
    <div data-runs-with="settings" data-runs-with-value={current?.key} className={props.fill ? "min-w-0" : undefined}>
      <PillSelect
        value={current?.key}
        ariaLabel={props.ariaLabel ?? t("model.runsWith")}
        disabled={props.disabled}
        fill={props.fill}
        onChange={(key) => choices.find((choice) => choice.key === key)?.onPick()}
        // a table cell keeps the plain words: the provider's page says which is recommended
        options={choices.map((choice) => ({ value: choice.key, label: props.fill ? choice.label : runsWithOptionLabel(choice), hint: choice.hint }))}
      />
    </div>
  );
}

function usePlace(): HarnessPlace {
  return usePerspicaxOrg() !== null ? "organization" : "solo";
}

/** A pick of a bot's "Runs with": the bot's own choice, through the store's
 * bot patch (PATCH /api/bots/:id); the server moves its model to that engine. */
export function pickBotHarness(dispatch: ReturnType<typeof useStore>["dispatch"], botId: string): (harness: string) => void {
  return (harness) => dispatch({ type: "updateBot", botId, patch: { harness } });
}

/** "Runs with" of any of the person's bots (Bot models, a bot's Model tab):
 * the engines offered here that may run its model. No state of its own:
 * the bot is the state. */
export function useBotsRunsWith(): (bot: Pick<Bot, "id" | "modelSelection" | "harness">) => RunsWithChoice[] {
  const { state, dispatch } = useStore();
  // each bot keeps its own engine, even one the organization hid (D-20261126-018)
  const hidden = state.config?.hiddenEngines;
  const instances = useOfferedInstances("pick", hidden);
  const place = usePlace();
  return (bot) => botRunsWith({
    instances: hidden?.length ? instances.filter((instance) => !hidden.includes(instance.instanceId) || instance.instanceId === bot.modelSelection.instanceId) : instances,
    place, selection: bot.modelSelection, chosen: bot.harness, onPick: pickBotHarness(dispatch, bot.id),
  });
}

/** The person's default per provider ("Runs with" on a provider's page),
 * read from and saved to GET/PUT /api/me/models; the answer is kept as the
 * server gives it back. */
export function useProviderRunsWith(providerId: string): { choices: RunsWithChoice[]; busy: boolean; error: string | null } {
  const instances = useOfferedInstances("settings");
  const place = usePlace();
  const [defaults, setDefaults] = useState<Readonly<Record<string, string>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api<{ harnessByProvider?: Record<string, string> }>("/api/me/models")
      .then((answer) => { if (live) setDefaults(answer.harnessByProvider ?? {}); })
      .catch(() => { if (live) setDefaults({}); });
    return () => { live = false; };
  }, []);
  const save = (harness: string) => {
    setBusy(true);
    setError(null);
    api<{ harnessByProvider?: Record<string, string> }>("/api/me/models", { method: "PUT", body: JSON.stringify({ harnessByProvider: { [providerId]: harness } }) })
      .then((answer) => setDefaults(answer.harnessByProvider ?? {}))
      .catch((failure) => setError(readableError(failure)))
      .finally(() => setBusy(false));
  };
  // nothing drawn before the person's default is known: never a value that flips
  const choices = defaults === null ? [] : providerRunsWith({ instances, place, providerId, defaults, onPick: save });
  return { choices, busy, error };
}
