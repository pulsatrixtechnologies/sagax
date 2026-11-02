// Model: which provider/model this bot runs on, and how hard it thinks.
// Moved from SettingsPanel.tsx (~835-881). The pill keeps the profile row
// (`contained`) and opens the same modal as the composer chip. An in-flow
// menu is clipped by this sidebar.
import { useAdvancedMode } from "@/lib/interface-mode";
import { EffortRow, ModelPicker } from "../ModelPicker";
import { X } from "lucide-react";
import { canEditBotField } from "@/lib/bot-capabilities";
import { CompactRow, HelpTip, PillSelect, SettingsGroup } from "../SettingsPrimitives";
import { t } from "@/lib/i18n";
import { engineLabel } from "@/lib/human-label";
import { fallbackWithModel } from "../../../shared/handoff-model";
import { currentTaskBot, useStore, visibleMessages, type Bot } from "@/state/store";
import { pendingApprovals } from "../PendingApproval";
import { engineOfferContext, useOfferedInstances } from "@/lib/offered-instances";
import { engineOffer } from "../../../shared/offered-engines";
import { useMyEngines, usePerspicaxOrg } from "@/lib/perspicax-org";
import { botWithViewerSettings, useViewerBotOverride, viewerLocalBotSettings } from "@/lib/viewer-bot-overrides";
import { useBotEditor } from "./BotEditorContext";
import { botRecovery } from "@/lib/bot-runtime-settings";
import { BotRecoverySettings } from "./BotRecoverySettings";
import { BotPayerSettings } from "./BotPayerSettings";
import { BotHostSettings } from "./BotHostSettings";

export function ModelSection({ bot }: { bot: Bot }) {
  const advanced = useAdvancedMode();
  const { state, dispatch } = useStore();
  const { draft, bulk } = useBotEditor();
  const viewerLocal = viewerLocalBotSettings(state.config, bot);
  const override = useViewerBotOverride(bot.id, viewerLocal);
  const viewerShown = viewerLocal ? botWithViewerSettings(bot, override) : bot;
  // 2026-10-19: the model waits only for the turn the server waits for (the
  // viewer's selected thread, checkedModelSelection), never for another
  // conversation of the bot: a bot-to-bot one waiting on a card locked the
  // field with nothing to act on.
  const turn = modelTurnLock(bot);
  const shown = { ...viewerShown, busy: turn.busy };
  const modelVariants = state.instances.find((instance) => instance.instanceId === shown.modelSelection.instanceId)?.capabilities?.modelVariants;
  const effortTitle = modelVariants ? t("botPanel.model.reasoning") : t("botPanel.model.effort");
  // Says what the app does, not what the engine ends up at: Codex applies a
  // level to the whole thread and has no way to take one back, so
  // "currently: engine default" was a promise we could not keep for a
  // thread that had already been sent one. Sending nothing is true on
  // every engine.
  const effortHelp = viewerLocal
    ? t("botPanel.model.forYou")
    : modelVariants
      ? (draft && !bulk ? t("botPanel.model.reasoningStart") : t("botPanel.model.reasoningGroups"))
      : `${t("botPanel.model.effortHelp")}${shown.modelSelection.effort ? "" : t("botPanel.model.effortDefault")}`;
  // 2026-10-16 : drawn like Settings: one group of rows (the model's
  // pill, the effort's pill menu), then recovery and backups as groups.
  return (
    <div className="flex flex-col gap-5">
      <SettingsGroup title={t("botSettings.nav.model")} groupId="botModel">
        {!draft && <BotHostSettings bot={bot} />}
        {bot.host?.kind === "machine" ? null : <div className="px-3.5 py-2.5">
          <ModelPicker
            bot={shown}
            contained
            viewerLocal={viewerLocal}
            label={
              <div>
                <div className="text-[13px] leading-[18px] text-ink">{t("botPanel.model.default")}</div>
                {(viewerLocal || (draft && !bulk)) && <div className="mt-0.5 text-[12px] leading-4 text-ink-secondary">
                  {viewerLocal ? t("botPanel.model.forYou") : t("botPanel.model.starting")}
                </div>}
              </div>
            }
          />
          {!draft && turn.busy && <ModelLockLine bot={bot} lock={turn} />}
        </div>}
        {/* Share the model picker's effort choices, but edit the profile
            default. Simple keeps the saved effort and does not show it. */}
        {bot.host?.kind !== "machine" && advanced && <EffortRow
          bot={shown}
          viewerLocal={viewerLocal}
          pill={{ label: effortTitle, help: effortHelp }}
          className="px-3.5 py-2.5"
          label={
            <div>
              <div className="text-[13px] leading-[18px] text-ink">{effortTitle}</div>
              <div className="mt-0.5 text-[12px] leading-4 text-ink-secondary">{effortHelp}</div>
            </div>
          }
        />}
      </SettingsGroup>
      {/* #1137: who pays for this bot's replies (organization server, the
          owner or an admin; Simple and Advanced). */}
      {bot.host?.kind !== "machine" && !draft && bot.turnPayerDefault && canEditBotField(state.config, bot, "automaticRecovery") && <BotPayerSettings key={`payer:${bot.id}`} bot={bot} />}
      {/* 2026-10-15: this bot's automatic recovery (it was Settings >
          General > Advanced for every bot), then its ordered backups. */}
      {bot.host?.kind !== "machine" && advanced && !draft && canEditBotField(state.config, bot, "automaticRecovery") && <BotRecoverySettings key={`recovery:${bot.id}`} bot={bot} />}
      {bot.host?.kind !== "machine" && advanced && !draft && botRecovery(bot, state.config).enabled && canEditBotField(state.config, bot, "fallback") && <FallbackChain bot={bot} onChange={(fallback) => dispatch({ type: "updateBot", botId: bot.id, patch: { fallback } })} />}
      {!draft && state.config?.cacheKeepWarm && (
        <KeepWarmRow bot={bot} workspaceOn={state.config.cacheKeepWarm.enabled}
          onChange={(cacheKeepWarm) => dispatch({ type: "updateBot", botId: bot.id, patch: { cacheKeepWarm } })} />
      )}
    </div>
  );
}

/** Prompt-cache keep-warm for this bot: follow the workspace, or override it. */
function KeepWarmRow({ bot, workspaceOn, onChange }: { bot: Bot; workspaceOn: boolean; onChange: (value: boolean | null) => void }) {
  const value = bot.cacheKeepWarm === true ? "on" : bot.cacheKeepWarm === false ? "off" : "follow";
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-card p-4">
      <div className="min-w-0">
        <label htmlFor="bot-cache-keepwarm" className="text-[15px] font-medium text-ink">{t("bot.keepWarm.title")}</label>
        <div className="mt-0.5 text-[13px] text-ink-secondary">{t("bot.keepWarm.help")}</div>
      </div>
      <select id="bot-cache-keepwarm" value={value}
        onChange={(event) => onChange(event.target.value === "on" ? true : event.target.value === "off" ? false : null)}
        className="shrink-0 cursor-pointer rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink">
        <option value="follow">{t("bot.keepWarm.follow", { state: t(workspaceOn ? "bot.keepWarm.on" : "bot.keepWarm.off") })}</option>
        <option value="on">{t("bot.keepWarm.on")}</option>
        <option value="off">{t("bot.keepWarm.off")}</option>
      </select>
    </div>
  );
}

export interface ModelTurnLock {
  busy: boolean;
  /** Why: an approval waits on the person, an admin, or a turn runs. */
  reason?: "approval" | "admin" | "working";
}

/** Whether the bot's model waits for a turn, and why (the viewer's selected
 * thread only, as the server checks it). */
export function modelTurnLock(bot: Bot): ModelTurnLock {
  const selected = currentTaskBot(bot);
  const busy = selected.busy === true;
  if (!busy) return { busy: false };
  if (selected.activity !== "waiting-on-you") return { busy, reason: "working" };
  const open = pendingApprovals(visibleMessages(bot));
  const admin = open.length > 0 && open.every((pending) => Boolean(pending.message.card?.adminApproval));
  return { busy, reason: admin ? "admin" : "approval" };
}

/** Says why the model is locked, with the way out: back to the selected
 * conversation, where the card waits (or the turn can be stopped). */
function ModelLockLine({ bot, lock }: { bot: Bot; lock: ModelTurnLock }) {
  const { dispatch } = useStore();
  const open = () => {
    dispatch({ type: "toggleSettings", open: false });
    dispatch({ type: "select", id: bot.id });
  };
  const line = lock.reason === "admin" ? t("botPanel.model.lockedAdmin")
    : lock.reason === "approval" ? t("botPanel.model.lockedApproval")
      : t("botPanel.model.lockedWorking");
  return (
    <p data-model-lock={lock.reason} role="status" className="mt-2 text-[12px] leading-4 text-ink-secondary">
      {line}{" "}
      <button type="button" onClick={open} className="underline underline-offset-2 hover:text-ink">
        {t("botPanel.model.lockedOpen")}
      </button>
    </p>
  );
}

/** Ordered backups use the same opt-in, proven-before-start recovery as
 * the workspace backup. They change only the failed thread's model. */
function FallbackChain({ bot, onChange }: { bot: Bot; onChange: (fallback: Bot["fallback"]) => void }) {
  const { state } = useStore();
  const offered = useOfferedInstances();
  const org = usePerspicaxOrg();
  const mine = useMyEngines();
  const offerContext = engineOfferContext(state.config, org !== null, mine);
  // a backup on an engine the organization no longer offers is not shown
  // (the server skips it too) and leaves the chain at the next change; one
  // the person pays for themselves stays when the organization lets own
  // accounts through (#1098, 2026-10-30)
  const chain = (bot.fallback ?? []).filter((entry) => {
    const offer = engineOffer(offerContext, entry.instanceId);
    return offer === "offered" || (offer === "notGiven" && mine?.find((row) => row.instanceId === entry.instanceId)?.orgNotAllowed !== true);
  });
  // only engines offered to this person (src/lib/offered-instances.ts)
  const available = offered.filter(
    (instance) =>
      instance.snapshot.state === "available" &&
      Boolean(instance.models.default.trim()) &&
      instance.instanceId !== bot.modelSelection.instanceId &&
      !chain.some((entry) => entry.instanceId === instance.instanceId),
  );
  const nameOf = (instanceId: string) => engineLabel(state.instances.find((instance) => instance.instanceId === instanceId)?.displayName, instanceId);

  const add = (instanceId: string) => {
    const instance = state.instances.find((candidate) => candidate.instanceId === instanceId);
    if (!instance || !instance.models.default.trim() || chain.length >= 5 || !available.includes(instance)) return;
    onChange([...chain, { instanceId, model: instance.models.default }]);
  };

  const title = t("botPanel.model.backups");
  return (
    <SettingsGroup
      title={title}
      groupId="botBackups"
      accessory={<HelpTip label={t("settings.moreAbout", { title })}>{t("botPanel.model.backupsHelp")}</HelpTip>}
    >
      {chain.map((entry, index) => {
        const models = state.instances.find((instance) => instance.instanceId === entry.instanceId)?.models.options ?? [];
        const allowed = models.map((model) => model.id);
        return (
        <CompactRow key={entry.instanceId} label={`${index + 1}. ${nameOf(entry.instanceId)}`}>
          <PillSelect
            value={entry.model}
            ariaLabel={t("botPanel.model.backupModel")}
            onChange={(model) => {
              const next = fallbackWithModel(chain, entry.instanceId, model, allowed.length ? allowed : [model]);
              if (next) onChange(next);
            }}
            options={[
              ...(allowed.includes(entry.model) ? [] : [{ value: entry.model, label: entry.model }]),
              ...models.map((model) => ({ value: model.id, label: model.label })),
            ]}
          />
          <button
            type="button"
            onClick={() => onChange(chain.filter((candidate) => candidate.instanceId !== entry.instanceId))}
            aria-label={t("botPanel.model.removeFallback", { name: nameOf(entry.instanceId) })}
            className="ui-icon-button shrink-0"
          >
            <X size={13} aria-hidden="true" />
          </button>
        </CompactRow>
        );
      })}
      {chain.length < 5 && (
        <CompactRow label={t("botPanel.model.addFallback")}>
          <PillSelect
            value=""
            ariaLabel={t("botPanel.model.addFallback")}
            disabled={available.length === 0}
            onChange={add}
            options={[
              { value: "", label: available.length === 0 ? t("botPanel.model.noEngine") : t("botPanel.model.addEngine"), disabled: true },
              ...available.map((instance) => ({ value: instance.instanceId, label: instance.displayName })),
            ]}
          />
        </CompactRow>
      )}
    </SettingsGroup>
  );
}
