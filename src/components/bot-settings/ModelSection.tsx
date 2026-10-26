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
import { currentTaskBot, useStore, visibleMessages, type Bot } from "@/state/store";
import { pendingApprovals } from "../PendingApproval";
import { engineOfferContext, useOfferedInstances } from "@/lib/offered-instances";
import { engineOffer } from "../../../shared/offered-engines";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { botWithViewerSettings, useViewerBotOverride, viewerLocalBotSettings } from "@/lib/viewer-bot-overrides";
import { useBotEditor } from "./BotEditorContext";
import { ThreadModelsLine } from "../ThreadModelsLine";
import { botRecovery } from "@/lib/bot-runtime-settings";
import { BotRecoverySettings } from "./BotRecoverySettings";

export function ModelSection({ bot }: { bot: Bot }) {
  const advanced = useAdvancedMode();
  const { state, dispatch } = useStore();
  const { draft } = useBotEditor();
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
      ? (draft ? t("botPanel.model.reasoningStart") : t("botPanel.model.reasoningGroups"))
      : `${t("botPanel.model.effortHelp")}${shown.modelSelection.effort ? "" : t("botPanel.model.effortDefault")}`;
  // 2026-10-16 (JC): drawn like Settings: one group of rows (the model's
  // pill, the effort's pill menu), then recovery and backups as groups.
  return (
    <div className="flex flex-col gap-5">
      <SettingsGroup title={t("botSettings.nav.model")} groupId="botModel">
        <div className="px-3.5 py-2.5">
          <ModelPicker
            bot={shown}
            contained
            viewerLocal={viewerLocal}
            label={
              <div>
                <div className="text-[13px] leading-[18px] text-ink">{t("botPanel.model.default")}</div>
                <div className="mt-0.5 text-[12px] leading-4 text-ink-secondary">
                  {viewerLocal ? t("botPanel.model.forYou") : draft ? t("botPanel.model.starting") : t("botPanel.model.groups")}
                </div>
              </div>
            }
          />
          {!draft && turn.busy && <ModelLockLine bot={bot} lock={turn} />}
          {/* Right below the picker, so it shows the moment the model changes. */}
          {!draft && <ThreadModelsLine bot={bot} className="mt-2" />}
        </div>
        {/* Share the model picker's effort choices, but edit the profile
            default. Simple keeps the saved effort and does not show it. */}
        {advanced && <EffortRow
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
      {/* 2026-10-15: this bot's automatic recovery (it was Settings >
          General > Advanced for every bot), then its ordered backups. */}
      {advanced && !draft && canEditBotField(state.config, bot, "automaticRecovery") && <BotRecoverySettings key={`recovery:${bot.id}`} bot={bot} />}
      {advanced && !draft && botRecovery(bot, state.config).enabled && canEditBotField(state.config, bot, "fallback") && <FallbackChain bot={bot} onChange={(fallback) => dispatch({ type: "updateBot", botId: bot.id, patch: { fallback } })} />}
      {advanced && !draft && state.config?.cacheKeepWarm && canEditBotField(state.config, bot, "cacheKeepWarm") && (
        <KeepWarmSettings bot={bot} workspaceOn={state.config.cacheKeepWarm.enabled}
          onChange={(cacheKeepWarm) => dispatch({ type: "updateBot", botId: bot.id, patch: { cacheKeepWarm } })} />
      )}
    </div>
  );
}

/** Prompt-cache keep-warm for this bot: follow the workspace, or override it.
 * One group with one pill menu, like the backups below it (one card level). */
function KeepWarmSettings({ bot, workspaceOn, onChange }: { bot: Bot; workspaceOn: boolean; onChange: (value: boolean | null) => void }) {
  const value = bot.cacheKeepWarm === true ? "on" : bot.cacheKeepWarm === false ? "off" : "follow";
  const title = t("bot.keepWarm.title");
  return (
    <SettingsGroup
      title={title}
      groupId="botKeepWarm"
      accessory={<HelpTip label={t("settings.moreAbout", { title })}>{t("bot.keepWarm.help")}</HelpTip>}
    >
      <CompactRow label={title}>
        <PillSelect
          value={value}
          ariaLabel={title}
          onChange={(next) => onChange(next === "on" ? true : next === "off" ? false : null)}
          options={[
            { value: "follow", label: t("bot.keepWarm.follow", { state: t(workspaceOn ? "bot.keepWarm.on" : "bot.keepWarm.off") }) },
            { value: "on", label: t("bot.keepWarm.on") },
            { value: "off", label: t("bot.keepWarm.off") },
          ]}
        />
      </CompactRow>
    </SettingsGroup>
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
  const offerContext = engineOfferContext(state.config, org !== null, null);
  // a backup on an engine the organization no longer offers is not shown
  // (the server skips it too) and leaves the chain at the next change
  const chain = (bot.fallback ?? []).filter((entry) => engineOffer(offerContext, entry.instanceId) !== "notAllowed");
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
      {chain.map((entry, index) => (
        <CompactRow key={entry.instanceId} label={`${index + 1}. ${nameOf(entry.instanceId)}`}>
          <span className="min-w-0 max-w-[180px] truncate text-[12px] text-ink-secondary">{entry.model}</span>
          <button
            type="button"
            onClick={() => onChange(chain.filter((candidate) => candidate.instanceId !== entry.instanceId))}
            aria-label={t("botPanel.model.removeFallback", { name: nameOf(entry.instanceId) })}
            className="ui-icon-button shrink-0"
          >
            <X size={13} aria-hidden="true" />
          </button>
        </CompactRow>
      ))}
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
