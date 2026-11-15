/** #4359: which of the person's organization products (Perspicax, as
 * Connect Apps > Manage lists them at the Me scope) one bot may use. The
 * switch is per bot (`WireBot.products[id] === false` turns one off), drawn
 * at the This bot scope like a built-in plugin's. A product the bot never
 * switched is on: a bot saved before the switch existed keeps every product
 * (no data rewrite), and the main bot does everything until the person says
 * otherwise.
 *
 * A product id is the API id Perspicax names in api_list and in the product
 * list; its tools are named `<id>_<tool>` (`<id>__<tool>` on an older
 * Perspicax). The server drops an off product's tools from the bot's tool
 * list, its search and its answers, and refuses a call of one
 * (server/perspicax/bot-products-filter.ts). */

/** A product id as Perspicax names it. */
export const BOT_PRODUCT_ID = /^[a-z0-9][a-z0-9_.-]{0,127}$/;
/** The most product switches one bot keeps. */
export const BOT_PRODUCTS_MAX = 256;

export const normalProductId = (id: string): string => id.trim().toLowerCase();

/** On unless this bot switched it off. */
export function botProductEnabled(bot: { products?: Record<string, boolean> } | null | undefined, id: string): boolean {
  return bot?.products?.[normalProductId(id)] !== false;
}

/** The product ids this bot switched off. */
export function botProductsOff(bot: { products?: Record<string, boolean> } | null | undefined): Set<string> {
  const off = new Set<string>();
  for (const [id, on] of Object.entries(bot?.products ?? {})) if (on === false) off.add(normalProductId(id));
  return off;
}

/** A PATCH body's `products`: product ids with booleans. */
export function parseBotProductsPatch(value: unknown): { ok: true; value: Record<string, boolean> } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "products must be an object" };
  const entries = Object.entries(value);
  if (entries.length > BOT_PRODUCTS_MAX) return { ok: false, error: `products takes at most ${BOT_PRODUCTS_MAX} entries` };
  const out: Record<string, boolean> = {};
  for (const [raw, on] of entries) {
    const id = normalProductId(raw);
    if (!BOT_PRODUCT_ID.test(id)) return { ok: false, error: `products: not a product id: ${raw.slice(0, 64)}` };
    if (typeof on !== "boolean") return { ok: false, error: `products.${id} must be true or false` };
    out[id] = on;
  }
  return { ok: true, value: out };
}

/** The bot's saved switches after a PATCH: kept entries, the patch's on top.
 * Bounded: the oldest entries go first past BOT_PRODUCTS_MAX. */
export function botProductsAfter(current: Record<string, boolean> | undefined, patch: Record<string, boolean>): Record<string, boolean> {
  const merged = { ...current, ...patch };
  const keys = Object.keys(merged);
  return keys.length <= BOT_PRODUCTS_MAX ? merged : Object.fromEntries(keys.slice(-BOT_PRODUCTS_MAX).map((key) => [key, merged[key]!]));
}

/** The product a tool belongs to: the longest known id the tool's name
 * starts with, followed by `_` (or `__`), or undefined. */
export function productOfTool(tool: string, known: Iterable<string>): string | undefined {
  const name = tool.trim().toLowerCase();
  let best: string | undefined;
  for (const raw of known) {
    const id = normalProductId(raw);
    if (!id || (best && best.length >= id.length)) continue;
    if (name.length > id.length + 1 && name.startsWith(id) && name[id.length] === "_") best = id;
  }
  return best;
}
