// Bot > Model (#2050, #2080): three cards. "Model": where the bot runs
// (BotHostSettings, read-only when the organization decides), the model
// chip ("Model · Effort", the effort is picked in its menu). Who pays for
// replies lives once, in General > "Who pays for replies" (BotPayerCard).
// "If it fails": one switch and the
// effective backups (effectiveBackups, the same answer as Settings >
// Models): the bot's ordered list (bot.fallback, up to 5, which keeps the
// single backup of automaticRecovery in step as its first entry), else
// the server default, labelled; the Backup model picker stays editable and
// "Customize" copies the chain into the bot without changing it.
// "Advanced", a closed fold: the prompt cache.
import { ModelPicker } from "../ModelPicker";
import { ChevronDown, ChevronUp, Sparkles, X } from "lucide-react";
import { canEditBotField } from "@/lib/bot-capabilities";
import { CompactRow, DescribedRow, FoldRow, HelpTip, PILL, PillSelect, SettingsGroup, Switch, useSettingsSurface } from "../SettingsPrimitives";
import { cn } from "@/lib/cn";
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
import { botRecovery, effectiveBackups, type BotRecovery } from "@/lib/bot-runtime-settings";
import { useBotRuntimeSettings } from "./useBotRuntimeSettings";
import { BotHostSettings } from "./BotHostSettings";

type Backup = NonNullable<Bot["fallback"]>[number];

export function ModelSection({ bot }: { bot: Bot }) {
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
  const machine = bot.host?.kind === "machine";
  // the same rights as before: the switch and the single backup go with
  // automaticRecovery, the ordered list with fallback (shared/permissions.ts)
  const canSwitch = !draft && canEditBotField(state.config, bot, "automaticRecovery");
  const canOrder = !draft && canEditBotField(state.config, bot, "fallback");
  const keepWarm = !draft && Boolean(state.config?.cacheKeepWarm);
  const plain = useSettingsSurface() === "plain";
  return (
    <div className="flex flex-col gap-5">
      <SettingsGroup title={t("botSettings.nav.model")} groupId="botModel">
        {!draft && <BotHostSettings bot={bot} />}
        {machine ? null : <div className="px-3.5 py-2.5">
          <ModelPicker
            bot={shown}
            contained
            viewerLocal={viewerLocal}
            label={
              <div className={cn(plain && "flex items-start gap-2")}>
                {plain && <Sparkles aria-hidden="true" className="mt-px size-5 shrink-0 text-ink-secondary" />}
                <div className="min-w-0">
                  <div className="text-[13px] leading-[18px] text-ink">{t("botPanel.model.default")}</div>
                  {(viewerLocal || (draft && !bulk)) && <div className="mt-0.5 text-[12px] leading-4 text-ink-secondary">
                    {viewerLocal ? t("botPanel.model.forYou") : t("botPanel.model.starting")}
                  </div>}
                </div>
              </div>
            }
          />
          {!draft && turn.busy && <ModelLockLine bot={bot} lock={turn} />}
        </div>}
      </SettingsGroup>
      {!machine && (canSwitch || canOrder) && <IfItFailsCard key={`recovery:${bot.id}`} bot={bot} canSwitch={canSwitch} canOrder={canOrder} />}
      {keepWarm && (
        <div data-settings-card="botModel.advanced">
          <SettingsGroup title={t("botModel.advanced.title")} groupId="botModelAdvanced">
            <FoldRow cardId="botModel.advanced" label={t("botModel.advanced.title")} description={t("botModel.advanced.help")}>
              <div className="-mx-3.5 flex flex-col pt-1" data-bot-model-advanced="">
                <KeepWarmRow bot={bot} workspaceOn={state.config!.cacheKeepWarm!.enabled}
                  onChange={(cacheKeepWarm) => dispatch({ type: "updateBot", botId: bot.id, patch: { cacheKeepWarm } })} />
              </div>
            </FoldRow>
          </SettingsGroup>
        </div>
      )}
    </div>
  );
}

/** Prompt-cache keep-warm for this bot: follow the workspace, or override it. */
function KeepWarmRow({ bot, workspaceOn, onChange }: { bot: Bot; workspaceOn: boolean; onChange: (value: boolean | null) => void }) {
  const value = bot.cacheKeepWarm === true ? "on" : bot.cacheKeepWarm === false ? "off" : "follow";
  const title = t("bot.keepWarm.title");
  return (
    <DescribedRow label={title} description={t("bot.keepWarm.help")} rowId="botKeepWarm">
      <div data-bot-keep-warm={value}>
        <PillSelect<"follow" | "on" | "off">
          value={value}
          ariaLabel={title}
          onChange={(next) => onChange(next === "on" ? true : next === "off" ? false : null)}
          options={[
            { value: "follow", label: t("bot.keepWarm.follow", { state: t(workspaceOn ? "bot.keepWarm.on" : "bot.keepWarm.off") }) },
            { value: "on", label: t("bot.keepWarm.on") },
            { value: "off", label: t("bot.keepWarm.off") },
          ]}
        />
      </div>
    </DescribedRow>
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
  const plain = useSettingsSurface() === "plain";
  const open = () => {
    dispatch({ type: "toggleSettings", open: false });
    dispatch({ type: "select", id: bot.id });
  };
  const line = lock.reason === "admin" ? t("botPanel.model.lockedAdmin")
    : lock.reason === "approval" ? t("botPanel.model.lockedApproval")
      : t("botPanel.model.lockedWorking");
  return (
    <p data-model-lock={lock.reason} role="status" className={cn("mt-2 text-[12px] leading-4 text-ink-secondary", plain && "flex flex-wrap items-center gap-x-2 gap-y-1")}>
      {line}{" "}
      <button type="button" onClick={open} className={plain ? PILL : "underline underline-offset-2 hover:text-ink"}>
        {t("botPanel.model.lockedOpen")}
      </button>
    </p>
  );
}

/** The single backup the server keeps in step with the ordered list: its
 * first entry; off with no backup when the list is empty. */
export function recoveryFor(chain: readonly Backup[], enabled: boolean): BotRecovery {
  const first = chain[0];
  return first ? { enabled, backup: first } : { enabled: false };
}

const swap = (chain: readonly Backup[], from: number, to: number): Backup[] => {
  const next = [...chain];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
};

/** "If it fails": automatic recovery (automaticRecovery, server/routes/
 * bot-runtime-settings.ts) and the ordered backups (bot.fallback) as one
 * card. The server keeps both fields; the ordered backups win when there
 * are some, so every change to the list also rewrites the single backup
 * as its first entry. Only the failed thread's model changes. */
function IfItFailsCard({ bot, canSwitch, canOrder }: { bot: Bot; canSwitch: boolean; canOrder: boolean }) {
  const { state, dispatch } = useStore();
  const { shown, save, saving, error } = useBotRuntimeSettings(bot);
  const offered = useOfferedInstances();
  const org = usePerspicaxOrg();
  const mine = useMyEngines();
  const offerContext = engineOfferContext(state.config, org !== null, mine);
  const recovery = botRecovery(shown, state.config);
  // a backup on an engine the organization no longer offers is not shown
  // (the server skips it too) and leaves the chain at the next change; one
  // the person pays for themselves stays when the organization lets own
  // accounts through (#1098, 2026-10-30). #2080: the same answer as
  // Settings > Models, the server default included.
  const keep = (entry: Backup) => {
    const offer = engineOffer(offerContext, entry.instanceId);
    return offer === "offered" || (offer === "notGiven" && mine?.find((row) => row.instanceId === entry.instanceId)?.orgNotAllowed !== true);
  };
  const { chain, source } = effectiveBackups({ fallback: bot.fallback, automaticRecovery: shown.automaticRecovery }, state.config, keep);
  // Server / org default is labelled; the person can still pick the backup
  // model (and reorder) in place. "Customize" copies the chain into the bot
  // without changing it.
  const fromServer = source === "org";
  const editable = canOrder;
  // only engines offered to this person (src/lib/offered-instances.ts)
  const available = offered.filter(
    (instance) =>
      instance.snapshot.state === "available" &&
      Boolean(instance.models.default.trim()) &&
      instance.instanceId !== bot.modelSelection.instanceId &&
      !chain.some((entry) => entry.instanceId === instance.instanceId),
  );
  const nameOf = (instanceId: string) => engineLabel(state.instances.find((instance) => instance.instanceId === instanceId)?.displayName, instanceId);

  const commit = (next: Backup[]) => {
    dispatch({ type: "updateBot", botId: bot.id, patch: { fallback: next } });
    if (canSwitch) void save({ automaticRecovery: recoveryFor(next, recovery.enabled) });
  };
  const add = (instanceId: string) => {
    const instance = state.instances.find((candidate) => candidate.instanceId === instanceId);
    if (!instance || !instance.models.default.trim() || chain.length >= 5 || !available.includes(instance)) return;
    commit([...chain, { instanceId, model: instance.models.default }]);
  };
  const toggle = () => {
    if (saving) return;
    void save({ automaticRecovery: recoveryFor(chain, !recovery.enabled) });
  };

  const customize = () => {
    if (saving) return;
    dispatch({ type: "updateBot", botId: bot.id, patch: { fallback: chain } });
    if (canSwitch) void save({ automaticRecovery: recoveryFor(chain, recovery.enabled) });
  };

  const title = t("botModel.ifFails.title");
  const switchLabel = t("botModel.ifFails.switch");
  const noBackup = chain.length === 0;
  return (
    <div data-bot-recovery={recovery.enabled ? "on" : "off"}>
      <SettingsGroup
        title={title}
        groupId="botRecovery"
        accessory={
          <HelpTip label={t("settings.moreAbout", { title })}>
            <p>{t("settings.recovery.help")}</p>
            <p className="mt-1.5">{t("settings.recovery.scope")}</p>
            <p className="mt-1.5">{t("settings.recovery.charges")}</p>
          </HelpTip>
        }
      >
        <DescribedRow label={switchLabel} description={noBackup ? t("botModel.ifFails.addFirst") : t("botModel.ifFails.order")} rowId="botRecoveryEnabled">
          <Switch checked={recovery.enabled} disabled={saving || !canSwitch || (noBackup && !recovery.enabled)}
            aria-label={switchLabel} onClick={toggle} />
        </DescribedRow>
        {chain.map((entry, index) => {
          const models = state.instances.find((instance) => instance.instanceId === entry.instanceId)?.models.options ?? [];
          const allowed = models.map((model) => model.id);
          const name = nameOf(entry.instanceId);
          const modelLabel = models.find((model) => model.id === entry.model)?.label ?? entry.model;
          return (
            <CompactRow key={entry.instanceId} label={`${index + 1}. ${name}`} rowId={`botBackup.${index + 1}`}>
              {editable ? (
                <>
                  <PillSelect
                    value={entry.model}
                    ariaLabel={t("botPanel.model.backupModel")}
                    disabled={saving}
                    onChange={(model) => {
                      const next = fallbackWithModel(chain, entry.instanceId, model, allowed.length ? allowed : [model]);
                      if (next) commit(next);
                    }}
                    options={[
                      ...(allowed.includes(entry.model) ? [] : [{ value: entry.model, label: entry.model }]),
                      ...models.map((model) => ({ value: model.id, label: model.label })),
                    ]}
                  />
                  <button type="button" disabled={saving || index === 0} onClick={() => commit(swap(chain, index, index - 1))}
                    aria-label={t("botModel.ifFails.moveUp", { name })} className="ui-icon-button shrink-0" data-backup-move="up">
                    <ChevronUp size={13} aria-hidden="true" />
                  </button>
                  <button type="button" disabled={saving || index === chain.length - 1} onClick={() => commit(swap(chain, index, index + 1))}
                    aria-label={t("botModel.ifFails.moveDown", { name })} className="ui-icon-button shrink-0" data-backup-move="down">
                    <ChevronDown size={13} aria-hidden="true" />
                  </button>
                  <button type="button" disabled={saving} onClick={() => commit(chain.filter((candidate) => candidate.instanceId !== entry.instanceId))}
                    aria-label={t("botPanel.model.removeFallback", { name })} className="ui-icon-button shrink-0" data-backup-remove="">
                    <X size={13} aria-hidden="true" />
                  </button>
                </>
              ) : (
                <span className="truncate text-[13px] leading-[18px] text-ink-secondary">{modelLabel}</span>
              )}
            </CompactRow>
          );
        })}
        {fromServer && (
          <div data-settings-row="botBackup.default" className="flex min-h-[36px] items-center justify-between gap-5 px-3.5 pb-2">
            <span className="min-w-0 text-[12px] leading-4 text-ink-secondary">{t(org ? "botModel.recovery.fromOrg" : "botModel.recovery.fromServer")}</span>
            {canOrder && (
              <button type="button" className={PILL} disabled={saving} onClick={customize} data-backup-customize="">
                {t("botModel.recovery.customize")}
              </button>
            )}
          </div>
        )}
        {editable && chain.length < 5 && (
          <CompactRow label={t("botPanel.model.addFallback")} rowId="botBackup.add">
            <PillSelect
              value=""
              ariaLabel={t("botPanel.model.addFallback")}
              disabled={saving || available.length === 0}
              onChange={add}
              options={[
                { value: "", label: available.length === 0 ? t("botPanel.model.noEngine") : t("botPanel.model.addEngine"), disabled: true },
                ...available.map((instance) => ({ value: instance.instanceId, label: instance.displayName })),
              ]}
            />
          </CompactRow>
        )}
        {error && <p role="alert" className="px-3.5 pb-2 text-[12px] text-danger">{error}</p>}
      </SettingsGroup>
    </div>
  );
}
