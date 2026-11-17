// The person's Perspicax products in Sagax (#4185): the client of
// GET/PUT/POST/DELETE /api/me/perspicax/products (server/routes/person-products.ts)
// and the words of their states, key sources and kinds. Perspicax decides
// the state, the form and the actions; this file only words them.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { t, activeLocale } from "@/lib/i18n";
import { api, ApiError } from "@/state/store";
import type { LocaleKey } from "@/locales";
import type { PersonProduct, ProductFormField, ProductKey, ProductKeyTarget, ProductState } from "../../shared/person-products";

export type { PersonProduct, ProductAction, ProductFormField, ProductKeyTarget, ProductState } from "../../shared/person-products";

const PRODUCTS = "/api/me/perspicax/products";
const productPath = (id: string) => `${PRODUCTS}/${encodeURIComponent(id)}`;

export const loadPersonProducts = () => api<{ products: PersonProduct[] }>(PRODUCTS).then((body) => body.products ?? []);
export const loadPersonProduct = (id: string) => api<{ product: PersonProduct }>(productPath(id)).then((body) => body.product);
/** `target`: the person's own key, or the key that serves them (Perspicax's KeyBody). */
export const savePersonProductKey = (id: string, target: ProductKeyTarget, values: Record<string, string>) =>
  api<{ product: PersonProduct }>(`${productPath(id)}/key`, { method: "PUT", body: JSON.stringify({ target, values }) }).then((body) => body.product);
export const testPersonProduct = (id: string) =>
  api<{ product: PersonProduct }>(`${productPath(id)}/test`, { method: "POST", body: "{}" }).then((body) => body.product);
export const removePersonProductKey = (id: string) =>
  api<{ product: PersonProduct }>(`${productPath(id)}/key`, { method: "DELETE" }).then((body) => body.product);

/** A server without the routes (solo, not linked, an older Perspicax): no row, no error. */
export function productsUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

// One store of the person's products for the whole app: the Connect apps
// page, a product's page and the chips of record links in the chat all read
// it, so a product connected on one surface shows on the others at once.
/** How long a read of the list is kept for a surface that only needs it. */
export const PERSON_PRODUCTS_TTL_MS = 30_000;

let shared: PersonProduct[] = [];
let sharedAt = 0;
let sharedRead: Promise<PersonProduct[]> | null = null;
const sharedListeners = new Set<() => void>();

function publishProducts(list: PersonProduct[]): void {
  shared = list;
  sharedAt = Date.now();
  for (const listener of sharedListeners) listener();
}

/** One read of the list at a time: a surface that asks while another read is
 * running waits for that one. Fails like `loadPersonProducts`. */
function readProducts(): Promise<PersonProduct[]> {
  if (sharedRead) return sharedRead;
  const read = loadPersonProducts().then(
    (list) => {
      sharedRead = null;
      publishProducts(list);
      return list;
    },
    (failure: unknown) => {
      sharedRead = null;
      throw failure;
    },
  );
  sharedRead = read;
  return read;
}

/** The list for a surface that only needs it: kept for the TTL, read once for
 * everyone who asks. A server without the route (solo, not linked, an older
 * Perspicax) answers nothing. */
export function loadSharedPersonProducts(): Promise<PersonProduct[]> {
  if (!sharedRead && sharedAt && Date.now() - sharedAt < PERSON_PRODUCTS_TTL_MS) return Promise.resolve(shared);
  return readProducts().catch((): PersonProduct[] => {
    publishProducts([]);
    return [];
  });
}

/** Set the list (a gallery, a test). */
export function seedPersonProducts(list: PersonProduct[]): void {
  sharedRead = null;
  publishProducts(list);
}

/** Forget the list (tests; a sign-out). */
export function resetPersonProducts(): void {
  sharedRead = null;
  sharedAt = 0;
  shared = [];
  for (const listener of sharedListeners) listener();
}

function useSharedProducts(): PersonProduct[] {
  return useSyncExternalStore(
    (listener) => {
      sharedListeners.add(listener);
      return () => { sharedListeners.delete(listener); };
    },
    () => shared,
    () => shared,
  );
}

/** The list for a surface that only reads it (a record chip): the shared one,
 * read once on mount when it is missing or older than the TTL. */
export function useSharedPersonProducts(): PersonProduct[] {
  const list = useSharedProducts();
  useEffect(() => { void loadSharedPersonProducts(); }, []);
  return list;
}

/** The person's products while `active` (the Me scope on an organization
 * server). `products` stays empty when the server has none to show. The list
 * is the app's shared one: what this hook reads, replaces or refreshes is
 * what every other reader sees. */
export function usePersonProducts(active: boolean, initial?: PersonProduct[]) {
  const list = useSharedProducts();
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      await readProducts();
      setError(null);
    } catch (failure) {
      publishProducts([]);
      setError(productsUnavailable(failure) ? null : failure instanceof Error ? failure.message : String(failure));
    }
  }, []);
  useEffect(() => {
    if (active && initial) publishProducts(initial);
    else if (active) void refresh();
  }, [active, initial, refresh]);
  /** a product the page or the card changed: the row follows at once */
  const replace = useCallback((product: PersonProduct) => {
    publishProducts(shared.map((entry) => entry.id === product.id ? product : entry));
  }, []);
  return { products: active ? list : [], error: active ? error : null, refresh, replace };
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

/** The roles somebody named that give the person the product: a personal
 * profile (the hidden role of a direct link) is never read as a role name. */
export function namedRoles(product: Pick<PersonProduct, "roles">): PersonProduct["roles"] {
  return product.roles.filter((role) => !role.personal);
}

/** The grey line under the name: the roles that give the product, else
 * its address. The state is said once, at the row's right. */
export function productRowSub(product: PersonProduct): string {
  const roles = namedRoles(product);
  if (roles.length > 0) return roles.map((role) => role.name).join(", ");
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

/** Who the serving key is from, in words (Perspicax's PersonKey.source:
 * user, profile, default). */
export function productKeySourceLabel(key: ProductKey, product: Pick<PersonProduct, "roles">): string {
  if (key.source === "own") return t("personProducts.key.own");
  if (key.source === "role") {
    // with several roles the contract does not say whose key serves: generic words
    const roles = namedRoles(product);
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

// The serving modes Perspicax names for a held profile (#1960; Perspicax
// docs/mcp-surface.md): how the product's tools are laid out for the bot.
const MODE_KEY: Record<string, LocaleKey> = {
  model: "personProducts.mode.model",
  per_operation: "personProducts.mode.perOperation",
  compact: "personProducts.mode.compact",
  minimal: "personProducts.mode.minimal",
  group: "personProducts.mode.group",
  hybrid: "personProducts.mode.hybrid",
};

/** A profile's serving mode in words; a mode Perspicax has not named yet is
 * hidden, never shown as a raw slug. */
export function productModeLabel(mode: string | undefined): string | null {
  if (!mode) return null;
  const key = MODE_KEY[mode.toLowerCase().replace(/[\s-]+/g, "_")];
  return key ? t(key) : null;
}

/** A form field's label in the reader's language. */
export function productFieldLabel(field: ProductFormField): string {
  const french = activeLocale().toLowerCase().startsWith("fr");
  return (french ? field.label.fr ?? field.label.en : field.label.en ?? field.label.fr) ?? field.slot;
}

/** The keys the person may type here, in order: their own (set_own_key),
 * then the one that serves them (replace_key). None without a form. */
export function productKeyTargets(product: Pick<PersonProduct, "form" | "actions">): ProductKeyTarget[] {
  if (!product.form) return [];
  return [
    ...(product.actions.includes("set_own_key") ? ["own" as const] : []),
    ...(product.actions.includes("replace_key") ? ["serving" as const] : []),
  ];
}
