// The person's Perspicax products in Sagax (#4185): the client of
// GET/PUT/POST/DELETE /api/me/perspicax/products (server/routes/person-products.ts)
// and the words of their states, key sources and kinds. Perspicax decides
// the state, the form and the actions; this file only words them.
import { useCallback, useEffect, useState } from "react";

import { t, activeLocale } from "@/lib/i18n";
import { api, ApiError } from "@/state/store";
import type { LocaleKey } from "@/locales";
import type { PersonProduct, ProductAction, ProductFormField, ProductKey, ProductState } from "../../shared/person-products";

export type { PersonProduct, ProductAction, ProductFormField, ProductState } from "../../shared/person-products";

const PRODUCTS = "/api/me/perspicax/products";
const productPath = (id: string) => `${PRODUCTS}/${encodeURIComponent(id)}`;

export const loadPersonProducts = () => api<{ products: PersonProduct[] }>(PRODUCTS).then((body) => body.products ?? []);
export const loadPersonProduct = (id: string) => api<{ product: PersonProduct }>(productPath(id)).then((body) => body.product);
export const savePersonProductKey = (id: string, values: Record<string, string>) =>
  api<{ product: PersonProduct }>(`${productPath(id)}/key`, { method: "PUT", body: JSON.stringify({ values }) }).then((body) => body.product);
export const testPersonProduct = (id: string) =>
  api<{ product: PersonProduct }>(`${productPath(id)}/test`, { method: "POST", body: "{}" }).then((body) => body.product);
export const removePersonProductKey = (id: string) =>
  api<{ product: PersonProduct }>(`${productPath(id)}/key`, { method: "DELETE" }).then((body) => body.product);

/** A server without the routes (solo, not linked, an older Perspicax): no row, no error. */
export function productsUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** The person's products while `active` (the Me scope on an organization
 * server). `products` stays empty when the server has none to show. */
export function usePersonProducts(active: boolean, initial?: PersonProduct[]) {
  const [products, setProducts] = useState<PersonProduct[]>(initial ?? []);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setProducts(await loadPersonProducts());
      setError(null);
    } catch (failure) {
      setProducts([]);
      setError(productsUnavailable(failure) ? null : failure instanceof Error ? failure.message : String(failure));
    }
  }, []);
  useEffect(() => {
    if (active && !initial) void refresh();
    if (!active) setProducts([]);
  }, [active, initial, refresh]);
  /** a product the page or the card changed: the row follows at once */
  const replace = useCallback((product: PersonProduct) => {
    setProducts((current) => current.map((entry) => entry.id === product.id ? product : entry));
  }, []);
  return { products: active ? products : [], error: active ? error : null, refresh, replace };
}

const STATE_KEY: Record<ProductState, LocaleKey> = {
  connected: "personProducts.state.connected",
  no_key_needed: "personProducts.state.connected",
  key_missing: "personProducts.state.keyMissing",
  key_refused: "personProducts.state.keyRefused",
  key_expired: "personProducts.state.keyExpired",
  key_misfit: "personProducts.state.keyMisfit",
  sign_in_needed: "personProducts.state.signInNeeded",
  setup_incomplete: "personProducts.state.setupIncomplete",
  not_served: "personProducts.state.notServed",
  unknown: "personProducts.state.unknown",
};

/** The state in words: "Connected", "Key missing", ... */
export function productStateLabel(state: ProductState): string {
  return t(STATE_KEY[state]);
}

export function productConnected(state: ProductState): boolean {
  return state === "connected" || state === "no_key_needed";
}

/** The grey line under the name: the roles that give the product, else
 * its address. The state is said once, at the row's right. */
export function productRowSub(product: PersonProduct): string {
  if (product.roles.length > 0) return product.roles.map((role) => role.name).join(", ");
  return product.address ? hostOf(product.address) : "";
}

/** How a state reads at a row's right: a key the person can fix asks for
 * attention; an administrator's step is quiet. */
export function productStateTone(state: ProductState): "connected" | "attention" | "quiet" {
  if (productConnected(state)) return "connected";
  return state === "setup_incomplete" || state === "not_served" ? "quiet" : "attention";
}

export function hostOf(address: string): string {
  try {
    return new URL(address).host || address;
  } catch {
    return address;
  }
}

/** Who the serving key is from, in words. */
export function productKeySourceLabel(key: ProductKey, roles: PersonProduct["roles"]): string {
  if (key.source === "own") return t("personProducts.key.own");
  if (key.source === "role") {
    // with several roles the contract does not say whose key serves: generic words
    const role = roles.length === 1 ? roles[0]!.name : undefined;
    return role ? t("personProducts.key.role", { role }) : t("personProducts.key.roleAny");
  }
  if (key.source === "shared") return t("personProducts.key.shared");
  return t("personProducts.key.unknownSource");
}

const KIND_KEY: Record<string, LocaleKey> = {
  none: "personProducts.kind.none",
  api_key: "personProducts.kind.apiKey",
  bearer: "personProducts.kind.bearer",
  basic: "personProducts.kind.basic",
  oauth_client_credentials: "personProducts.kind.oauthClient",
  oauth_authorization_code: "personProducts.kind.oauthCode",
  token_login: "personProducts.kind.tokenLogin",
  web_session: "personProducts.kind.webSession",
};

/** A key kind in words; a kind this version does not know reads "Key". */
export function productKindLabel(kind: string | undefined): string {
  const key = kind ? KIND_KEY[kind.toLowerCase().replace(/[\s-]+/g, "_")] : undefined;
  return t(key ?? "personProducts.kind.other");
}

const MODE_KEY: Record<string, LocaleKey> = {
  read: "personProducts.mode.read",
  read_only: "personProducts.mode.read",
  write: "personProducts.mode.write",
  read_write: "personProducts.mode.write",
  dispatch: "personProducts.mode.dispatch",
  full: "personProducts.mode.full",
};

/** A role's serving mode in words; an unknown one shows as given. */
export function productModeLabel(mode: string | undefined): string | null {
  if (!mode) return null;
  const key = MODE_KEY[mode.toLowerCase()];
  return key ? t(key) : mode;
}

/** A form field's label in the reader's language. */
export function productFieldLabel(field: ProductFormField): string {
  const french = activeLocale().toLowerCase().startsWith("fr");
  return (french ? field.label.fr ?? field.label.en : field.label.en ?? field.label.fr) ?? field.slot;
}

/** Whether the person may type a key here: Perspicax listed the action and a form. */
export function productKeyAction(product: PersonProduct): Extract<ProductAction, "set_own_key" | "replace_key"> | null {
  if (!product.form) return null;
  if (product.actions.includes("set_own_key")) return "set_own_key";
  if (product.actions.includes("replace_key")) return "replace_key";
  return null;
}
