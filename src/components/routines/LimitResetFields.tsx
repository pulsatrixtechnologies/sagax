import type { LimitResetRepeat } from "../../../shared/limit-reset";
import { t } from "@/lib/i18n";
import { PillSelect } from "../SettingsPrimitives";
import { engineName, resetTime, useEngineLimits } from "@/lib/limit-resets";

export interface LimitResetChoice { engine: string; repeat: LimitResetRepeat }


/** The editor's "When my AI limit resets": which AI, once or each time, and when that is if it is known. */
export function LimitResetFields({ value, botEngine, onChange }: { value: LimitResetChoice; botEngine?: string; onChange: (next: LimitResetChoice) => void }) {
  const limits = useEngineLimits();
  const engine = value.engine || botEngine || limits[0]?.engine || "";
  const choices = [...new Set([...(botEngine ? [botEngine] : []), ...limits.map((limit) => limit.engine), ...(engine ? [engine] : [])])];
  const reset = limits.find((limit) => limit.engine === engine)?.resetsAt ?? null;
  return (
    <div className="space-y-2 text-[12.5px] text-ink" data-testid="limit-reset-fields">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t("routines.limitReset.engine")}</span>
        <PillSelect ariaLabel={t("routines.limitReset.engine")} value={engine} options={choices.map((id) => ({ value: id, label: engineName(id) }))} onChange={(next) => onChange({ ...value, engine: next })} />
        <PillSelect<LimitResetRepeat> ariaLabel={t("routines.limitReset.repeat")} value={value.repeat} options={[{ value: "once", label: t("routines.limitReset.once") }, { value: "every_reset", label: t("routines.limitReset.every") }]} onChange={(repeat) => onChange({ ...value, engine, repeat })} />
      </div>
      <div className="text-[11.5px] text-ink-secondary">
        {reset !== null && reset > Date.now() ? t("routines.limitReset.next", { time: resetTime(reset) }) : t("routines.limitReset.unknown")}
      </div>
    </div>
  );
}
