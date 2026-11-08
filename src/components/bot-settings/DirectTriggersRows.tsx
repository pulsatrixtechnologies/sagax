import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { Bot } from "@/state/store";
import { DIRECT_CHANNELS, DIRECT_FILTERS_MAX, type DirectChannel, type DirectTriggers } from "../../../shared/direct-triggers";
import { DescribedRow, FIELD, PLAIN_FIELD, Switch, useSettingsSurface } from "../SettingsPrimitives";

/** #2691: one row per direct channel (email, calendar invitation, text),
 * under the Proactive row. The switch shows whether the channel wakes the
 * bot now; a channel never set follows the Proactive switch. When it wakes,
 * one line of filters narrows what does. */
export function DirectTriggersRows({ bot, proactiveOn, patch }: {
  bot: Bot;
  proactiveOn: boolean;
  patch: (value: { directTriggers: DirectTriggers }) => void;
}) {
  const triggers = bot.directTriggers ?? {};
  const set = (channel: DirectChannel, next: { on: boolean; filters?: string }) => {
    const filters = next.filters?.trim();
    patch({ directTriggers: { ...triggers, [channel]: filters ? { on: next.on, filters } : { on: next.on } } });
  };
  return (
    <>
      {DIRECT_CHANNELS.map((channel) => {
        const setting = triggers[channel];
        const on = setting ? setting.on : proactiveOn;
        const label = t(`botPanel.permissions.direct.${channel}` as LocaleKey);
        return (
          <DescribedRow
            key={channel}
            label={label}
            help={t("botPanel.permissions.direct.help")}
            description={t(`botPanel.permissions.direct.${channel}.hint` as LocaleKey)}
            rowId={`directTriggers.${channel}`}
            keywords={t("botPanel.permissions.direct.keywords")}
            below={on ? (
              <FiltersField
                label={t("botPanel.permissions.direct.filters", { channel: label })}
                value={setting?.filters ?? ""}
                disabled={Boolean(bot.busy)}
                onCommit={(filters) => set(channel, { on: true, filters })}
              />
            ) : undefined}
          >
            <Switch
              checked={on}
              aria-label={label}
              disabled={Boolean(bot.busy)}
              onClick={() => set(channel, { on: !on, filters: setting?.filters })}
            />
          </DescribedRow>
        );
      })}
    </>
  );
}

function FiltersField({ label, value, disabled, onCommit }: { label: string; value: string; disabled: boolean; onCommit: (value: string) => void }) {
  const plain = useSettingsSurface() === "plain";
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() !== value.trim()) onCommit(draft);
  };
  return (
    <input
      className={`${plain ? PLAIN_FIELD : FIELD} mt-2`}
      value={draft}
      maxLength={DIRECT_FILTERS_MAX}
      disabled={disabled}
      aria-label={label}
      placeholder={t("botPanel.permissions.direct.filtersPlaceholder")}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}
