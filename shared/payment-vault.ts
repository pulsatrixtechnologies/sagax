// Cards, addresses and contacts in the person's own vault, and the words of
// a purchase approval. A card number and its security code never appear in
// a listing, a tool result or these texts. The browser fill types them
// (server/credential-vault.ts) only after the person approved the purchase.
//
// Pure: no disk, no clock, no node built-ins.

export const CARD_BRANDS = ["visa", "mastercard", "amex", "discover", "card"] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];

export const PAYMENT_FILL_FIELDS = [
  "cardNumber", "cardExpiry", "cardCvc", "cardholder",
  "addressLine1", "addressLine2", "addressCity", "addressRegion", "addressPostal", "addressCountry", "addressRecipient", "addressPhone",
  "contactName", "contactEmail", "contactPhone", "contactCompany",
] as const;
export type PaymentFillField = (typeof PAYMENT_FILL_FIELDS)[number];

export function isPaymentFillField(value: unknown): value is PaymentFillField {
  return typeof value === "string" && (PAYMENT_FILL_FIELDS as readonly string[]).includes(value);
}

export interface StoredCard {
  pan: string;
  cvv: string;
  expMonth: number;
  expYear: number;
  holder: string;
  brand: CardBrand;
  last4: string;
}

/** What the owner and an approval card may see. Never the number, never the code. */
export interface PublicCard {
  brand: CardBrand;
  last4: string;
  expMonth: number;
  expYear: number;
  holder: string;
}

export interface StoredAddress {
  recipient: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postal: string;
  country: string;
  phone?: string;
}

export interface StoredContact {
  fullName: string;
  email?: string;
  phone?: string;
  company?: string;
}

export function publicCard(card: StoredCard): PublicCard {
  return { brand: card.brand, last4: card.last4, expMonth: card.expMonth, expYear: card.expYear, holder: card.holder };
}

/** Luhn check. 13 to 19 digits. A non-digit fails. */
export function luhnOk(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function cardBrand(pan: string): CardBrand {
  if (pan.startsWith("4")) return "visa";
  if (pan.startsWith("34") || pan.startsWith("37")) return "amex";
  if (pan.startsWith("6011") || pan.startsWith("65")) return "discover";
  const two = Number(pan.slice(0, 2));
  if ((two >= 51 && two <= 55) || (two >= 22 && two <= 27)) return "mastercard";
  return "card";
}

/** A card the person typed. A string is the refusal, with no echo of the number. */
export function parseCard(input: unknown): StoredCard | string {
  const row = record(input);
  if (!row) return "A card needs a number, a security code, an expiry and the name on the card.";
  const pan = typeof row.pan === "string" ? row.pan.replace(/[\s-]/g, "") : "";
  if (!luhnOk(pan)) return "The card number is not valid.";
  const brand = cardBrand(pan);
  const cvv = typeof row.cvv === "string" ? row.cvv.trim() : "";
  if (!(brand === "amex" ? /^\d{4}$/.test(cvv) : /^\d{3}$/.test(cvv))) return "The security code is not valid.";
  const expMonth = row.expMonth;
  const expYear = row.expYear;
  if (typeof expMonth !== "number" || !Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12) return "The expiry month is not valid.";
  if (typeof expYear !== "number" || !Number.isInteger(expYear) || expYear < 2000 || expYear > 2100) return "The expiry year is not valid.";
  const holder = clean(row.holder, 80);
  if (!holder) return "The name on the card is required.";
  return { pan, cvv, expMonth, expYear, holder, brand, last4: pan.slice(-4) };
}

/** Keep a saved number when an edit leaves it blank. */
export function mergeCard(current: StoredCard | undefined, input: unknown, creating: boolean): StoredCard | string {
  if (input === undefined && !creating) return current ?? "A card needs a number, a security code, an expiry and the name on the card.";
  const row = record(input) ?? {};
  const pan = typeof row.pan === "string" && row.pan.trim() ? row.pan : current?.pan;
  const cvv = typeof row.cvv === "string" && row.cvv.trim() ? row.cvv : current?.cvv;
  return parseCard({
    pan,
    cvv,
    expMonth: row.expMonth ?? current?.expMonth,
    expYear: row.expYear ?? current?.expYear,
    holder: typeof row.holder === "string" && row.holder.trim() ? row.holder : current?.holder,
  });
}

export function parseAddress(input: unknown): StoredAddress | string {
  const row = record(input);
  if (!row) return "An address needs a recipient, a street, a city, a postal code and a country.";
  const recipient = clean(row.recipient, 80);
  const line1 = clean(row.line1, 120);
  const city = clean(row.city, 80);
  const postal = clean(row.postal, 20);
  const country = typeof row.country === "string" ? row.country.trim().toUpperCase() : "";
  if (!recipient || !line1 || !city || !postal) return "An address needs a recipient, a street, a city, a postal code and a country.";
  if (!/^[A-Z]{2}$/.test(country)) return "The country is a two-letter code, such as CA.";
  const line2 = clean(row.line2, 120);
  const region = clean(row.region, 80);
  const phone = clean(row.phone, 32);
  return {
    recipient, line1, city, postal, country,
    ...(line2 ? { line2 } : {}),
    ...(region ? { region } : {}),
    ...(phone ? { phone } : {}),
  };
}

export function parseContact(input: unknown): StoredContact | string {
  const row = record(input);
  if (!row) return "A contact needs a name.";
  const fullName = clean(row.fullName, 80);
  if (!fullName) return "A contact needs a name.";
  const email = clean(row.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "The contact's email is not valid.";
  const phone = clean(row.phone, 32);
  const company = clean(row.company, 80);
  return { fullName, ...(email ? { email } : {}), ...(phone ? { phone } : {}), ...(company ? { company } : {}) };
}

export function cardExpiryText(card: PublicCard | StoredCard): string {
  return `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}`;
}

/** "12.50". Null when it is not a positive amount under one million. */
export function parseAmount(raw: unknown): string | null {
  const text = typeof raw === "number" && Number.isFinite(raw) ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text);
  if (!(value > 0) || value >= 1_000_000) return null;
  return value.toFixed(2);
}

export function parseCurrency(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

export interface PurchaseAsk {
  merchant: string;
  amount: string;
  currency: string;
  last4: string;
  brand: CardBrand;
  addressName?: string;
  items?: PurchaseItem[];
  flights?: PurchaseFlightLeg[];
}

/** One article of a purchase, as the page lists it. */
export interface PurchaseItem {
  name: string;
  quantity: number;
  /** "12.50", the line's price when the page shows one. */
  price?: string;
}

/** One flight of a purchase. */
export interface PurchaseFlightLeg {
  from: string;
  to: string;
  /** YYYY-MM-DD */
  date: string;
  flight?: string;
  passenger?: string;
}

export const PURCHASE_LIMITS = { items: 30, flights: 8 } as const;

/** 13 to 19 digits in a row, spaces or dashes between: text the bot wrote
 * on a card or a receipt never carries what reads as a card number. */
const CARD_LIKE = /(?:\d[\s.\-_/]*){13,19}/;
function bareText(value: unknown, max: number): string {
  const text = clean(value, max);
  return CARD_LIKE.test(text) ? "" : text;
}

/** "3 articles", "2 flights", or "" when the bot listed nothing. */
export function purchaseContents(ask: { items?: readonly PurchaseItem[]; flights?: readonly PurchaseFlightLeg[] }): string {
  const parts: string[] = [];
  const count = (ask.items ?? []).reduce((sum, item) => sum + item.quantity, 0);
  if (count) parts.push(`${count} ${count === 1 ? "item" : "items"}`);
  const flights = ask.flights?.length ?? 0;
  if (flights) parts.push(`${flights} ${flights === 1 ? "flight" : "flights"}`);
  return parts.join(", ");
}

/** The approval card the person reads. No card number, no security code. */
export function purchaseCardText(ask: PurchaseAsk): { title: string; line: string } {
  const ship = ask.addressName ? `, ship to ${ask.addressName}` : "";
  const contents = purchaseContents(ask);
  return {
    title: `Pay ${ask.amount} ${ask.currency} to ${ask.merchant}?`,
    line: `${contents ? `${contents}. ` : ""}Card ending ${ask.last4} (${ask.brand})${ship}. The bot never sees the number or the security code.`,
  };
}

/** The bot's list of articles. A string is the refusal; undefined, none given. */
export function parsePurchaseItems(raw: unknown): PurchaseItem[] | string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.length > PURCHASE_LIMITS.items) return `items: a list of at most ${PURCHASE_LIMITS.items} articles.`;
  const out: PurchaseItem[] = [];
  for (const entry of raw) {
    const row = record(entry);
    const name = bareText(row?.name, 120);
    if (!row || !name) return "items: each article needs a name (at most 120 characters, no card number).";
    const quantity = row.quantity === undefined ? 1 : row.quantity;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 999) return "items: quantity is a whole number from 1 to 999.";
    const price = row.price === undefined ? null : parseAmount(row.price);
    if (row.price !== undefined && !price) return "items: price is a positive amount, such as 12.50.";
    out.push({ name, quantity, ...(price ? { price } : {}) });
  }
  return out.length ? out : undefined;
}

/** The bot's list of flights. A string is the refusal; undefined, none given. */
export function parsePurchaseFlights(raw: unknown): PurchaseFlightLeg[] | string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.length > PURCHASE_LIMITS.flights) return `flights: a list of at most ${PURCHASE_LIMITS.flights} flights.`;
  const out: PurchaseFlightLeg[] = [];
  for (const entry of raw) {
    const row = record(entry);
    const from = bareText(row?.from, 80);
    const to = bareText(row?.to, 80);
    const date = typeof row?.date === "string" && realDate(row.date) ? row.date : "";
    if (!row || !from || !to || !date) return "flights: each flight needs from, to and date (YYYY-MM-DD).";
    const flight = bareText(row.flight, 20);
    const passenger = bareText(row.passenger, 80);
    out.push({ from, to, date, ...(flight ? { flight } : {}), ...(passenger ? { passenger } : {}) });
  }
  return out.length ? out : undefined;
}

/** What the bot is told. A handle only after the person allowed the fill. */
export function purchaseBotNote(decision: "deny" | "once", ask: { merchant: string; amount: string; currency: string; handle?: string }): string {
  if (decision === "deny") {
    return `Sagax purchase update: the person declined to pay ${ask.amount} ${ask.currency} at ${ask.merchant}. Do not ask for a card number. Continue without paying if you can.`;
  }
  const when = " this time; the next payment asks again";
  const fill = ask.handle
    ? ` Fill it with fill_credential handle ${ask.handle} and field cardNumber, then cardExpiry, cardCvc and cardholder. You never receive the number.`
    : "";
  return `Sagax purchase update: the person allowed the payment of ${ask.amount} ${ask.currency} at ${ask.merchant}${when}.${fill}`;
}

export interface PurchaseCall {
  credential: string;
  amount: string;
  currency: string;
  merchant?: string;
  address?: string;
  contact?: string;
  items?: PurchaseItem[];
  flights?: PurchaseFlightLeg[];
}

/** request_purchase arguments. A string is the refusal. */
export function parsePurchaseCall(params: unknown): PurchaseCall | string {
  const args = (params as { arguments?: unknown } | null)?.arguments;
  const row = record(args);
  if (!row) return "request_purchase needs credential, amount and currency.";
  const credential = typeof row.credential === "string" ? row.credential.trim() : "";
  if (!credential) return "request_purchase needs the card handle (cred_...).";
  const amount = parseAmount(row.amount);
  if (!amount) return "amount must be a positive number, such as 12.50.";
  const currency = parseCurrency(row.currency);
  if (!currency) return "currency must be a three-letter code, such as CAD.";
  const merchant = clean(row.merchant, 80);
  const address = typeof row.address === "string" && row.address.trim() ? row.address.trim() : undefined;
  const contact = typeof row.contact === "string" && row.contact.trim() ? row.contact.trim() : undefined;
  const items = parsePurchaseItems(row.items);
  if (typeof items === "string") return items;
  const flights = parsePurchaseFlights(row.flights);
  if (typeof flights === "string") return flights;
  return {
    credential, amount, currency, ...(merchant ? { merchant } : {}), ...(address ? { address } : {}), ...(contact ? { contact } : {}),
    ...(items ? { items } : {}), ...(flights ? { flights } : {}),
  };
}

export const REQUEST_PURCHASE_TOOL = "request_purchase";

export const REQUEST_PURCHASE_TOOL_SPEC = {
  name: REQUEST_PURCHASE_TOOL,
  description:
    "Ask the person to approve a payment with a card they saved in Sagax. credential is the card handle (cred_...). amount and currency are what the page charges (12.50, CAD): the total, taxes included. List the cart in items (or the flights) so the person sees what they pay for. The page you are on is the merchant. Optional address and contact are handles of a saved address or contact to fill with the card. You never receive the card number or the security code. Nothing is charged until the person allows it on the approval card (or their Primary Bot, when they ask). Then call fill_credential with field cardNumber, cardExpiry, cardCvc and cardholder, place the order, and call record_purchase on the confirmation page.",
  inputSchema: {
    type: "object",
    properties: {
      credential: { type: "string", description: "The card handle, cred_..." },
      amount: { type: "string", description: "The amount, such as 12.50" },
      currency: { type: "string", description: "Three-letter currency, such as CAD" },
      merchant: { type: "string", description: "The shop name, as shown on the page" },
      address: { type: "string", description: "Optional address handle, cred_..." },
      contact: { type: "string", description: "Optional contact handle, cred_..." },
      items: {
        type: "array",
        maxItems: PURCHASE_LIMITS.items,
        description: "What the cart holds, as the page lists it: shown to the person on the card.",
        items: { type: "object", properties: { name: { type: "string" }, quantity: { type: "integer" }, price: { type: "string" } }, required: ["name"], additionalProperties: false },
      },
      flights: {
        type: "array",
        maxItems: PURCHASE_LIMITS.flights,
        description: "For a flight booking: each flight, shown to the person on the card.",
        items: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" }, flight: { type: "string" }, passenger: { type: "string" } }, required: ["from", "to", "date"], additionalProperties: false },
      },
    },
    required: ["credential", "amount", "currency"],
    additionalProperties: false,
  },
} as const;

/** A calendar date YYYY-MM-DD that exists. */
function realDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && year >= 2000 && year <= 2100;
}

export interface PurchaseReceiptCall {
  orderRef?: string;
  /** The total the confirmation page shows, "52.00". */
  total?: string;
  items?: PurchaseItem[];
  flights?: PurchaseFlightLeg[];
}

/** record_purchase arguments. A string is the refusal. */
export function parseReceiptCall(params: unknown): PurchaseReceiptCall | string {
  const args = (params as { arguments?: unknown } | null)?.arguments;
  const row = record(args) ?? {};
  const orderRef = bareText(row.order_ref, 64);
  const total = row.total === undefined ? null : parseAmount(row.total);
  if (row.total !== undefined && !total) return "total: the amount the confirmation page shows, such as 52.00.";
  const items = parsePurchaseItems(row.items);
  if (typeof items === "string") return items;
  const flights = parsePurchaseFlights(row.flights);
  if (typeof flights === "string") return flights;
  return { ...(orderRef ? { orderRef } : {}), ...(total ? { total } : {}), ...(items ? { items } : {}), ...(flights ? { flights } : {}) };
}

export const RECORD_PURCHASE_TOOL = "record_purchase";

export const RECORD_PURCHASE_TOOL_SPEC = {
  name: RECORD_PURCHASE_TOOL,
  description:
    "After the shop confirmed the order, on its confirmation page, record the purchase the person approved with request_purchase: the order number the page shows, and what was bought (items or flights) if it changed. The person sees the receipt in the conversation. A purchase approved once is closed by it: a new payment asks again.",
  inputSchema: {
    type: "object",
    properties: {
      order_ref: { type: "string", description: "The order or booking number the page shows." },
      total: { type: "string", description: "The total the confirmation page shows, such as 52.00. A total that is not the approved amount is shown to the person." },
      items: REQUEST_PURCHASE_TOOL_SPEC.inputSchema.properties.items,
      flights: REQUEST_PURCHASE_TOOL_SPEC.inputSchema.properties.flights,
    },
    additionalProperties: false,
  },
} as const;

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Zero-width and bidi controls: they hide or reorder what a card shows. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  let text = "";
  for (const char of value.replace(INVISIBLE, "")) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) text += char;
  }
  text = text.trim();
  return text.length > max ? "" : text;
}
