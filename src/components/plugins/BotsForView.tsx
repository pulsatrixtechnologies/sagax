// Manage > an entry's "For which bots": one switch per bot of the person.
// On, the entry's MCP servers reach that bot; off, they leave its list (the
// same choice as the bot's own Access > MCP servers).
import { t } from "@/lib/i18n";
import { Switch } from "../SettingsPrimitives";
import type { Crumb } from "../Breadcrumb";
import { PluginPageHeader } from "./PluginParts";

export interface BotsForRow {
  id: string;
  name: string;
  on: boolean;
}

/** A bot's MCP list after switching `servers` on or off. `own` null means
 * every server switched on (`enabled`), and stays an explicit list once
 * changed, as the bot's Access does. */
export function botServersAfter(own: readonly string[] | null | undefined, enabled: readonly string[], servers: readonly string[], on: boolean): string[] {
  const current = own == null ? [...enabled] : [...own];
  if (on) return [...current, ...servers.filter((name) => !current.includes(name))];
  return current.filter((name) => !servers.includes(name));
}

/** Whether every server of the entry reaches the bot now. */
export function botUsesServers(own: readonly string[] | null | undefined, enabled: readonly string[], servers: readonly string[]): boolean {
  if (servers.length === 0) return false;
  const mounted = own == null ? enabled : enabled.filter((name) => own.includes(name));
  return servers.every((name) => mounted.includes(name));
}

export function BotsForView({ name, bots, busy, onToggle, onBack, trail }: {
  name: string;
  bots: BotsForRow[];
  busy?: boolean;
  onToggle: (botId: string, on: boolean) => void;
  onBack: () => void;
  trail?: readonly Crumb[];
}) {
  return (
    <>
      <PluginPageHeader title={t("connectApps.entry.botsTitle", { name })} trail={trail} onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-7 pt-3 sm:px-8" data-plugins-bots-for>
        <p className="mb-3 text-[12.5px] leading-relaxed text-ink-secondary">{t("connectApps.entry.botsIntro", { name })}</p>
        {bots.length === 0 ? (
          <p className="rounded-xl bg-inset px-4 py-3 text-[12.5px] text-ink-secondary">{t("connectApps.entry.botsNone")}</p>
        ) : (
          <ul className="divide-y divide-hairline/60 rounded-[14px] border-[0.5px] border-ink/10 bg-ink/[0.015]">
            {bots.map((bot) => (
              <li key={bot.id} className="flex min-h-[44px] items-center justify-between gap-3 px-4 py-2" data-bots-for={bot.id}>
                <span className="min-w-0 truncate text-[13px] text-ink">{bot.name}</span>
                <Switch checked={bot.on} disabled={busy} aria-label={t("connectApps.entry.botsSwitch", { name, bot: bot.name })} onClick={() => onToggle(bot.id, !bot.on)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
