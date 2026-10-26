// Automatic recovery of this bot (JC 2026-10-15, formerly Settings > General
// > Advanced for every bot): whether a backup model takes over when its
// provider fails before starting, and which one. Its ordered backups
// (FallbackChain in ModelSection) win over this backup when it has some.
// Owner or admin (server/routes/bot-runtime-settings.ts).
import { useState } from "react";

import { t } from "@/lib/i18n";
import { engineLabel } from "@/lib/human-label";
import { botRecovery, type BotRecovery } from "@/lib/bot-runtime-settings";
import { useStore, type Bot } from "@/state/store";
import { useOfferedInstances } from "@/lib/offered-instances";
import { CompactRow, DescribedRow, HelpTip, PillSelect, PRIMARY_PILL, SettingsGroup, Switch } from "../SettingsPrimitives";
import { useBotRuntimeSettings } from "./useBotRuntimeSettings";

export function BotRecoverySettings({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const { shown, save, saving, error } = useBotRuntimeSettings(bot);
  const [draft, setDraft] = useState<BotRecovery | null>(null);
  const value = draft ?? botRecovery(shown, state.config);
  // only engines offered to this person (src/lib/offered-instances.ts)
  const engines = useOfferedInstances().filter((instance) => instance.snapshot.state === "available" && !instance.policy);
  const engine = engines.find((instance) => instance.instanceId === value.backup?.instanceId);
  const models = engine?.models.options.filter((model) => engine.snapshot.authenticated !== false || model.custom) ?? [];
  const ready = models.some((model) => model.id === value.backup?.model);
  const submit = async () => {
    if (!draft || saving || (draft.enabled && !ready)) return;
    const body: BotRecovery = { enabled: draft.enabled, ...(draft.backup?.model ? { backup: draft.backup } : {}) };
    if (await save({ automaticRecovery: body })) setDraft(null);
  };
  const title = t("settings.recovery.title");
  // 2026-10-16 (JC): drawn like Settings: the switch, the backup provider
  // and model as pill menus, Save as a pill; the detail behind the info
  // buttons.
  return (
    <div data-bot-recovery="">
      <SettingsGroup
        title={title}
        groupId="botRecovery"
        accessory={<HelpTip label={t("settings.moreAbout", { title })}>{t("settings.recovery.scope")}</HelpTip>}
      >
        <DescribedRow label={t("settings.recovery.enable")} help={t("settings.recovery.help")} rowId="botRecoveryEnabled">
          <Switch checked={value.enabled} disabled={saving}
            aria-label={t("settings.recovery.enable")}
            onClick={() => setDraft({ ...value, enabled: !value.enabled })} />
        </DescribedRow>
        <CompactRow label={t("settings.recovery.engine")} rowId="botRecoveryEngine">
          <PillSelect
            value={value.backup?.instanceId ?? ""}
            ariaLabel={t("settings.recovery.engine")}
            disabled={saving || !value.enabled}
            onChange={(next) => setDraft({ enabled: value.enabled, ...(next ? { backup: { instanceId: next, model: "" } } : {}) })}
            options={[
              { value: "", label: t("settings.recovery.chooseEngine") },
              ...(value.backup && !engine ? [{ value: value.backup.instanceId, label: t("settings.recovery.unavailable", { name: engineLabel(null, value.backup.instanceId) }), disabled: true }] : []),
              ...engines.map((instance) => ({
                value: instance.instanceId,
                label: instance.displayName,
                disabled: !instance.models.options.some((model) => instance.snapshot.authenticated !== false || model.custom),
              })),
            ]}
          />
        </CompactRow>
        <DescribedRow label={t("settings.recovery.model")} help={t("settings.recovery.charges")} rowId="botRecoveryModel">
          <PillSelect
            value={value.backup?.model ?? ""}
            ariaLabel={t("settings.recovery.model")}
            disabled={saving || !value.enabled || !engine}
            onChange={(next) => setDraft({ enabled: value.enabled, backup: { instanceId: engine!.instanceId, model: next } })}
            options={[
              { value: "", label: t("settings.recovery.chooseModel") },
              ...(value.backup?.model && !ready ? [{ value: value.backup.model, label: t("settings.recovery.unavailable", { name: value.backup.model }), disabled: true }] : []),
              ...models.map((model) => ({ value: model.id, label: model.label })),
            ]}
          />
        </DescribedRow>
        <div className="flex flex-wrap items-center justify-end gap-3 px-3.5 py-2">
          {value.enabled && !ready && <p className="mr-auto text-[12px] text-ink-secondary">{t("settings.recovery.required")}</p>}
          <button type="button" disabled={!draft || saving || (value.enabled && !ready)} onClick={() => void submit()}
            className={PRIMARY_PILL}>{saving ? t("settings.threads.saving") : t("common.save")}</button>
        </div>
        {error && <p role="alert" className="px-3.5 pb-2 text-[12px] text-danger">{error}</p>}
      </SettingsGroup>
    </div>
  );
}
