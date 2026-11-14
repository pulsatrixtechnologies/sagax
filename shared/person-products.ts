// The person's Perspicax products (#4185): what a linked Perspicax serves a
// Sagax server for the signed-in person (GET /api/v1/pulsabot/people/me/products),
// read by the server (server/perspicax/person-products.ts), forwarded to the
// app as is (GET /api/me/perspicax/products) and drawn in Connect Apps >
// Manage at the Me scope, on a product's page and on the product key card.
//
// Perspicax decides everything: the state, the key form and the actions the
// person may take. Sagax compares nothing and names no product; it words
// generic states and kinds, and ignores what it does not know (an unknown
// state reads "Needs attention", an unknown action or field is dropped).
// No value of a key ever rides here: a key is its source, kind, masked
// ending, expiry and last test.

export const PRODUCT_STATES = [
  "connected", "key_missing", "key_refused", "key_expired", "key_misfit",
  "sign_in_needed", "setup_incomplete", "not_served", "no_key_needed",
] as const;
export type KnownProductState = typeof PRODUCT_STATES[number];
/** A state this version does not know reads as "unknown". */
export type ProductState = KnownProductState | "unknown";

export const PRODUCT_ACTIONS = ["set_own_key", "replace_key", "test", "remove_own_key", "sign_in", "sign_out"] as const;
export type ProductAction = typeof PRODUCT_ACTIONS[number];

export type ProductKeySource = "own" | "role" | "shared";

export interface ProductKeyTest {
  at: string;
  ok: boolean;
  code?: string;
  status?: number;
}

export interface ProductKey {
  source: ProductKeySource | "unknown";
  kind?: string;
  /** only for a key the person may manage */
  name?: string;
  /** the masked ending, never of a secret slot */
  ending?: string;
  expiresAt?: string;
  lastTest?: ProductKeyTest;
}

export interface ProductFormField {
  slot: string;
  label: { en?: string; fr?: string };
  secret: boolean;
  required: boolean;
  placeholder?: string;
}

export interface ProductForm {
  kind: string;
  fields: ProductFormField[];
}

export interface ProductRole {
  slug: string;
  name: string;
  mode?: string;
}

export interface PersonProduct {
  id: string;
  name: string;
  icon?: { domain: string };
  state: ProductState;
  /** Perspicax's stable reason code (a tooltip only) */
  stateCode?: string;
  address?: string;
  roles: ProductRole[];
  key?: ProductKey;
  form?: ProductForm;
  /** web session sign-in fields (a later lot draws them) */
  signIn?: { fields: ProductFormField[] };
  /** the whole authority: Sagax draws exactly these */
  actions: ProductAction[];
  consoleUrl?: string;
}

/** The reason a product key card was raised for. */
export const PRODUCT_CARD_REASONS = ["key_missing", "key_refused", "key_expired", "key_misfit", "setup"] as const;
export type ProductCardReason = typeof PRODUCT_CARD_REASONS[number];

/** The most a product key form may carry: slots and bytes. */
export const PRODUCT_KEY_MAX_FIELDS = 16;
export const PRODUCT_KEY_VALUE_MAX_BYTES = 16 * 1024;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown, max = 2_048): string | undefined =>
  typeof value === "string" && value.trim() && value.length <= max ? value.trim() : undefined;

function parseTest(raw: unknown): ProductKeyTest | undefined {
  const test = record(raw);
  const at = text(test?.at, 64);
  if (!test || !at || typeof test.ok !== "boolean") return undefined;
  const code = text(test.code, 128);
  const status = typeof test.status === "number" && Number.isInteger(test.status) ? test.status : undefined;
  return { at, ok: test.ok, ...(code ? { code } : {}), ...(status !== undefined ? { status } : {}) };
}

function parseKey(raw: unknown): ProductKey | undefined {
  const key = record(raw);
  if (!key) return undefined;
  const source = key.source === "own" || key.source === "role" || key.source === "shared" ? key.source : "unknown";
  const kind = text(key.kind, 64);
  const name = text(key.name, 256);
  const ending = text(key.ending, 16);
  const expiresAt = text(key.expires_at, 64);
  const lastTest = parseTest(key.last_test);
  return {
    source,
    ...(kind ? { kind } : {}), ...(name ? { name } : {}), ...(ending ? { ending } : {}),
    ...(expiresAt ? { expiresAt } : {}), ...(lastTest ? { lastTest } : {}),
  };
}

function parseFields(raw: unknown): ProductFormField[] {
  if (!Array.isArray(raw)) return [];
  const fields: ProductFormField[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const field = record(entry);
    const slot = text(field?.slot, 64);
    if (!field || !slot || seen.has(slot)) continue;
    const labels = record(field.label);
    const plain = text(field.label, 200);
    const en = text(labels?.en, 200) ?? plain;
    const fr = text(labels?.fr, 200);
    const placeholder = text(field.placeholder, 200);
    seen.add(slot);
    fields.push({
      slot,
      label: { ...(en ? { en } : {}), ...(fr ? { fr } : {}) },
      secret: field.secret === true,
      required: field.required === true,
      ...(placeholder ? { placeholder } : {}),
    });
    if (fields.length >= PRODUCT_KEY_MAX_FIELDS) break;
  }
  return fields;
}

/** One product object, tolerant: null without an id and a name; unknown
 * fields dropped, an unknown state kept as "unknown". */
export function parsePersonProduct(raw: unknown): PersonProduct | null {
  const product = record(raw);
  const id = text(product?.id, 256);
  const name = text(product?.name, 256);
  if (!product || !id || !name) return null;
  const state: ProductState = (PRODUCT_STATES as readonly string[]).includes(product.state as string) ? product.state as KnownProductState : "unknown";
  const stateCode = text(product.state_code, 128);
  const address = text(product.address);
  const domain = text(record(product.icon)?.domain, 253);
  const roles = Array.isArray(record(product.access)?.roles)
    ? (record(product.access)!.roles as unknown[]).flatMap((entry) => {
      const role = record(entry);
      const slug = text(role?.slug, 128);
      const roleName = text(role?.name, 256) ?? slug;
      const mode = text(role?.mode, 64);
      return slug && roleName ? [{ slug, name: roleName, ...(mode ? { mode } : {}) }] : [];
    })
    : [];
  const key = parseKey(product.key);
  const formRaw = record(product.form);
  const formKind = text(formRaw?.kind, 64);
  const formFields = parseFields(formRaw?.fields);
  const signInFields = parseFields(record(product.sign_in)?.fields);
  const actions = Array.isArray(product.actions)
    ? [...new Set(product.actions.filter((action): action is ProductAction => (PRODUCT_ACTIONS as readonly unknown[]).includes(action)))]
    : [];
  const consoleUrl = text(product.console_url);
  return {
    id, name, state, roles, actions,
    ...(domain ? { icon: { domain } } : {}),
    ...(stateCode ? { stateCode } : {}),
    ...(address ? { address } : {}),
    ...(key ? { key } : {}),
    ...(formKind && formFields.length > 0 ? { form: { kind: formKind, fields: formFields } } : {}),
    ...(signInFields.length > 0 ? { signIn: { fields: signInFields } } : {}),
    ...(consoleUrl && /^https:\/\//i.test(consoleUrl) ? { consoleUrl } : {}),
  };
}

/** A list answer: `{ products: [...] }` or a bare array. */
export function parsePersonProducts(raw: unknown): PersonProduct[] {
  const list = Array.isArray(raw) ? raw : record(raw)?.products;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const product = parsePersonProduct(entry);
    return product ? [product] : [];
  });
}

/** The values a key form sends: one string per slot the form names, the
 * required ones present. Null: the values do not fit the form. */
export function productKeyValues(form: ProductForm | undefined, raw: unknown): Record<string, string> | null {
  const values = record(raw);
  if (!values) return null;
  const out: Record<string, string> = {};
  let bytes = 0;
  for (const [slot, value] of Object.entries(values)) {
    if (typeof value !== "string") return null;
    if (form && !form.fields.some((field) => field.slot === slot)) return null;
    if (Object.keys(out).length >= PRODUCT_KEY_MAX_FIELDS) return null;
    bytes += slot.length + value.length;
    if (bytes > PRODUCT_KEY_VALUE_MAX_BYTES) return null;
    out[slot] = value;
  }
  if (form) for (const field of form.fields) {
    if (field.required && !out[field.slot]?.trim()) return null;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** The state a product key card needs the person for. */
export function productCardReason(state: ProductState): ProductCardReason | null {
  switch (state) {
    case "key_missing": case "key_refused": case "key_expired": case "key_misfit": return state;
    case "setup_incomplete": case "not_served": case "sign_in_needed": return "setup";
    default: return null;
  }
}

/** What the bot is told once a product key card settled: never a value,
 * never an ending. */
export function productKeyResumeText(name: string, outcome: { ok: boolean; status?: number; code?: string } | "declined"): string {
  if (outcome === "declined") return `${name}: the person did not provide a key.`;
  if (outcome.ok) return `${name}: key set, tested, accepted. Continue the task.`;
  const why = [outcome.status !== undefined ? String(outcome.status) : "", outcome.code ?? ""].filter(Boolean).join(", ");
  return `${name}: key set, the vendor refused it${why ? ` (${why})` : ""}.`;
}
