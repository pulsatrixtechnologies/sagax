// Payments settings on top of the credential vault: default method and
// per-bot allowances. Pure: no disk, no clock. A bot never sees a card
// number; these rules only decide whether request_purchase may open a card.
//
// Defaults favour person autonomy: every owned bot may pay until the person
// turns one off or sets a limit. Org Ask/Deny and person isolation stay
// outside this module.

import { parseAmount, type CardBrand } from "./payment-vault.ts";
import { isSingleUseWallet, type SingleUseWallet } from "./single-use-card.ts";

export const PAYMENT_METHOD_TYPES = ["card", "wallet"] as const;
export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number];

/** What the person picks as the method bots use first. */
export type PaymentMethodRef =
  | { type: "card"; cardId: string }
  | { type: "wallet"; wallet: SingleUseWallet };

/** One bot's spending rules. Absent fields mean no extra limit. */
export interface BotPaymentAllowance {
  /** false: this bot may not open a purchase. Absent or true: it may. */
  enabled?: boolean;
  /** Max amount of one purchase, e.g. "50.00". */
  perPurchaseLimit?: string;
  /** Max sum of approved purchases in the current UTC month, e.g. "500.00". */
  perMonthLimit?: string;
  /** Optional merchant hostnames (example.test). Empty or absent: any. */
  merchants?: string[];
  /** Merchants where this bot's purchases are allowed without a card: the
   * person's Always allow on a purchase card (#2091). Absent: each
   * purchase asks. */
  alwaysMerchants?: string[];
}

export interface PaymentsSettings {
  defaultMethod?: PaymentMethodRef;
  bots?: Record<string, BotPaymentAllowance>;
}

/** A method the Payments screen can show or pick. Never a PAN. */
export interface PaymentMethodListing {
  id: string;
  type: PaymentMethodType;
  label: string;
  /** Card: brand · last4. Wallet: live or not. */
  detail: string;
  brand?: CardBrand | "wallet";
  last4?: string;
  wallet?: SingleUseWallet;
  /** This method is the one bots use first. */
  isDefault: boolean;
  /** Wallet only: the CLI is signed in on this computer. */
  ready?: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanHost(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253 || /\s/.test(host)) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host)) return null;
  return host;
}

export function parsePaymentMethodRef(input: unknown): PaymentMethodRef | string | undefined {
  if (input === undefined || input === null) return undefined;
  const row = record(input);
  if (!row) return "defaultMethod needs a type of card or wallet.";
  if (row.type === "card") {
    const cardId = typeof row.cardId === "string" ? row.cardId.trim() : "";
    if (!/^[a-z0-9]{8,40}$/.test(cardId)) return "defaultMethod.cardId is not a card handle.";
    return { type: "card", cardId };
  }
  if (row.type === "wallet") {
    if (!isSingleUseWallet(row.wallet)) return "defaultMethod.wallet must be shop_pay or link.";
    return { type: "wallet", wallet: row.wallet };
  }
  return "defaultMethod.type must be card or wallet.";
}

export function parseBotPaymentAllowance(input: unknown): BotPaymentAllowance | string {
  const row = record(input);
  if (!row) return "A bot allowance needs an object.";
  const out: BotPaymentAllowance = {};
  if (row.enabled !== undefined) {
    if (typeof row.enabled !== "boolean") return "enabled must be true or false.";
    out.enabled = row.enabled;
  }
  if (row.perPurchaseLimit !== undefined) {
    const amount = parseAmount(row.perPurchaseLimit);
    if (!amount) return "perPurchaseLimit is a positive amount, such as 50.00.";
    out.perPurchaseLimit = amount;
  }
  if (row.perMonthLimit !== undefined) {
    const amount = parseAmount(row.perMonthLimit);
    if (!amount) return "perMonthLimit is a positive amount, such as 500.00.";
    out.perMonthLimit = amount;
  }
  if (row.merchants !== undefined) {
    if (!Array.isArray(row.merchants) || row.merchants.length > 50) return "merchants is a list of at most 50 hostnames.";
    const hosts: string[] = [];
    for (const entry of row.merchants) {
      const host = cleanHost(entry);
      if (!host) return "Each merchant is a hostname, such as shop.example.test.";
      if (!hosts.includes(host)) hosts.push(host);
    }
    out.merchants = hosts;
  }
  if (row.alwaysMerchants !== undefined) {
    if (!Array.isArray(row.alwaysMerchants) || row.alwaysMerchants.length > 50) return "alwaysMerchants is a list of at most 50 hostnames.";
    const hosts: string[] = [];
    for (const entry of row.alwaysMerchants) {
      const host = cleanHost(entry);
      if (!host) return "Each merchant is a hostname, such as shop.example.test.";
      if (!hosts.includes(host)) hosts.push(host);
    }
    out.alwaysMerchants = hosts;
  }
  return out;
}

/** The person's standing Always allow for this bot's purchases on this
 * site (#2091): the merchant, or null when each purchase asks. */
export function standingPurchaseMerchant(settings: PaymentsSettings | undefined, botId: string, domain: string): string | null {
  const list = settings?.bots?.[botId]?.alwaysMerchants;
  if (!list || list.length === 0) return null;
  const host = domain.trim().toLowerCase();
  return list.find((entry) => host === entry || host.endsWith(`.${entry}`)) ?? null;
}

export function parsePaymentsSettings(input: unknown): PaymentsSettings | string {
  if (input === undefined || input === null) return {};
  const row = record(input);
  if (!row) return "payments needs an object.";
  const out: PaymentsSettings = {};
  if (row.defaultMethod !== undefined) {
    const method = parsePaymentMethodRef(row.defaultMethod);
    if (typeof method === "string") return method;
    if (method) out.defaultMethod = method;
  }
  if (row.bots !== undefined) {
    const bots = record(row.bots);
    if (!bots) return "payments.bots is a map of bot id to allowance.";
    const mapped: Record<string, BotPaymentAllowance> = {};
    for (const [botId, value] of Object.entries(bots)) {
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(botId)) return "payments.bots keys are bot ids.";
      const allowance = parseBotPaymentAllowance(value);
      if (typeof allowance === "string") return allowance;
      mapped[botId] = allowance;
    }
    out.bots = mapped;
  }
  return out;
}

/** Merge a patch into current settings. null defaultMethod clears it. */
export function mergePaymentsSettings(
  current: PaymentsSettings | undefined,
  patch: unknown,
): PaymentsSettings | string {
  const row = record(patch);
  if (!row) return "payments patch needs an object.";
  const next: PaymentsSettings = {};
  if (current?.defaultMethod) next.defaultMethod = current.defaultMethod;
  if (current?.bots) next.bots = { ...current.bots };
  if ("defaultMethod" in row) {
    if (row.defaultMethod === null) delete next.defaultMethod;
    else {
      const method = parsePaymentMethodRef(row.defaultMethod);
      if (typeof method === "string") return method;
      if (method) next.defaultMethod = method;
      else delete next.defaultMethod;
    }
  }
  if (row.bots !== undefined) {
    const bots = record(row.bots);
    if (!bots) return "payments.bots is a map of bot id to allowance.";
    const mapped: Record<string, BotPaymentAllowance> = next.bots ? { ...next.bots } : {};
    for (const [botId, value] of Object.entries(bots)) {
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(botId)) return "payments.bots keys are bot ids.";
      if (value === null) {
        delete mapped[botId];
        continue;
      }
      const allowance = parseBotPaymentAllowance(value);
      if (typeof allowance === "string") return allowance;
      mapped[botId] = { ...mapped[botId], ...allowance };
    }
    next.bots = mapped;
  }
  if (next.bots && Object.keys(next.bots).length === 0) delete next.bots;
  return next;
}

export function methodEquals(a: PaymentMethodRef | undefined, b: PaymentMethodRef | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.type !== b.type) return false;
  if (a.type === "card" && b.type === "card") return a.cardId === b.cardId;
  if (a.type === "wallet" && b.type === "wallet") return a.wallet === b.wallet;
  return false;
}

export function methodKey(method: PaymentMethodRef): string {
  return method.type === "card" ? `card:${method.cardId}` : `wallet:${method.wallet}`;
}

/** Whether this bot may open a purchase under the person's rules. */
export function botMayPay(settings: PaymentsSettings | undefined, botId: string): boolean {
  const row = settings?.bots?.[botId];
  return row?.enabled !== false;
}

/** Host match: exact or a registered suffix (a.b.example.test matches example.test). */
export function merchantAllowed(allowlist: readonly string[] | undefined, domain: string): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  const host = domain.trim().toLowerCase();
  return allowlist.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

export function amountNumber(amount: string): number {
  return Number(amount);
}

/** Refuse a purchase that breaks this bot's allowance. Null when it may proceed. */
export function allowanceRefusal(input: {
  settings: PaymentsSettings | undefined;
  botId: string;
  amount: string;
  domain: string;
  /** Sum of this bot's approved purchases in the current UTC month (same currency). */
  monthSpent: string;
  currency: string;
}): string | null {
  const row = input.settings?.bots?.[input.botId];
  if (row?.enabled === false) {
    return `request_purchase refused: ${input.botId} is not allowed to pay. Turn it on in Settings > Vault > Payments, or pick another bot. Nothing was asked or charged.`;
  }
  if (row?.merchants && !merchantAllowed(row.merchants, input.domain)) {
    return `request_purchase refused: ${input.domain} is not on this bot's merchant list. Nothing was asked or charged.`;
  }
  const purchase = amountNumber(input.amount);
  if (row?.perPurchaseLimit && purchase > amountNumber(row.perPurchaseLimit)) {
    return `request_purchase refused: ${input.amount} ${input.currency} is over this bot's per-purchase limit of ${row.perPurchaseLimit} ${input.currency}. Nothing was asked or charged.`;
  }
  if (row?.perMonthLimit) {
    const month = amountNumber(input.monthSpent) + purchase;
    if (month > amountNumber(row.perMonthLimit)) {
      return `request_purchase refused: this purchase would pass this bot's monthly limit of ${row.perMonthLimit} ${input.currency} (spent ${input.monthSpent} so far). Nothing was asked or charged.`;
    }
  }
  return null;
}

/** UTC month key YYYY-MM for monthly spend. */
export function utcMonthKey(atMs: number): string {
  const d = new Date(atMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Sum amounts of the same currency. */
export function sumAmounts(amounts: readonly string[]): string {
  let total = 0;
  for (const amount of amounts) total += amountNumber(amount);
  return total.toFixed(2);
}
