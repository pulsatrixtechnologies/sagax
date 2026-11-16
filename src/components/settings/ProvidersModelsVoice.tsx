// Settings > Providers, the cards between Accounts and Advanced (#4457, the
// owner 2026-11-16): Models (the defaults for new bots, Models and context
// size one page further, Generated conversation titles) and Voice (who
// speaks and who listens, Live calls one page further). Each row is moved
// from its former place, not rewritten.
import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { SettingsGroup } from "../SettingsPrimitives";
import { StatusText } from "./SettingsPatterns";
import { useSettingsPage } from "../SettingsSubPage";
import { NewBotDefaultsRow } from "./BotModelsSettings";
import { GeneratedTitlesRow } from "./ExperimentalSettings";
import { SubPageEntry } from "./sub-page-entry";
import { VoiceProviderSettings } from "./VoiceProviderSettings";

/** The state of the installation's live calls, on the Live calls row. */
function LiveCallsState() {
  const { state } = useStore();
  const live = state.config?.live;
  const on = Boolean(live?.enabled && live.configured);
  return <StatusText tone={on ? "success" : "neutral"}>{t(on ? "settings.card.on" : "settings.card.off")}</StatusText>;
}

export function ProvidersModelsVoice() {
  const scope = useSettingsPage();
  return (
    <>
      {scope.allowed("engines") && (
        <div data-settings-card="providers.models">
          <SettingsGroup title={t("settings.section.models")} groupId="providersModels">
            <NewBotDefaultsRow />
            <SubPageEntry id="providers.models" summary={t("settings.intro.engines")} />
            <GeneratedTitlesRow />
          </SettingsGroup>
        </div>
      )}
      {scope.allowed("voice") && (
        <VoiceProviderSettings
          title={t("settings.section.voice")}
          after={<SubPageEntry id="providers.voice" summary={<LiveCallsState />} />}
        />
      )}
    </>
  );
}
