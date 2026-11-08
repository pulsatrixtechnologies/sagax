// #2669: import an installed plugin's agents as a new team, from the team map,
// with the person's own session (POST /api/teams/import-plugin). Same right
// DetailPanel and settings primitives as TeamDialog: pick the plugin, name the
// team, see every bot with its model and tool limit, import in one click.
import { viewerActorId } from "@/lib/viewer";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot as BotIcon } from "lucide-react";
import { api, useStore, type Bot, type Group } from "@/state/store";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { createTeam, type TeamWriteContext } from "@/lib/team-writes";
import { readableError } from "@/lib/plain-error";
import { DetailPanel } from "./DetailPanel";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { FIELD, FieldRow, HelpTip, PILL, PRIMARY_PILL, SettingsGroup, GROUP_CARD } from "./SettingsPrimitives";

interface MarketPlugin { name: string; installed?: boolean; description?: string }
interface Market { name: string; plugins?: MarketPlugin[] }
export interface PluginTeamPreviewBot {
  name: string;
  description?: string;
  modelAsked?: string;
  model?: string;
  tools: string[];
  toolsEnforced: boolean;
  notes: string[];
}
interface Preview { team: string; bots: PluginTeamPreviewBot[]; skipped?: string[] }

/** "marketplace/plugin" of every installed plugin, in list order. */
export function installedPluginChoices(markets: readonly Market[]): Array<{ marketplace: string; plugin: string }> {
  return markets.flatMap((market) => (market.plugins ?? []).filter((plugin) => plugin.installed).map((plugin) => ({ marketplace: market.name, plugin: plugin.name })));
}

/** The bot's model line: what runs it, and what the plugin asked when that differs. */
export function previewModelLine(bot: PluginTeamPreviewBot): string {
  if (!bot.model) return bot.modelAsked ? t("pluginTeam.modelUnmatched", { model: bot.modelAsked }) : t("pluginTeam.modelDefault");
  return bot.model;
}

export function PluginTeamImportDialog({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const orgMode = usePerspicaxOrg() !== null;
  const viewerId = viewerActorId(state.config);
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [choice, setChoice] = useState("");
  const [team, setTeam] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const choices = useMemo(() => installedPluginChoices(markets ?? []), [markets]);
  const picked = choices.find((entry) => `${entry.marketplace}/${entry.plugin}` === choice);

  useEffect(() => {
    let live = true;
    api("/api/marketplaces")
      .then((result) => { if (live) setMarkets(result.marketplaces ?? []); })
      .catch((cause) => { if (live) { setMarkets([]); setError(readableError(cause)); } });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    bodyRef.current?.querySelector<HTMLElement>("select")?.focus();
  }, [markets]);

  // The preview follows the plugin and the team name: bots, models, tools.
  useEffect(() => {
    if (!picked) { setPreview(null); return; }
    let live = true;
    setLoadingPreview(true);
    setError("");
    const handle = setTimeout(() => {
      api("/api/teams/import-plugin", { method: "POST", body: JSON.stringify({ marketplace: picked.marketplace, plugin: picked.plugin, ...(team.trim() ? { team: team.trim() } : {}), preview: true }) })
        .then((result: Preview) => { if (live) setPreview(result); })
        .catch((cause) => { if (live) { setPreview(null); setError(readableError(cause)); } })
        .finally(() => { if (live) setLoadingPreview(false); });
    }, 250);
    return () => { live = false; clearTimeout(handle); };
  }, [picked?.marketplace, picked?.plugin, team]);

  const runImport = async () => {
    if (!picked || !preview?.bots.length || importing) return;
    setImporting(true);
    setError("");
    try {
      const response = await api("/api/teams/import-plugin", { method: "POST", body: JSON.stringify({ marketplace: picked.marketplace, plugin: picked.plugin, ...(team.trim() ? { team: team.trim() } : {}) }) }) as { bots?: Bot[]; groups?: Group[]; section?: string };
      for (const bot of response.bots ?? []) dispatch({ type: "botAdded", bot });
      for (const group of response.groups ?? []) dispatch({ type: "groupPatched", group });
      const section = response.section ?? preview.team;
      // On an organization server a team is one of the person's own sections.
      if (orgMode && section) {
        const context: TeamWriteContext = { orgMode, dispatch, viewerId, bots: state.bots, serverSections: state.sections ?? [] };
        await createTeam(context, section, (response.bots ?? []).map((bot) => bot.id));
      }
      onClose();
    } catch (cause) {
      setError(readableError(cause));
      setImporting(false);
    }
  };

  const title = t("pluginTeam.title");
  const ready = Boolean(picked && preview?.bots.length && !loadingPreview);
  return (
    <DetailPanel
      label={title}
      title={title}
      onClose={() => { if (!importing) onClose(); }}
      closeLabel={t("team.closeDialog")}
      data-plugin-team-import=""
      footer={
        <>
          <button type="button" disabled={importing} onClick={onClose} className={`${PILL} ml-auto`}>{t("common.cancel")}</button>
          <button type="button" disabled={!ready || importing} onClick={() => void runImport()} className={PRIMARY_PILL}>
            {importing ? t("pluginTeam.importing") : preview?.bots.length ? t(preview.bots.length === 1 ? "pluginTeam.importOne" : "pluginTeam.importMany", { count: preview.bots.length }) : t("pluginTeam.import")}
          </button>
        </>
      }
    >
      <div ref={bodyRef} className="flex flex-col gap-5">
        <SettingsGroup groupId="plugin-team-source" title={t("pluginTeam.source")} plain>
        <div className={GROUP_CARD}>
          <FieldRow label={t("pluginTeam.plugin")}>
            <select value={choice} disabled={importing || markets === null} aria-label={t("pluginTeam.plugin")} onChange={(event) => setChoice(event.target.value)} className={cn(FIELD, "min-w-0")}>
              <option value="">{markets === null ? t("pluginTeam.loading") : choices.length ? t("pluginTeam.pick") : t("pluginTeam.none")}</option>
              {choices.map((entry) => {
                const key = `${entry.marketplace}/${entry.plugin}`;
                return <option key={key} value={key}>{entry.plugin} ({entry.marketplace})</option>;
              })}
            </select>
          </FieldRow>
          <FieldRow label={t("team.name")}>
            <input
              value={team}
              maxLength={60}
              disabled={importing || !picked}
              placeholder={preview?.team ?? ""}
              onChange={(event) => setTeam(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void runImport(); }}
              className={FIELD}
            />
          </FieldRow>
        </div>
        </SettingsGroup>
        {picked && (
          <SettingsGroup
            groupId="plugin-team-bots"
            title={t("pluginTeam.bots")}
            accessory={
              <>
                <HelpTip label={t("settings.moreAbout", { title: t("pluginTeam.bots") })}>{t("pluginTeam.intro")}</HelpTip>
                {preview && <span className="ml-auto text-[12.5px] tabular-nums text-ink-secondary">{preview.bots.length}</span>}
              </>
            }
          >
            <div className="flex flex-col gap-0.5 px-1.5" data-plugin-team-preview="">
              {loadingPreview && !preview && <div className="px-2 py-4 text-center text-[13px] text-ink-secondary">{t("pluginTeam.loading")}</div>}
              {preview && preview.bots.length === 0 && <div className="px-2 py-4 text-center text-[13px] text-ink-secondary">{t("pluginTeam.noAgents")}</div>}
              {preview?.bots.map((bot) => (
                <div key={bot.name} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5" data-plugin-team-bot="">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary"><BotIcon size={15} aria-hidden="true" /></span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[14px] text-ink">{bot.name}</span>
                    <span className="truncate text-[12.5px] text-ink-secondary">{t("pluginTeam.model", { model: previewModelLine(bot) })}</span>
                    <span className="truncate text-[12.5px] text-ink-secondary" title={bot.notes.join("\n") || undefined}>
                      {bot.tools.length ? t(bot.toolsEnforced ? "pluginTeam.toolsLimited" : "pluginTeam.toolsGuided", { tools: bot.tools.join(", ") }) : t("pluginTeam.toolsAll")}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </SettingsGroup>
        )}
        {error && <p role="alert" className={cn("px-1 text-[12.5px] text-danger")}>{error}</p>}
      </div>
    </DetailPanel>
  );
}
