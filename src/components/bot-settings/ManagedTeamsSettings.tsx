import { useState } from "react";
import { t } from "@/lib/i18n";
import { InlineFold } from "../SettingsPrimitives";

export function ManagedTeamsSettings({
  name, ownTeam, teams, allowed, onSave,
}: {
  name: string;
  ownTeam: string;
  teams: string[];
  allowed: string[];
  onSave: (teams: string[]) => void;
}) {
  const [selected, setSelected] = useState(allowed);
  const choices = [...new Set([...teams, ...allowed])].filter(team => team !== ownTeam).sort();
  const changed = JSON.stringify([...selected].sort()) !== JSON.stringify([...allowed].sort());
  return (
    <InlineFold className="mt-3 border-t border-hairline/40 pt-3" label={t("botPanel.teams.additional")}>
      <p className="mt-1 text-[12px] leading-4 text-ink-secondary">
        {t("botPanel.teams.help", { name })}
      </p>
      <fieldset className="mt-3 flex max-h-52 flex-col gap-2 overflow-y-auto">
        <legend className="sr-only">{t("botPanel.teams.legend", { name })}</legend>
        {choices.map(team => (
          <label key={team} className="flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" className="accent-accent" checked={selected.includes(team)}
              onChange={event => setSelected(current => event.target.checked
                ? [...current, team] : current.filter(value => value !== team))} />
            {team || t("sidebar.section.general")}
          </label>
        ))}
        {!choices.length && <p className="text-[13px] text-ink-secondary">{t("botPanel.teams.empty")}</p>}
      </fieldset>
      <button type="button" disabled={!changed} onClick={() => onSave(selected)}
        className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink disabled:opacity-40">
        {t("botPanel.teams.save")}
      </button>
    </InlineFold>
  );
}
