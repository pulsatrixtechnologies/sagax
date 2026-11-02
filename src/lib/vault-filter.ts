// Vault Settings filter pills: all | logins | payments | contacts.
// Pure helpers so pills and deep links stay testable without the page.
import type { VaultItemKind, VaultItemListing } from "../../shared/credential-vault";
import type { PaymentMethodListing } from "../../shared/payments-settings";
import type { WalletLinkView } from "../../shared/single-use-card";
import type { PurchaseListing } from "./credential-vault";

export const VAULT_FILTER_TABS = ["all", "logins", "payments", "contacts"] as const;
export type VaultFilterTab = (typeof VAULT_FILTER_TABS)[number];

const LOGIN_KINDS = new Set<VaultItemKind>(["login", "apiKey", "note"]);
const CONTACT_KINDS = new Set<VaultItemKind>(["address", "contact"]);

/** Settings cards that belong on the Payments filter. */
export const VAULT_PAYMENTS_CARD_IDS = [
  "credentials.wallets",
  "credentials.purchases",
  "credentials.payments.methods",
  "credentials.payments.default",
  "credentials.payments.bots",
  "credentials.payments.history",
] as const;

export function isVaultFilterTab(value: string | null | undefined): value is VaultFilterTab {
  return value === "all" || value === "logins" || value === "payments" || value === "contacts";
}

export function itemMatchesVaultTab(kind: VaultItemKind, tab: VaultFilterTab): boolean {
  if (tab === "all") return true;
  if (tab === "logins") return LOGIN_KINDS.has(kind);
  if (tab === "payments") return kind === "card";
  if (tab === "contacts") return CONTACT_KINDS.has(kind);
  return true;
}

export function filterVaultItems(items: readonly VaultItemListing[], tab: VaultFilterTab): VaultItemListing[] {
  if (tab === "all") return [...items];
  return items.filter((item) => itemMatchesVaultTab(item.kind, tab));
}

/** Count shown on each pill. Payments counts cards, connected wallets, pending and history. */
export function vaultTabCounts(input: {
  items: readonly VaultItemListing[];
  purchases?: readonly PurchaseListing[];
  history?: readonly PurchaseListing[];
  wallets?: WalletLinkView;
  methods?: readonly PaymentMethodListing[];
}): Record<VaultFilterTab, number> {
  const items = input.items;
  const pending = (input.purchases ?? []).filter((row) => row.status === "pending").length;
  const history = input.history?.length ?? 0;
  const wallets = input.wallets
    ? (["shop_pay", "link"] as const).filter((wallet) => input.wallets?.[wallet]?.chosen).length
    : (input.methods ?? []).filter((row) => row.type === "wallet").length;
  const cards = items.filter((item) => item.kind === "card").length;
  return {
    all: items.length,
    logins: items.filter((item) => LOGIN_KINDS.has(item.kind)).length,
    payments: cards + wallets + pending + history,
    contacts: items.filter((item) => CONTACT_KINDS.has(item.kind)).length,
  };
}

/** Deep link: wallets / purchases / payments cards, or ?tab= / hash, open Payments. */
export function resolveVaultFilterTab(input: {
  search?: string;
  hash?: string;
  requestedCard?: string | null;
}): VaultFilterTab {
  const params = new URLSearchParams(input.search ?? "");
  const tab = params.get("tab") ?? params.get("vaultTab");
  if (isVaultFilterTab(tab)) return tab;
  const hash = (input.hash ?? "").toLowerCase();
  if (/payments|wallets|purchases/.test(hash)) return "payments";
  if (/logins|onepassword|1password/.test(hash)) return "logins";
  if (/contacts|address/.test(hash)) return "contacts";
  if (input.requestedCard && (VAULT_PAYMENTS_CARD_IDS as readonly string[]).includes(input.requestedCard)) {
    return "payments";
  }
  return "all";
}
