// #5014 (M-20261119-016, D-20261119-048, D-20261119-050): Providers > a
// provider > Accounts, beside the list of accounts: how Sagax picks among
// the person's accounts of this provider when several offer a model and no
// account is forced on the model menu's Account line. High-water by
// default, its threshold beside it. The person's own setting, for every one
// of their bots (GET/PUT /api/me/models `accountSwitchByProvider`). Absent
// with a single account: nothing to choose.
import { useEffect, useState } from "react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import {
  ACCOUNT_STRATEGIES,
  DEFAULT_ACCOUNT_STRATEGY,
  DEFAULT_ACCOUNT_THRESHOLD,
  accountSwitchSettingOf,
  type AccountStrategy,
  type AccountSwitchSetting,
} from "../../../shared/account-switch";
import { DescribedRow, PillSelect } from "../SettingsPrimitives";

/** The thresholds offered, the person's own kept when it is another. */
const THRESHOLDS = [50, 60, 70, 80, 90, 95];

const STRATEGY_KEY = {
  "high-water": { label: "providers.accountSwitch.highWater", hint: "providers.accountSwitch.highWaterHint" },
  "most-free": { label: "providers.accountSwitch.mostFree", hint: "providers.accountSwitch.mostFreeHint" },
  "fill-up": { label: "providers.accountSwitch.fillUp", hint: "providers.accountSwitch.fillUpHint" },
} as const;

type Answer = { accountSwitchByProvider?: Record<string, AccountSwitchSetting> };

/** The person's setting for this provider, and its save. */
export function useAccountSwitch(providerId: string): { setting: AccountSwitchSetting | null; save: (next: Partial<AccountSwitchSetting>) => void; busy: boolean; error: string | null } {
  const [all, setAll] = useState<Record<string, AccountSwitchSetting> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api<Answer>("/api/me/models")
      .then((answer) => { if (live) setAll(answer.accountSwitchByProvider ?? {}); })
      .catch(() => { if (live) setAll({}); });
    return () => { live = false; };
  }, []);
  const setting = all === null ? null : accountSwitchSettingOf(all[providerId]);
  const save = (next: Partial<AccountSwitchSetting>) => {
    if (!setting) return;
    setBusy(true);
    setError(null);
    api<Answer>("/api/me/models", { method: "PUT", body: JSON.stringify({ accountSwitchByProvider: { [providerId]: { ...setting, ...next } } }) })
      .then((answer) => setAll(answer.accountSwitchByProvider ?? {}))
      .catch((failure) => setError(readableError(failure)))
      .finally(() => setBusy(false));
  };
  return { setting, save, busy, error };
}

export function AccountSwitchRows({ providerId }: { providerId: string }) {
  const { setting, save, busy, error } = useAccountSwitch(providerId);
  if (!setting) return null;
  const label = t("providers.accountSwitch.label");
  const thresholdLabel = t("providers.accountSwitch.threshold");
  const thresholds = THRESHOLDS.includes(setting.threshold) ? THRESHOLDS : [...THRESHOLDS, setting.threshold].sort((a, b) => a - b);
  return (
    <div data-provider-account-switch={providerId} data-account-strategy={setting.strategy}>
      <DescribedRow label={label} description={t(STRATEGY_KEY[setting.strategy].hint)} rowId="providers.accountSwitch">
        <PillSelect<AccountStrategy>
          value={setting.strategy}
          ariaLabel={label}
          disabled={busy}
          onChange={(strategy) => save({ strategy })}
          options={ACCOUNT_STRATEGIES.map((strategy) => ({
            value: strategy,
            label: strategy === DEFAULT_ACCOUNT_STRATEGY ? t("providers.accountSwitch.default", { strategy: t(STRATEGY_KEY[strategy].label) }) : t(STRATEGY_KEY[strategy].label),
            triggerLabel: t(STRATEGY_KEY[strategy].label),
            hint: t(STRATEGY_KEY[strategy].hint),
          }))}
        />
      </DescribedRow>
      {setting.strategy === "high-water" && (
        <DescribedRow label={thresholdLabel} description={t("providers.accountSwitch.thresholdHelp")} rowId="providers.accountSwitch.threshold">
          <PillSelect<string>
            value={String(setting.threshold)}
            ariaLabel={thresholdLabel}
            disabled={busy}
            onChange={(value) => save({ threshold: Number(value) })}
            options={thresholds.map((value) => ({
              value: String(value),
              label: value === DEFAULT_ACCOUNT_THRESHOLD ? t("providers.accountSwitch.thresholdDefault", { percent: String(value) }) : t("providers.accountSwitch.thresholdValue", { percent: String(value) }),
              triggerLabel: t("providers.accountSwitch.thresholdValue", { percent: String(value) }),
            }))}
          />
        </DescribedRow>
      )}
      {error && <p role="alert" className="px-3.5 py-1.5 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
