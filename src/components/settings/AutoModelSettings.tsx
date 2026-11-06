import { useState } from "react";
import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { useAutoModelStatus } from "@/lib/auto-model-preview";
import { autoReasonSentence } from "@/lib/auto-model";
import { DescribedRow, FoldRow, PillSelect, SettingsTextRow } from "../SettingsPrimitives";
import type { AutoModelPreview } from "../../../shared/auto-model";

const LIST = "flex flex-col gap-1 text-[12px] leading-4 text-ink-secondary";

/** Rows of the "What Auto would choose now" group (one card level, #2080):
 * the order Auto would follow, folded under a count pill with the reason of
 * the pick as its grey line, then what it left out and why. Only metadata
 * produced by the same candidate list as dispatch, no paid probe. */
export function AutoModelStatus({ status }: { status: AutoModelPreview | null }) {
  if (!status) return <div data-auto-model-status=""><SettingsTextRow live>{t("model.auto.chain.waiting")}</SettingsTextRow></div>;
  const chain = status.chain ?? [];
  const excluded = status.excluded ?? [];
  const reason = status.pick ? autoReasonSentence(status.pick) : undefined;
  return <div data-auto-model-status="">
    {chain.length ? <FoldRow cardId="models.auto.chain" defaultOpen label={t("model.auto.chain.order")} description={reason} count={chain.length}>
      <ol data-auto-model-chain="" className={`${LIST} list-decimal pl-5`}>
        {chain.map((entry) => <li key={`${entry.instanceId}/${entry.model}`}><span className="text-ink">{entry.modelLabel}</span> · {entry.engineLabel}</li>)}
      </ol>
    </FoldRow> : <DescribedRow label={t("model.auto.chain.order")} description={reason ?? t("model.auto.chain.empty")} rowId="models.auto.chain" />}
    {excluded.length > 0 && <div data-auto-model-excluded="">
      <FoldRow cardId="models.auto.excluded" label={t("model.auto.chain.leftOut")} description={t("model.auto.chain.leftOutShort")} count={excluded.length}>
        <ul className={LIST}>
          {excluded.map((entry, index) => <li key={`${entry.instanceId}/${entry.model ?? ""}/${index}`}>{entry.modelLabel ? <><span className="text-ink">{entry.modelLabel}</span> · </> : null}{entry.engineLabel}: {t(`model.auto.exclude.${entry.reason}`)}</li>)}
        </ul>
      </FoldRow>
    </div>}
  </div>;
}

export function AutoModelSettings() {
  const { state } = useStore();
  const bots = state.bots ?? [];
  const [picked, setPicked] = useState("");
  const bot = bots.find((candidate) => candidate.id === picked) ?? bots[0];
  const revision = JSON.stringify([bot?.modelSelection, state.config?.disabledModels, state.config?.myDisabledModels, state.instances]);
  const status = useAutoModelStatus(bot?.id ?? "", undefined, Boolean(bot), revision);
  return <div className="flex min-w-0 flex-col" data-auto-model-settings="">
    <DescribedRow label={t("model.auto.chain.bot")} description={t("model.auto.settings.short")} help={t("model.auto.settings.body")} rowId="models.auto.bot">
      {bot && <PillSelect value={bot.id} options={bots.map((candidate) => ({ value: candidate.id, label: candidate.name }))} onChange={setPicked} ariaLabel={t("model.auto.chain.bot")} />}
    </DescribedRow>
    {bot && <AutoModelStatus status={status} />}
  </div>;
}
