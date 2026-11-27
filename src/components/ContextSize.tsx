// #4417: "Context size", one control in three places: the model menu's line
// (ModelMenuSettings.tsx), a provider's page, Models section
// (settings/ProviderPage.tsx), and the bot's Model tab
// (bot-settings/ModelSection.tsx). It writes only the bot's `contextWindow`
// (PATCH /api/bots/:id, through the store's bot patch) and the person's
// `contextByProvider` (PUT /api/me/models); the bot's next turn runs at the
// size in force. Drawn only with a choice to make. The values and their
// words come from src/lib/context-size.ts.
import { useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { useOfferedInstances } from "@/lib/offered-instances";
import { botChoosesContextSize, botContextSizes, contextSizeShown, providerContextSizes, saveContextDefault, useContextDefaults, type ContextSizeChoice } from "@/lib/context-size";
import { ChoiceLine } from "./MenuChoiceLine";
import { PillSelect } from "./SettingsPrimitives";

export { contextSizeShown, type ContextSizeChoice };

type ContextSizeProps =
  /** The model menu's line: its value at the right, the choices open under it. */
  | { tone: "menu"; choices: readonly ContextSizeChoice[]; disabled?: boolean; open: boolean; onToggle: () => void; onPicked?: () => void }
  /** A settings row: the reference's pill menu. */
  | { tone: "settings"; choices: readonly ContextSizeChoice[]; disabled?: boolean; ariaLabel?: string };

export function ContextSize(props: ContextSizeProps) {
  const { choices } = props;
  if (!contextSizeShown(choices)) return null;
  const current = choices.find((choice) => choice.current);
  if (props.tone === "menu") {
    return (
      <div data-context-size="menu">
        <ChoiceLine label={t("model.contextSize")} value={current?.label ?? ""}
          open={props.open} disabled={Boolean(props.disabled)} onToggle={props.onToggle}
          choices={choices.map((choice) => ({
            key: choice.key,
            label: choice.label,
            current: choice.current,
            onPick: () => {
              if (!choice.current) choice.onPick();
              props.onPicked?.();
            },
          }))}
          dataName="context-size" />
      </div>
    );
  }
  return (
    <div data-context-size="settings" data-context-size-value={current?.key}>
      <PillSelect
        value={current?.key}
        ariaLabel={props.ariaLabel ?? t("model.contextSize")}
        disabled={props.disabled}
        onChange={(key) => choices.find((choice) => choice.key === key)?.onPick()}
        options={choices.map((choice) => ({ value: choice.key, label: choice.label }))}
      />
    </div>
  );
}

/** A pick of a bot's "Context size": the bot's own choice, through the
 * store's bot patch (PATCH /api/bots/:id). */
export function pickBotContextSize(dispatch: ReturnType<typeof useStore>["dispatch"], botId: string): (size: number | null) => void {
  return (contextWindow) => dispatch({ type: "updateBot", botId, patch: { contextWindow } });
}

/** "Context size" of one of the person's bots. No state of its own: the bot
 * and the person's defaults are the state. */
export function useBotContextSizes(bot: Pick<Bot, "id" | "modelSelection" | "contextWindow">): ContextSizeChoice[] {
  const { dispatch } = useStore();
  // the bot's own engine stays, even one the organization hid (D-20261126-018)
  const instances = useOfferedInstances("pick", bot.modelSelection.instanceId);
  const { defaults } = useContextDefaults(botChoosesContextSize(instances, bot.modelSelection));
  return botContextSizes({ instances, selection: bot.modelSelection, chosen: bot.contextWindow, defaults, onPick: pickBotContextSize(dispatch, bot.id) });
}

/** The person's default for one provider (Models section of its page). */
export function useProviderContextSizes(providerId: string): { choices: ContextSizeChoice[]; busy: boolean; error: string | null } {
  const instances = useOfferedInstances("settings");
  const { defaults, busy, error } = useContextDefaults();
  const choices = providerContextSizes({ instances, providerId, defaults, onPick: (size) => { void saveContextDefault(providerId, size); } });
  return { choices, busy, error };
}
