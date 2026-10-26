// The card of an outward action a bot asks for (message field `outbound`,
// shared/wire.ts): a phone call (server/outbound-calls.ts) or a purchase
// with a saved card (server/credential-vault.ts). Parité Grok Bot V4, 59, 83.
//
// One answer covers one action: Call or Don't call, Allow once or Decline.
// No Always allow here. The card shows the full number to its own person,
// the exact words the call says, what the purchase buys; never a card
// number, a security code or an id.
import { useState } from "react";
import { Loader2, Phone, PhoneOff, Plane, ShoppingBag } from "lucide-react";

import { answerPurchase } from "@/lib/credential-vault";
import { activeLocale, t } from "@/lib/i18n";
import { api, type Message } from "@/state/store";
import type { OutboundCard as OutboundCardData } from "../../shared/wire";

export function formatMoney(amount: string | undefined, currency: string | undefined, locale = activeLocale()): string {
  if (!amount) return "";
  const value = Number(amount);
  if (!Number.isFinite(value) || !currency) return amount;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** "3 articles achetés · 45,20 $", "2 vols achetés", "Acheté · 12,00 $". */
export function purchaseSummary(card: OutboundCardData): string {
  const amount = formatMoney(card.amount, card.currency);
  const count = (card.items ?? []).reduce((sum, item) => sum + (item.quantity ?? 1), 0);
  const flights = card.flights?.length ?? 0;
  if (flights) return flights === 1 ? t("outbound.purchase.flightOne", { amount }) : t("outbound.purchase.flights", { count: String(flights), amount });
  if (count) return count === 1 ? t("outbound.purchase.itemOne", { amount }) : t("outbound.purchase.items", { count: String(count), amount });
  return t("outbound.purchase.done", { amount });
}

function statusLine(card: OutboundCardData): string | null {
  const bot = card.botName;
  if (card.kind === "call") {
    if (card.status === "approved") return t("outbound.call.status.approved", { bot });
    if (card.status === "done") return t("outbound.call.status.done");
    if (card.status === "denied") return t("outbound.call.status.denied");
    if (card.status === "failed") return t("outbound.call.status.failed");
    return null;
  }
  if (card.status === "approved") return t("outbound.purchase.status.approved", { bot });
  if (card.status === "denied") return t("outbound.purchase.status.denied");
  return null;
}

export function OutboundCard({ message }: { message: Message }) {
  const card = message.outbound!;
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [answered, setAnswered] = useState<OutboundCardData["status"] | null>(null);
  const [error, setError] = useState("");
  // ÉFVP pilot: Call only after the person confirms the number on the card
  const [confirmed, setConfirmed] = useState(false);
  const status = answered ?? card.status;
  const view = { ...card, status };

  const answer = async (yes: boolean) => {
    setBusy(yes ? "yes" : "no");
    setError("");
    try {
      if (card.kind === "call") {
        await api(`/api/me/phone-calls/${encodeURIComponent(card.id)}/answer`, { method: "POST", body: JSON.stringify(yes ? { decision: "call", confirmed: confirmed, confirmedTo: card.destination } : { decision: "deny" }) });
      } else {
        await answerPurchase(card.id, yes ? "once" : "deny");
      }
      setAnswered(yes ? "approved" : "denied");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const done = card.kind === "purchase" && status === "done";
  const Icon = card.kind === "call" ? (status === "denied" ? PhoneOff : Phone) : card.flights?.length ? Plane : ShoppingBag;
  const title = card.kind === "call"
    ? t("outbound.call.to", { destination: card.destination ?? "" })
    : done ? purchaseSummary(card) : t("outbound.purchase.pay", { amount: formatMoney(card.amount, card.currency), merchant: card.merchant ?? "" });
  const state = statusLine(view);

  return (
    <article data-outbound-card={card.kind} data-outbound-status={status} aria-label={title}
      className="my-2 w-full max-w-[560px] overflow-hidden rounded-xl border border-hairline/40 bg-panel shadow-sm">
      <header className="flex items-center gap-2 border-b border-hairline/30 bg-raised/30 px-3 py-2 text-[12px] text-ink-secondary">
        <Icon size={14} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{card.kind === "call" ? t("outbound.call.title") : t("outbound.purchase.title")}</span>
        <span className="truncate">{card.botName}</span>
      </header>
      <div className="space-y-2 px-3 py-3 text-[13px] text-ink">
        <p className="font-medium">{title}</p>
        {card.kind === "call" && (
          <>
            {card.from && <p className="text-[12px] text-ink-secondary">{t("outbound.call.from", { from: card.from })}</p>}
            {card.purpose && <p><span className="text-ink-secondary">{t("outbound.call.purpose")} </span>{card.purpose}</p>}
            {card.script && (
              <div>
                <p className="text-[12px] text-ink-secondary">{t("outbound.call.script", { bot: card.botName })}</p>
                <blockquote className="mt-1 whitespace-pre-wrap border-l-2 border-hairline/60 pl-2 text-[12.5px]">{card.script}</blockquote>
              </div>
            )}
            {card.callback && <p className="text-[12px] text-ink-secondary">{t("outbound.call.callback", { number: card.callback })}</p>}
            {status === "pending" && <p className="text-[12px] text-ink-secondary">{t("outbound.call.disclosure")}</p>}
            {status === "pending" && (
              <label className="flex items-center gap-2 text-[12.5px]">
                <input type="checkbox" data-outbound-confirm checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                {t("outbound.call.confirm", { destination: card.destination ?? "" })}
              </label>
            )}
          </>
        )}
        {card.kind === "purchase" && (
          <>
            {done && card.merchant && <p className="text-[12px] text-ink-secondary">{card.merchant}{card.orderRef ? ` · ${t("outbound.purchase.order", { ref: card.orderRef })}` : ""}</p>}
            {(card.items?.length ?? 0) > 0 && (
              <ul className="space-y-0.5 text-[12.5px]">
                {card.items!.map((item, index) => (
                  <li key={`${item.name}-${index}`} className="flex gap-2">
                    <span className="min-w-0 flex-1 truncate">{(item.quantity ?? 1) > 1 ? `${item.quantity} × ` : ""}{item.name}</span>
                    {item.price && <span className="text-ink-secondary">{formatMoney(item.price, card.currency)}</span>}
                  </li>
                ))}
              </ul>
            )}
            {(card.flights?.length ?? 0) > 0 && (
              <ul className="space-y-0.5 text-[12.5px]">
                {card.flights!.map((leg, index) => (
                  <li key={`${leg.from}-${leg.to}-${index}`}>
                    {t("outbound.purchase.flight", { from: leg.from, to: leg.to, date: leg.date })}{leg.flight ? ` · ${leg.flight}` : ""}{leg.passenger ? ` · ${leg.passenger}` : ""}
                  </li>
                ))}
              </ul>
            )}
            {done && card.declared && <p className="text-[12px] text-ink-secondary">{t("outbound.purchase.declared")}</p>}
            {done && card.mismatchTotal && <p role="alert" className="text-[12px] text-warning">{t("outbound.purchase.mismatch", { total: formatMoney(card.mismatchTotal, card.currency), amount: formatMoney(card.amount, card.currency) })}</p>}
            {card.cardLabel && !done && <p className="text-[12px] text-ink-secondary">{t("outbound.purchase.card", { card: card.cardLabel })}</p>}
            {status === "pending" && <p className="text-[12px] text-ink-secondary">{t("outbound.purchase.never")}</p>}
          </>
        )}
        {state && <p role="status" className="text-[12px] text-ink-secondary">{state}</p>}
        {card.via && status !== "pending" && <p className="text-[12px] text-ink-secondary">{t("outbound.via", { name: card.via })}</p>}
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
        {status === "pending" && (
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" data-outbound-yes disabled={busy !== null || (card.kind === "call" && !confirmed)} onClick={() => void answer(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40">
              {busy === "yes" && <Loader2 size={13} className="animate-spin" />}
              {card.kind === "call" ? t("outbound.call.allow") : t("outbound.purchase.allow")}
            </button>
            <button type="button" data-outbound-no disabled={busy !== null} onClick={() => void answer(false)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-hairline/60 px-3 py-1.5 text-[12.5px] text-ink disabled:opacity-40">
              {busy === "no" && <Loader2 size={13} className="animate-spin" />}
              {card.kind === "call" ? t("outbound.call.deny") : t("outbound.purchase.deny")}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
