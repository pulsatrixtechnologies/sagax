import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import { DomainRows, domainRows, useProactiveReceive } from "../settings/ProactiveReceiveSettings";
import { SettingsGroup } from "../SettingsPrimitives";

/** #3432: « Ce que ce bot suit pour toi », under the Proactive rows of the
 * bot's Permissions (a sibling of DirectTriggersRows): the person's
 * domains this bot can carry, each on when this bot carries it, with the
 * same rows and switches as Settings, Notifications, « Ce que je reçois ».
 * A yes here moves the domain to this bot; a domain this bot cannot carry
 * is not drawn, and with none the rows are not drawn. */
export function BotFollowsRows({ bot }: { bot: Bot }) {
  const { state: store } = useStore();
  const { state, setDomain, setWatch } = useProactiveReceive();
  if (!state) return null;
  const rows = domainRows(state, bot.id);
  if (!rows.length) return null;
  const bots = store.bots ?? [];
  return (
    <SettingsGroup title={t("botPanel.permissions.follows")} groupId="botFollows">
      {rows.map((row) => {
        const elsewhere = state.choices[row.domain]?.state === "on" ? state.choices[row.domain]?.botId : undefined;
        // only a bot that can still carry it follows it; a paused one is stated by the row
        const other = elsewhere && elsewhere !== bot.id && row.carriers.includes(elsewhere) ? bots.find((entry) => entry.id === elsewhere)?.name : undefined;
        return (
          <DomainRows key={row.domain} row={row} bots={bots} botPage
            note={other ? t("settings.receive.carriedBy", { name: other }) : undefined}
            onDomain={(on) => setDomain(row, on, bot.id)}
            onWatch={(watchId, on) => setWatch(row, watchId, on)} />
        );
      })}
    </SettingsGroup>
  );
}
