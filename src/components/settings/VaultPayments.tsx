// Settings > Vault > Payments (#2080). One card per concern: methods
// (cards, then Shop Pay and Link as sibling rows), the default method,
// one folded row per bot, then purchases. No group inside a group.
import { Fragment, useState, type ReactNode } from "react";

import { formatMoney } from "@/components/OutboundCard";
import { answerPurchase, chooseSingleUseWallet, parseDomains, patchPayments, type CredentialVaultState, type PaymentMethodListing, type PaymentMethodRef, type PaymentsSettings, type PurchaseListing, type VaultItemListing } from "@/lib/credential-vault";
import { activeLocale, t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { methodKey } from "../../../shared/payments-settings";
import { DescribedRow, HelpTip, PILL, PRIMARY_PILL, PillSelect, SettingsGroup, SettingsTextRow, Switch, SwitchRow } from "../SettingsPrimitives";
import { DisclosurePill } from "./AppearanceSettings";

const message = (error: unknown) => readableError(error);
const inputClass = "ui-input w-full";
const HISTORY_PREVIEW = 5;

/** Grey line of a bot that may pay: both caps, one cap, or no cap. */
export function botAllowanceSummary(row: { enabled?: boolean; perPurchaseLimit?: string; perMonthLimit?: string } | undefined, currency = "USD"): string {
  const per = row?.perPurchaseLimit?.trim() ?? "";
  const month = row?.perMonthLimit?.trim() ?? "";
  const money = (amount: string) => formatMoney(amount, currency) || amount;
  const cap = per && month
    ? t("vault.payments.botSummary", { perPurchase: money(per), perMonth: money(month) })
    : per
      ? `${money(per)} · ${t("vault.payments.perPurchase")}`
      : month
        ? `${money(month)} · ${t("vault.payments.perMonth")}`
        : t("vault.payments.noCap");
  return row?.enabled === false ? `${t("settings.card.off")} · ${cap}` : cap;
}

export function PaymentsPanel({ data, bots, botName, addingCard, renderItem, renderNewCard, onAddCard, onChanged, onError }: {
  data: CredentialVaultState;
  bots: ReadonlyArray<{ id: string; name: string }>;
  botName: (id: string) => string;
  addingCard: boolean;
  renderItem: (item: VaultItemListing) => ReactNode;
  renderNewCard: () => ReactNode;
  onAddCard: () => void;
  onChanged: () => Promise<void>;
  onError: (error: string | null) => void;
}) {
  const cards = data.items.filter((item) => item.kind === "card");
  const methods = data.methods ?? [];
  const pending = (data.purchases ?? []).filter((row) => row.status === "pending");
  const history = data.history ?? [];
  return (
    <>
      <div data-settings-card="credentials.payments.methods">
        <SettingsGroup title={t("vault.payments.methods")} groupId="credentials.payments.methods">
          <div className="flex items-start gap-1.5 px-3.5 py-2.5 text-[12px] leading-4 text-ink-secondary">
            <span>{t("vault.payments.methodsIntro")}</span>
            <HelpTip label={t("settings.moreAbout", { title: t("vault.payments.methods") })}>{t("vault.payments.paypalNote")}</HelpTip>
          </div>
          {cards.map((item) => <Fragment key={item.id}>{renderItem(item)}</Fragment>)}
          <SingleUseWallets data={data} onChanged={onChanged} onError={onError} />
          {addingCard
            ? renderNewCard()
            : (
              <div className="flex justify-end px-3.5 py-2.5">
                <button type="button" className={PRIMARY_PILL} disabled={Boolean(data.unavailable)} data-payments-add-card="" onClick={onAddCard}>
                  {t("vault.payments.addCard")}
                </button>
              </div>
            )}
        </SettingsGroup>
      </div>
      <DefaultMethodPicker data={data} methods={methods} onChanged={onChanged} onError={onError} />
      <BotAllowances data={data} bots={bots} botName={botName} onChanged={onChanged} onError={onError} />
      <Purchases pending={pending} history={history} onChanged={onChanged} onError={onError} />
    </>
  );
}

function SingleUseWallets({ data, onChanged, onError }: {
  data: CredentialVaultState;
  onChanged: () => Promise<void>;
  onError: (error: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const set = async (wallet: "shop_pay" | "link", chosen: boolean) => {
    setBusy(true);
    onError(null);
    try {
      await chooseSingleUseWallet(wallet, chosen);
      await onChanged();
    } catch (failure) {
      onError(message(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-settings-card="credentials.wallets">
      {(["shop_pay", "link"] as const).map((wallet) => {
        const row = data.wallets?.[wallet];
        const label = wallet === "shop_pay" ? t("vault.singleUse.shopPay") : t("vault.singleUse.link");
        const chosen = row?.chosen === true;
        const status = !chosen
          ? t("vault.singleUse.connect")
          : row?.ready
            ? t("vault.singleUse.live", { wallet: label })
            : t("vault.singleUse.notLive", { missing: row?.missing ?? "" });
        return (
          <div key={wallet} data-single-use-wallet={wallet}>
            <DescribedRow
              label={label}
              description={`${t("vault.singleUse.title")} · ${chosen ? t("settings.card.on") : t("settings.card.off")}`}
              help={<><p>{t("vault.singleUse.intro")}</p><p className="mt-1">{status}</p></>}
              rowId={`wallet-${wallet}`}
            >
              <Switch
                checked={chosen}
                disabled={busy || Boolean(data.unavailable)}
                aria-label={label}
                onClick={() => { void set(wallet, !chosen); }}
              />
            </DescribedRow>
          </div>
        );
      })}
    </div>
  );
}

function DefaultMethodPicker({ data, methods, onChanged, onError }: {
  data: CredentialVaultState;
  methods: readonly PaymentMethodListing[];
  onChanged: () => Promise<void>;
  onError: (error: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const current = data.payments?.defaultMethod;
  const value = current ? methodKey(current) : "";
  const selected = methods.find((row) => row.id === value);
  const pick = async (next: string) => {
    setBusy(true);
    onError(null);
    try {
      const method = next ? methods.find((row) => row.id === next) : undefined;
      const defaultMethod: PaymentMethodRef | null = !method
        ? null
        : method.type === "card"
          ? { type: "card", cardId: method.id.replace(/^card:/, "") }
          : { type: "wallet", wallet: method.wallet! };
      await patchPayments({ defaultMethod });
      await onChanged();
    } catch (failure) {
      onError(message(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-settings-card="credentials.payments.default">
      <SettingsGroup groupId="credentials.payments.default">
        <DescribedRow
          label={t("vault.payments.default")}
          description={selected ? `${selected.label} · ${selected.detail}` : t("vault.payments.defaultNone")}
          help={t("vault.payments.defaultHint")}
          rowId="payments-default"
        >
          <PillSelect
            ariaLabel={t("vault.payments.default")}
            value={value}
            disabled={busy || Boolean(data.unavailable)}
            onChange={(next) => { void pick(next); }}
            options={[
              { value: "", label: t("vault.payments.defaultNone") },
              ...methods.map((row) => ({ value: row.id, label: `${row.label} · ${row.detail}` })),
            ]}
          />
        </DescribedRow>
      </SettingsGroup>
    </div>
  );
}

function BotAllowances({ data, bots, botName, onChanged, onError }: {
  data: CredentialVaultState;
  bots: ReadonlyArray<{ id: string; name: string }>;
  botName: (id: string) => string;
  onChanged: () => Promise<void>;
  onError: (error: string | null) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [openBot, setOpenBot] = useState<string | null>(null);
  const payments: PaymentsSettings = data.payments ?? {};
  const save = async (botId: string, patch: { enabled?: boolean; perPurchaseLimit?: string; perMonthLimit?: string; merchants?: string[] }) => {
    setBusy(botId);
    onError(null);
    try {
      await patchPayments({ bots: { [botId]: patch } });
      await onChanged();
    } catch (failure) {
      onError(message(failure));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div data-settings-card="credentials.payments.bots">
      <SettingsGroup title={t("vault.payments.bots")} groupId="credentials.payments.bots">
        <SettingsTextRow>{t("vault.payments.botsIntro")}</SettingsTextRow>
        {bots.length === 0 && <SettingsTextRow>{t("vault.settings.noBots")}</SettingsTextRow>}
        {bots.map((bot) => {
          const row = payments.bots?.[bot.id];
          const enabled = row?.enabled !== false;
          const open = openBot === bot.id;
          return (
            <div key={bot.id} data-payments-bot={bot.id}>
              <DescribedRow
                label={botName(bot.id)}
                description={botAllowanceSummary(row)}
                rowId={`payments-bot-${bot.id}`}
                below={open ? (
                  <div className="mt-2 flex flex-col gap-2" data-payments-bot-detail="">
                    <SwitchRow
                      label={t("vault.payments.mayPay")}
                      checked={enabled}
                      disabled={busy !== null || Boolean(data.unavailable)}
                      onChange={(next) => { void save(bot.id, { enabled: next }); }}
                    />
                    <div className="flex flex-col gap-2">
                      <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
                        {t("vault.payments.perPurchase")}
                        <input
                          className={inputClass}
                          dir="ltr"
                          inputMode="decimal"
                          disabled={busy !== null || Boolean(data.unavailable) || !enabled}
                          defaultValue={row?.perPurchaseLimit ?? ""}
                          placeholder="50.00"
                          onBlur={(event) => {
                            const next = event.target.value.trim();
                            if (next === (row?.perPurchaseLimit ?? "")) return;
                            void save(bot.id, { perPurchaseLimit: next || undefined });
                          }}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
                        {t("vault.payments.perMonth")}
                        <input
                          className={inputClass}
                          dir="ltr"
                          inputMode="decimal"
                          disabled={busy !== null || Boolean(data.unavailable) || !enabled}
                          defaultValue={row?.perMonthLimit ?? ""}
                          placeholder="500.00"
                          onBlur={(event) => {
                            const next = event.target.value.trim();
                            if (next === (row?.perMonthLimit ?? "")) return;
                            void save(bot.id, { perMonthLimit: next || undefined });
                          }}
                        />
                      </label>
                    </div>
                    <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
                      {t("vault.payments.merchants")}
                      <input
                        className={inputClass}
                        dir="ltr"
                        disabled={busy !== null || Boolean(data.unavailable) || !enabled}
                        defaultValue={(row?.merchants ?? []).join(", ")}
                        placeholder={t("vault.payments.merchantsHint")}
                        onBlur={(event) => {
                          const hosts = parseDomains(event.target.value).map((host) => host.toLowerCase());
                          const currentHosts = row?.merchants ?? [];
                          if (hosts.join(",") === currentHosts.join(",")) return;
                          void save(bot.id, { merchants: hosts });
                        }}
                      />
                    </label>
                  </div>
                ) : undefined}
              >
                <DisclosurePill open={open} onToggle={() => setOpenBot(open ? null : bot.id)} label={t("vault.item.manage")}>
                  {t("vault.item.manage")}
                </DisclosurePill>
              </DescribedRow>
            </div>
          );
        })}
      </SettingsGroup>
    </div>
  );
}

function Purchases({ pending, history, onChanged, onError }: {
  pending: PurchaseListing[];
  history: readonly PurchaseListing[];
  onChanged: () => Promise<void>;
  onError: (error: string | null) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [allHistory, setAllHistory] = useState(false);
  const shown = allHistory ? history : history.slice(0, HISTORY_PREVIEW);
  const answer = async (id: string, decision: "deny" | "once") => {
    setBusy(id);
    onError(null);
    try {
      await answerPurchase(id, decision);
      await onChanged();
    } catch (failure) {
      onError(message(failure));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div data-settings-card="credentials.purchases">
      <SettingsGroup title={t("vault.payments.purchases")} groupId="credentials.purchases">
        {pending.length > 0 && <SettingsTextRow>{t("vault.payments.pending")}</SettingsTextRow>}
        {pending.length > 0 && <SettingsTextRow>{t("vault.purchase.intro")}</SettingsTextRow>}
        {pending.map((purchase) => (
          <div key={purchase.id} className="flex flex-col gap-2 px-3.5 py-2.5" data-purchase={purchase.merchant}>
            <div className="text-[13px] text-ink">{purchase.title}</div>
            <div className="text-[12px] text-ink-secondary">{purchase.line}</div>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={`${PILL} text-danger`} disabled={busy !== null} data-purchase-deny="" onClick={() => void answer(purchase.id, "deny")}>{t("vault.purchase.deny")}</button>
              <button type="button" className={PRIMARY_PILL} disabled={busy !== null} data-purchase-pay="" onClick={() => void answer(purchase.id, "once")}>{t("vault.purchase.once")}</button>
            </div>
          </div>
        ))}
        <div data-settings-card="credentials.payments.history">
          <p className="px-3.5 pt-2 text-[12px] text-ink-secondary">{t("vault.payments.history")}</p>
          {history.length === 0 && <SettingsTextRow>{t("vault.payments.historyEmpty")}</SettingsTextRow>}
          {shown.map((row) => {
            const method = row.wallet
              ? (row.wallet === "shop_pay" ? t("vault.singleUse.shopPay") : t("vault.singleUse.link"))
              : (row.cardLast4 ? `${row.cardBrand} ···· ${row.cardLast4}` : row.cardName);
            const at = new Date(row.doneAt ?? row.createdAt).toLocaleString(activeLocale(), { dateStyle: "medium", timeStyle: "short" });
            return (
              <div key={row.id} className="flex flex-col gap-0.5 px-3.5 py-2.5" data-purchase-history={row.id}>
                <div className="text-[13px] text-ink">{formatMoney(row.amount, row.currency)} · {row.merchant}</div>
                <div className="text-[12px] text-ink-secondary">{method} · {at}{row.orderRef ? ` · ${t("vault.payments.historyOrder", { ref: row.orderRef })}` : ""}</div>
              </div>
            );
          })}
          {history.length > HISTORY_PREVIEW && !allHistory && (
            <div className="flex justify-end px-3.5 py-2">
              <button type="button" className={PILL} data-payments-history-all="" onClick={() => setAllHistory(true)}>{t("vault.payments.seeAll")}</button>
            </div>
          )}
        </div>
      </SettingsGroup>
    </div>
  );
}
