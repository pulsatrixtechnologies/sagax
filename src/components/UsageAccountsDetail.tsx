// The usage detail (owner 2026-11-26, M-20261126-095, M-20261126-096, #5406):
// what a click on the usage pill opens, and what the account menu's Usage
// draws. One row per account that can serve: the short session and the week
// as columns (a slim meter and its figure), and the return time once, only
// for a limit that is hit. The serving account is marked; the free accounts
// come first, the accounts at their limit are folded below; past three rows
// the free ones fold too; the height is fixed, an opened fold scrolls inside.
// No sentence repeats what the bars say. An account is at its limit only when
// the server's limit report says so (#5421): a week at 100% that Extra Usage
// still serves stays among the free ones, in warning. The rows' order and folds are
// `usageDetailLayout` (src/lib/usage-pill.ts); this component holds no store
// and no fetch.
import { useState } from "react";
import { ChevronDown, ChevronUp, Play } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { backText, measureTone, usageDetailLayout, type MeasureTone, type UsageAccount } from "@/lib/usage-pill";
import { FavoriteStar, limitFigure, type PlanUsageViewProps } from "./PlanUsage";

const FILL: Record<MeasureTone, string> = { quiet: "bg-ink-secondary", warning: "bg-warning", danger: "bg-danger" };
const CELL = "h-8 whitespace-nowrap px-1.5 py-0 align-middle";
const MUTED = "text-[12px] leading-4 text-ink-tertiary";

function Meter({ percent, label, blocked }: { percent: number; label: string; blocked: boolean }) {
  const shown = Math.round(Math.min(100, Math.max(0, percent)));
  return (
    <span className="inline-flex items-center gap-2">
      <span role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={shown}
        className="relative inline-block h-[5px] w-10 overflow-hidden rounded-full bg-ink-secondary/25">
        <span className={cn("absolute inset-y-0 left-0 rounded-full", FILL[measureTone(shown, blocked)])} style={{ width: `${shown}%` }} />
      </span>
      <span className="min-w-[4ch] text-ink">{limitFigure(shown)}</span>
    </span>
  );
}

function AccountRow({ account, favorite }: { account: UsageAccount; favorite?: PlanUsageViewProps["favorite"] }) {
  const session = t("usageDetail.session", { hours: account.hours });
  const week = t("usageDetail.week");
  const name = account.plan ? `${account.name} · ${account.plan}` : account.name;
  const note = account.row?.note ?? null;
  const unmetered = account.fiveHour === null && account.weekly === null;
  // an engine with no window: a key has no limit; one the plan report does
  // not know (a local model, a plan that could not be read) has no figure
  const none = account.unlimited ? t("usageDetail.noLimit") : t("usageDetail.noFigure");
  return (
    <tr data-usage-account={account.id} data-serving={account.serving ? "" : undefined} data-blocked={account.blocked ? "" : undefined} className="group/plan">
      <th scope="row" className={cn(CELL, "w-full max-w-0 text-left font-normal")}>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="flex w-2.5 shrink-0 justify-center text-accent">
            {account.serving && <Play size={8} fill="currentColor" aria-label={t("usageDetail.serving")} role="img" />}
          </span>
          <span data-usage-account-name="" title={note ? `${name} · ${note}` : name} className="min-w-0 truncate text-ink">{name}</span>
          {favorite && account.row && <FavoriteStar provider={account.row} favorite={favorite} />}
        </span>
      </th>
      <td data-usage-col="session" className={CELL}>
        {account.fiveHour !== null
          ? <Meter percent={account.fiveHour} label={`${account.name} · ${session}`} blocked={account.blocked} />
          : <span className={MUTED}>{unmetered ? none : t("usageDetail.noSession", { hours: account.hours })}</span>}
      </td>
      <td data-usage-col="week" className={CELL}>
        {account.weekly !== null && <Meter percent={account.weekly} label={`${account.name} · ${week}`} blocked={account.blocked} />}
      </td>
      <td data-usage-col="back" className={cn(CELL, "text-danger")}>
        {account.blocked && account.backAt !== null ? backText(account.backAt) : null}
      </td>
    </tr>
  );
}

function Fold({ label, open, onToggle, name }: { label: string; open: boolean; onToggle: () => void; name: string }) {
  const Arrow = open ? ChevronUp : ChevronDown;
  return (
    <tr>
      <td colSpan={4} className="p-0">
        <button type="button" data-usage-fold={name} aria-expanded={open} onClick={onToggle}
          className="flex h-8 w-full items-center gap-1 rounded-[10px] px-1.5 text-left text-[12px] leading-4 text-ink-secondary outline-none hover:bg-menu-hover focus-visible:bg-menu-hover">
          <span>{label}</span>
          <Arrow size={12} aria-hidden="true" />
        </button>
      </td>
    </tr>
  );
}

export interface UsageAccountsDetailProps {
  accounts: readonly UsageAccount[];
  /** The accounts' star (the plan the account menu's Usage row shows). */
  favorite?: PlanUsageViewProps["favorite"];
  /** Tests and the gallery: render with a fold open. */
  initialOpen?: { moreFree?: boolean; limited?: boolean };
  className?: string;
}

/** The accounts' table. Nothing with no account. */
export function UsageAccountsDetail({ accounts, favorite, initialOpen, className }: UsageAccountsDetailProps) {
  const layout = usageDetailLayout(accounts);
  const [moreFree, setMoreFree] = useState(initialOpen?.moreFree ?? false);
  // with nothing free the accounts at their limit are all there is to read
  const [limited, setLimited] = useState<boolean | null>(initialOpen?.limited ?? null);
  if (!accounts.length) return null;
  // one account: its row is the whole table, no fold says it twice
  const alone = accounts.length === 1;
  const limitedOpen = alone || (limited ?? layout.free.length === 0);
  const hours = accounts.find((account) => account.fiveHour !== null)?.hours ?? 5;
  const free = layout.free.length + layout.moreFree.length;
  return (
    <div data-usage-detail="" className={cn("menu-scroll max-h-[188px] min-w-0 overflow-y-auto overscroll-contain text-[13px] leading-[18px] tabular-nums", className)}>
      <table aria-label={t("usageDetail.aria")} className="w-full border-collapse">
        {/* the header stays in sight while an opened fold scrolls */}
        <thead className="sticky top-0 z-[1] bg-[var(--menu-fill)]">
          <tr className="text-[12px] leading-4 text-ink-secondary">
            {/* the count says who can still serve, never a plan (#5433): the
                title says what "available" means */}
            <th scope="col" data-usage-free="" title={t("usageDetail.freeTip")} className="h-7 whitespace-nowrap px-1.5 text-left font-normal">{t("usageDetail.free", { free, total: accounts.length })}</th>
            <th scope="col" className="h-7 whitespace-nowrap px-1.5 text-left font-normal">{t("usageDetail.session", { hours })}</th>
            <th scope="col" className="h-7 whitespace-nowrap px-1.5 text-left font-normal">{t("usageDetail.week")}</th>
            <th scope="col" className="h-7 whitespace-nowrap px-1.5 text-left font-normal">{layout.limited.length > 0 && limitedOpen ? t("usageDetail.back") : null}</th>
          </tr>
        </thead>
        <tbody>
          {layout.free.map((account) => <AccountRow key={account.id} account={account} favorite={favorite} />)}
          {layout.moreFree.length > 0 && (
            <Fold name="more-free" open={moreFree} onToggle={() => setMoreFree((open) => !open)} label={t("usageDetail.moreFree", { count: layout.moreFree.length })} />
          )}
          {moreFree && layout.moreFree.map((account) => <AccountRow key={account.id} account={account} favorite={favorite} />)}
          {layout.limited.length > 0 && !alone && (
            <Fold name="limited" open={limitedOpen} onToggle={() => setLimited(!limitedOpen)} label={t("usageDetail.atLimit", { count: layout.limited.length })} />
          )}
          {limitedOpen && layout.limited.map((account) => <AccountRow key={account.id} account={account} favorite={favorite} />)}
        </tbody>
      </table>
    </div>
  );
}
