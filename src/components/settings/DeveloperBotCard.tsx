/**
 * Settings > Developer > Per bot (#2658, lot 2 of #2636). The technical
 * cards of the bot page V6 live here only: working folder, tool selection,
 * webhooks (and their tokens), the event subscriptions (#2700), the always-allowed list, the memory's daily
 * logs and embeddings endpoint, and the export as zip. One bot at a time,
 * picked in the first row; the bot page's Advanced sub-page keeps one
 * discreet link that opens this card on that bot (requestDeveloperBot).
 */
import { useEffect, useState } from "react";

import { useConfirm } from "@/components/ConfirmProvider";
import { downloadBotZip, showBotZipExport } from "@/lib/bot-zip";
import { takeDeveloperBot, useDeveloperBotRequest } from "@/lib/developer-bot-request";
import { t } from "@/lib/i18n";
import {
  deleteMemoryDoc,
  fetchMemoryOverview,
  fetchSemanticRecallStatus,
  semanticRecallConfig,
  type MemoryFileInfo,
  type MemoryOverview,
  type SemanticRecallStatus,
} from "@/lib/memory";
import { readableError } from "@/lib/plain-error";
import { api, useStore, type Bot, type ConfigStatus } from "@/state/store";

import { AlwaysAllowedCard, WorkingFolder } from "../bot-settings/AccessSection";
import { BotEventSubscriptions } from "../bot-settings/BotEventSubscriptions";
import { BotWebhooks, canManageBotWebhooks } from "../bot-settings/BotWebhooks";
import { MemoryFileRows, MemoryGauge, SemanticRecallCard } from "../bot-settings/MemorySectionParts";
import { PaneSection } from "../bot-settings/PaneSection";
import { ToolSelectionCard } from "../bot-settings/ToolSelectionCard";
import { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import { CompactRow, DescribedRow, PillSelect, PRIMARY_PILL, SettingsGroup, Switch } from "../SettingsPrimitives";
import { canEditConfig } from "@/lib/viewer";

export function DeveloperBotCard() {
  const { state } = useStore();
  const bots = state.bots.filter((bot) => !bot.hidden);
  const requested = useDeveloperBotRequest();
  const [chosen, setChosen] = useState<string | null>(null);
  // The bot page's link names a bot: show it and clear the request.
  useEffect(() => {
    if (!requested) return;
    setChosen(requested);
    takeDeveloperBot();
  }, [requested]);
  const wanted = requested ?? chosen;
  const bot = (wanted && bots.find((candidate) => candidate.id === wanted)) || bots[0];
  return (
    <div data-settings-card="developer.bot" className="flex flex-col gap-6">
      <SettingsGroup title={t("settings.developer.bot")} groupId="developerBot">
        <CompactRow label={t("settings.developer.botPick")} rowId="developerBotPick" keywords={t("settings.developer.botKeywords")}>
          <div data-developer-bot-picker="">
            {bots.length === 0 ? (
              <span className="text-[13px] text-ink-secondary">{t("settings.developer.noBot")}</span>
            ) : (
              <PillSelect
                value={bot!.id}
                options={bots.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
                onChange={setChosen}
                ariaLabel={t("settings.developer.botPick")}
              />
            )}
          </div>
        </CompactRow>
      </SettingsGroup>
      {bot && <DeveloperBotSections key={bot.id} bot={bot} />}
    </div>
  );
}

/** The chosen bot's technical cards, each under its own grey label. */
function DeveloperBotSections({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const derived = useBotSettingsDerived(bot);
  return (
    <>
      <WorkingFolder bot={bot} />
      <ToolSelectionCard bot={bot} engineKind={derived.engine?.driverKind} />
      {canManageBotWebhooks(state.config, bot) && <BotWebhooks bot={bot} />}
      {canManageBotWebhooks(state.config, bot) && <BotEventSubscriptions bot={bot} />}
      <AlwaysAllowedCard bot={bot} patch={derived.patch} />
      {bot.memoryEnabled !== false && <DeveloperMemoryCards bot={bot} />}
      {showBotZipExport(state.config, bot) && <BotZipExportCard bot={bot} />}
    </>
  );
}

/** The memory's technical side: the size gauge, the daily logs (the bot's
 * own record, deleted here, read on the Memory page) and the embeddings
 * endpoint of recall by meaning. */
function DeveloperMemoryCards({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const confirm = useConfirm();
  const [overview, setOverview] = useState<MemoryOverview | null>(null);
  const [semantic, setSemantic] = useState<SemanticRecallStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void fetchMemoryOverview(bot.id).then((next) => { if (live) setOverview(next); }).catch((e) => { if (live) setError(readableError(e)); });
    void fetchSemanticRecallStatus(bot.id).then((next) => { if (live) setSemantic(next); }).catch(() => {});
    return () => { live = false; };
  }, [bot.id]);
  const openMemoryPage = () => {
    dispatch({ type: "toggleAppSettings", open: false });
    dispatch({ type: "toggleMemoryManager", open: true });
  };
  const remove = async (file: MemoryFileInfo) => {
    if (!(await confirm({
      title: t("botPanel.memory.confirmDelete", { name: file.name }),
      confirmLabel: t("common.delete"),
      tone: "danger",
    }))) return;
    setError(null);
    try {
      const { overview: next } = await deleteMemoryDoc(bot.id, file.path);
      setOverview(next);
    } catch (e) {
      setError(readableError(e));
    }
  };
  return (
    <>
      <PaneSection data-developer-memory-logs="" title={t("botPanel.memory.logs")} help={t("botPanel.memory.logsHint")}>
        {overview && <div className="mb-3"><MemoryGauge index={overview.index} /></div>}
        <MemoryFileRows
          files={overview?.logs ?? []}
          empty={overview ? t("botPanel.memory.noneYet") : t("botPanel.loading")}
          onOpen={openMemoryPage}
          onDelete={(file) => void remove(file)}
        />
        {error && <p role="alert" className="mt-2 text-[12.5px] text-danger">{error}</p>}
      </PaneSection>
      {semantic && (
        <SemanticRecallCard
          status={semantic}
          config={semanticRecallConfig(state.config)}
          editable={canEditConfig(state.config)}
          onSave={async (patch) => {
            const config = await api<ConfigStatus>("/api/config", { method: "PATCH", body: JSON.stringify({ memory: patch }) });
            dispatch({ type: "configStatus", config });
            setSemantic(await fetchSemanticRecallStatus(bot.id).catch(() => null));
          }}
        />
      )}
    </>
  );
}

/** Export the bot as a .sagaxbot.zip: what to include, then the download
 * (was a popover under the bot's "..." menu). */
export function BotZipExportCard({ bot }: { bot: Bot }) {
  const [withConversations, setWithConversations] = useState(false);
  const [withSharing, setWithSharing] = useState(false);
  const [exported, setExported] = useState(false);
  const shared = (bot.grants?.length ?? 0) > 0 || bot.visibility !== undefined;
  return (
    <SettingsGroup title={t("botZip.export")} groupId="developerBotZip">
      <DescribedRow label={t("botZip.includeConversations")} description={t("botZip.includeConversationsHint")} rowId="botZipConversations">
        <Switch checked={withConversations} onClick={() => setWithConversations((value) => !value)} aria-label={t("botZip.includeConversations")} data-bot-zip-conversations="" />
      </DescribedRow>
      {shared && (
        <CompactRow label={t("botZip.includeSharing")} rowId="botZipSharing">
          <Switch checked={withSharing} onClick={() => setWithSharing((value) => !value)} aria-label={t("botZip.includeSharing")} data-bot-zip-sharing="" />
        </CompactRow>
      )}
      <DescribedRow label={t("botZip.download")} description={exported ? t("botZip.exportStarted") : t("botZip.exportBody", { name: bot.name })} rowId="botZipDownload">
        <button
          type="button"
          data-bot-zip-download=""
          onClick={() => { downloadBotZip(bot.id, { conversations: withConversations, sharing: shared && withSharing }); setExported(true); }}
          className={PRIMARY_PILL}
        >
          {t("botZip.download")}
        </button>
      </DescribedRow>
    </SettingsGroup>
  );
}
