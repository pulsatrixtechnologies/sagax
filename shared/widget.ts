// A bot-authored chat widget: the JSON tree `show_widget` posts as a message
// of kind "widget" (docs/superpowers/specs/2026-10-13-chat-widgets-design.md).
// Node names and props follow ChatKit's widget components. Model input is
// normalised here once, into a canonical tree, and nothing else is stored or
// drawn: every renderer (desktop, iOS, Android) reads canonical trees only.
import type { JsonValue } from "./json.ts";

export const WIDGET_VERSION = 1;

/** Past any of these, model input is refused with the path of the problem. */
export const WIDGET_LIMITS = {
  bytes: 32_000,
  nodes: 250,
  depth: 10,
  listItems: 40,
  options: 40,
  fields: 20,
  tableRows: 60,
  tableCols: 8,
  chartRows: 100,
  chartSeries: 4,
  images: 8,
  /** Products side by side in one Carousel. */
  carouselItems: 8,
  /** Badges on one Product ("Best seller", "Free shipping"). */
  productBadges: 3,
  /** A product page's address: short enough that Buy now's payload fits. */
  productUrl: 1_000,
  text: 2_000,
  markdown: 6_000,
  title: 120,
  caption: 240,
  label: 80,
  actionPayloadBytes: 2_000,
  fieldValue: 2_000,
  fallback: 1_500,
} as const;

/** ChatKit's icon names, plus a few this app needs. Each platform maps them
 * to its own set; a name outside this list never reaches a renderer. */
export const WIDGET_ICON_NAMES: readonly string[] = [
  "info", "agent", "analytics", "atom", "batch", "bolt", "book-open", "book-closed", "book-clock", "bug", "calendar",
  "chart", "check", "check-circle", "check-circle-filled", "chevron-left", "chevron-right", "circle-question", "compass",
  "confetti", "cube", "desktop", "document", "dot", "dots-horizontal", "dots-vertical", "empty-circle", "external-link",
  "globe", "keys", "lab", "images", "lifesaver", "lightbulb", "mail", "map-pin", "maps", "mobile", "name", "notebook",
  "notebook-pencil", "page-blank", "phone", "play", "plus", "profile", "profile-card", "reload", "star", "star-filled",
  "search", "sparkle", "sparkle-double", "square-code", "square-image", "square-text", "suitcase", "settings-slider",
  "user", "wreath", "write", "write-alt", "write-alt2",
  "pull-request", "upload", "download", "clock", "lock", "link", "file", "folder", "bell", "warning", "close", "arrow-right",
];

export interface WidgetAction {
  type: string;
  payload?: JsonValue;
}

/** In-app destinations a widget button can open on the person's device
 * (2026-11-02, the reference design: a card button that names a place opens
 * it at once, it does not ask the model to). `open_page.payload.page` is one
 * of these. */
export const WIDGET_APP_PAGES = ["routines", "approvals", "team_map", "achievements", "code", "remote_sessions"] as const;
export type WidgetAppPage = (typeof WIDGET_APP_PAGES)[number];

/** Actions the device performs itself. `open_url` opens a link and is never
 * sent; the in-app ones open a Sagax page, a routine or a routine run, and
 * the press is then recorded for the bot as already done (no turn runs). */
export const WIDGET_APP_ACTIONS = ["open_page", "open_routine", "open_run"] as const;
export type WidgetAppAction =
  | { type: "open_page"; page: WidgetAppPage }
  | { type: "open_routine"; routineId: string; botId?: string }
  | { type: "open_run"; runId: string; routineId?: string };

const ID_TEXT = /^[\w.:-]{1,128}$/;

/** The in-app destination an action names, or undefined when it names none. */
export function widgetAppAction(action: WidgetAction | undefined): WidgetAppAction | undefined {
  if (!action || !isRecord(action.payload)) return undefined;
  const payload = action.payload;
  const id = (value: unknown) => (typeof value === "string" && ID_TEXT.test(value) ? value : undefined);
  if (action.type === "open_page") {
    const page = payload.page;
    return typeof page === "string" && (WIDGET_APP_PAGES as readonly string[]).includes(page) ? { type: "open_page", page: page as WidgetAppPage } : undefined;
  }
  if (action.type === "open_routine") {
    const routineId = id(payload.routineId);
    const botId = id(payload.botId);
    return routineId ? { type: "open_routine", routineId, ...(botId ? { botId } : {}) } : undefined;
  }
  if (action.type === "open_run") {
    const runId = id(payload.runId);
    const routineId = id(payload.routineId);
    return runId ? { type: "open_run", runId, ...(routineId ? { routineId } : {}) } : undefined;
  }
  return undefined;
}

/** `confirm` and `cancel` on a root: the buttons under the card. */
export interface WidgetButtonSpec {
  label: string;
  action: WidgetAction;
}

/** One canonical node. `id` is assigned here ("n1", "n2", ... in document
 * order) and is how a press names its button. Props are per type; see the spec. */
export interface WidgetNode {
  type: string;
  id: string;
  children?: WidgetNode[];
  [prop: string]: unknown;
}

/** A canonical root: type "Card" or "ListView". */
export type WidgetRoot = WidgetNode;

/** A widget that took its one answer: it folds to a line and takes no more presses. */
export interface WidgetSettled {
  ref: string;
  label: string;
  tone: "confirm" | "cancel" | "submit";
  at: number;
  sendId?: string;
  /** The field values that went with the press, for the read-only Details view. */
  values?: WidgetValues;
  /** Set while the press waits in the steer queue behind a running turn:
   * cancelling that queued message reopens the widget. */
  queueId?: string;
}

export interface WidgetPayload {
  v: 1;
  root: WidgetRoot;
  /** How many times update_widget has replaced the tree (absent: never). An
   * update renumbers node ids, so a press names the revision it was made on
   * and one made on an older tree is refused instead of landing on whatever
   * now holds that id. */
  rev?: number;
  settled?: WidgetSettled;
}

export type WidgetValues = Record<string, string | boolean>;

export type ParsedWidgetInput = { ok: true; value: WidgetRoot } | { ok: false; error: string };

const ROOT_TYPES = new Set(["Card", "ListView"]);
const FIELD_TYPES = new Set(["Select", "DatePicker", "TimePicker", "DayPicker", "Checkbox", "RadioGroup", "Input", "Textarea"]);
const TYPE_ALIASES: Record<string, string> = { TableRow: "Table.Row", TableCell: "Table.Cell" };
const ACTION_TYPE = /^[A-Za-z0-9_.:-]{1,64}$/;
const FIELD_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Days of the week as a DayPicker stores them, in the order it draws them. */
export const WIDGET_WEEKDAYS: readonly string[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

class WidgetInputError extends Error {}

function fail(path: string, message: string): never {
  throw new WidgetInputError(`${path}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

// ── Prop readers ────────────────────────────────────────────────────────────
// A reader turns one raw prop into its canonical value. `undefined` drops the
// prop (a lenient miss: an unknown token, a CSS value this app does not take).
// A reader throws only where a silently dropped value would post a broken or
// misleading card (a missing label, a bad action, a password field).

type Reader = (raw: unknown, path: string) => unknown;

function text(max: number, mode: "optional" | "required" | "nonEmpty" = "optional"): Reader {
  return (raw, path) => {
    if (raw === undefined || raw === null) return mode === "optional" ? undefined : fail(path, "is required");
    if (typeof raw !== "string" && typeof raw !== "number") return fail(path, "must be a string");
    const value = String(raw).trim();
    if (value.length > max) return fail(path, `must be at most ${max} characters`);
    if (!value && mode === "nonEmpty") return fail(path, "must not be blank");
    if (!value && mode === "optional") return undefined;
    return value;
  };
}

/** One line of text: a label, a title, a placeholder. A run of whitespace,
 * line breaks included, becomes one space, so nothing a bot writes into a
 * label can add a line to the message a press is recorded as. */
function line(max: number, mode: "optional" | "required" | "nonEmpty" = "optional"): Reader {
  const read = text(max, mode);
  return (raw, path) => read(typeof raw === "string" ? raw.replace(/\s+/g, " ") : raw, path);
}

function oneOf(...values: string[]): Reader {
  return (raw) => (typeof raw === "string" && values.includes(raw) ? raw : undefined);
}

function mapped(map: Record<string, string>): Reader {
  return (raw) => (typeof raw === "string" && Object.hasOwn(map, raw) ? map[raw] : undefined);
}

const on: Reader = (raw) => (raw === true ? true : undefined);
/** For props whose default is on: only an explicit `false` is kept. */
const off: Reader = (raw) => (raw === false ? false : undefined);

function pxOf(raw: unknown): number | undefined {
  const match = typeof raw === "string" ? /^(\d+(?:\.\d+)?)px$/.exec(raw.trim()) : null;
  return match ? Number(match[1]) : undefined;
}

/** A ChatKit spacing value: a unit (4px each) or a px string. */
function spacing(max = 64): Reader {
  return (raw) => {
    const px = typeof raw === "number" && Number.isFinite(raw) ? raw * 4 : pxOf(raw);
    return px === undefined ? undefined : clamp(Math.round(px), 0, max);
  };
}

/** A ChatKit size: px as a number or a px string; "100%" is "full". */
function length(max = 2_000): Reader {
  return (raw) => {
    if (raw === "100%" || raw === "full") return "full";
    const px = typeof raw === "number" && Number.isFinite(raw) ? raw : pxOf(raw);
    // under a pixel is not a size: it is how content gets hidden
    return px === undefined || px < 1 ? undefined : clamp(Math.round(px), 1, max);
  };
}

function integer(min: number, max: number): Reader {
  return (raw) => {
    const value = typeof raw === "string" && raw.trim() ? Number(raw) : raw;
    return typeof value === "number" && Number.isFinite(value) ? clamp(Math.round(value), min, max) : undefined;
  };
}

function decimal(min: number, max: number): Reader {
  return (raw) => {
    const value = typeof raw === "string" && raw.trim() ? Number(raw) : raw;
    return typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : undefined;
  };
}

const padding: Reader = (raw) => {
  const side = spacing();
  if (!isRecord(raw)) {
    const all = side(raw, "");
    return typeof all === "number" ? [all, all, all, all] : undefined;
  }
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = side(raw[key], "");
      if (typeof value === "number") return value;
    }
    return 0;
  };
  const sides = [pick("top", "y"), pick("right", "x"), pick("bottom", "y"), pick("left", "x")];
  return sides.some(Boolean) ? sides : undefined;
};

const RADII: Record<string, number> = { none: 0, "2xs": 2, xs: 4, sm: 6, md: 8, lg: 12, xl: 16, "2xl": 20, "3xl": 24, "4xl": 28, full: 999, "100%": 999 };
const radius: Reader = (raw) => (typeof raw === "number" && Number.isFinite(raw) ? clamp(Math.round(raw), 0, 999) : typeof raw === "string" && Object.hasOwn(RADII, raw) ? RADII[raw] : undefined);

const aspectRatio: Reader = (raw) => {
  const parts = typeof raw === "string" ? /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(raw.trim()) : null;
  const value = parts ? Number(parts[1]) / Number(parts[2]) : typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? clamp(value, 0.1, 10) : undefined;
};

const background = mapped({
  surface: "surface", secondary: "secondary", tertiary: "tertiary", elevated: "elevated",
  "surface-secondary": "secondary", "surface-tertiary": "tertiary", "surface-elevated": "elevated", "surface-elevated-secondary": "elevated",
});
const inkColor = mapped({ prose: "primary", primary: "primary", emphasis: "primary", secondary: "secondary", tertiary: "tertiary", success: "success", warning: "warning", danger: "danger" });
const border: Reader = (raw) => {
  const size = isRecord(raw) ? raw.size : raw;
  return typeof size === "number" && Number.isFinite(size) && size > 0 ? clamp(Math.round(size), 1, 2) : undefined;
};
const weight = oneOf("normal", "medium", "semibold", "bold");
const textAlign = oneOf("start", "center", "end");

function icon(fallback?: string): Reader {
  return (raw) => (typeof raw === "string" && WIDGET_ICON_NAMES.includes(raw) ? raw : raw === undefined || raw === null ? undefined : fallback);
}

/** A layout share. Two decimals is finer than any screen; a share that rounds
 * to nothing is dropped, because a zero weight is an error in a renderer. */
const flexShare: Reader = (raw, path) => {
  const share = decimal(0, 12)(raw, path);
  const rounded = typeof share === "number" ? Math.round(share * 100) / 100 : 0;
  return rounded > 0 ? rounded : undefined;
};

/** The dates a picker may be asked to show. Far outside them a platform's own
 * calendar range runs out. */
const DATE_YEARS = { min: 1900, max: 2200 } as const;

const isoDate: Reader = (raw) => {
  if (typeof raw !== "string" || !ISO_DATE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) return undefined;
  const year = Number(raw.slice(0, 4));
  return year >= DATE_YEARS.min && year <= DATE_YEARS.max ? raw : undefined;
};

/** A time of day, "HH:MM" on a 24-hour clock. "9:05" and "09:05:00" are read as 09:05. */
const timeOfDay: Reader = (raw) => {
  const match = typeof raw === "string" ? /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw.trim()) : null;
  const value = match ? `${match[1].padStart(2, "0")}:${match[2]}` : undefined;
  return value && TIME_OF_DAY.test(value) ? value : undefined;
};

/** Days of the week: an array or a comma list of names ("mon", "Monday",
 * "MON"), stored as a comma list in week order with no repeats. */
function weekdays(raw: unknown): string | undefined {
  const items = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const picked = new Set(items.filter((item): item is string => typeof item === "string").map((item) => item.trim().toLowerCase().slice(0, 3)));
  const days = WIDGET_WEEKDAYS.filter((day) => picked.has(day));
  return days.length ? days.join(",") : undefined;
}
const weekdaysReader: Reader = (raw) => weekdays(raw);

/** A Progress value: a fraction from 0 to 1. A bot that writes a percentage
 * (75, or "75%") means a percentage. */
const progressValue: Reader = (raw) => {
  const percent = typeof raw === "string" ? /^\s*(\d+(?:\.\d+)?)\s*%\s*$/.exec(raw) : null;
  const value = percent ? Number(percent[1]) / 100 : typeof raw === "string" && raw.trim() ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return clamp(value > 1 && value <= 100 ? value / 100 : value, 0, 1);
};

const action: Reader = (raw, path) => {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw) || typeof raw.type !== "string" || !ACTION_TYPE.test(raw.type)) {
    return fail(path, 'must be {type, payload?} with a type of letters, digits and "_.:-"');
  }
  const out: WidgetAction = { type: raw.type };
  if (raw.payload !== undefined) {
    const json = JSON.stringify(raw.payload);
    if (json === undefined) return fail(`${path}.payload`, "must be JSON");
    if (json.length > WIDGET_LIMITS.actionPayloadBytes) return fail(`${path}.payload`, `must be at most ${WIDGET_LIMITS.actionPayloadBytes} characters of JSON`);
    out.payload = JSON.parse(json) as JsonValue;
  }
  if (out.type === "open_url" && !isWebUrl(isRecord(out.payload) ? out.payload.url : undefined, ["http:", "https:"])) {
    return fail(`${path}.payload.url`, "open_url needs an http or https url");
  }
  if ((WIDGET_APP_ACTIONS as readonly string[]).includes(out.type) && !widgetAppAction(out)) {
    return fail(`${path}.payload`, out.type === "open_page"
      ? `open_page needs {page} with one of ${WIDGET_APP_PAGES.join(", ")}`
      : out.type === "open_routine" ? "open_routine needs {routineId, botId?}" : "open_run needs {runId, routineId?}");
  }
  return out;
};

function isWebUrl(value: unknown, protocols: string[]): value is string {
  if (typeof value !== "string" || value.length > 2_000) return false;
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const buttonSpec: Reader = (raw, path) => {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) return fail(path, "must be {label, action}");
  const spec: WidgetButtonSpec = {
    label: line(WIDGET_LIMITS.label, "nonEmpty")(raw.label, `${path}.label`) as string,
    action: (action(raw.action, `${path}.action`) ?? fail(`${path}.action`, "is required")) as WidgetAction,
  };
  return spec;
};

const status: Reader = (raw, path) => {
  if (raw === undefined || raw === null) return undefined;
  const record: Record<string, unknown> = isRecord(raw) ? raw : { text: raw };
  const label = line(WIDGET_LIMITS.caption, "nonEmpty")(record.text, `${path}.text`);
  const name = icon()(record.icon, `${path}.icon`);
  return name ? { text: label, icon: name } : { text: label };
};

const options: Reader = (raw, path) => {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > WIDGET_LIMITS.options) return fail(path, `needs 1 to ${WIDGET_LIMITS.options} items`);
  const seen = new Set<string>();
  return raw.map((item, index) => {
    const at = `${path}[${index}]`;
    const record: Record<string, unknown> = isRecord(item) ? item : { value: item };
    const value = line(200, "nonEmpty")(typeof record.value === "boolean" ? String(record.value) : record.value, `${at}.value`) as string;
    if (seen.has(value)) return fail(at, `repeats the value ${JSON.stringify(value)}`);
    seen.add(value);
    return { label: (line(WIDGET_LIMITS.label)(record.label, `${at}.label`) as string | undefined) ?? value, value };
  });
};

/** Names that would write to an object's prototype instead of naming a value. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const fieldName: Reader = (raw, path) => (typeof raw === "string" && FIELD_NAME.test(raw) && !raw.split(".").some((part) => UNSAFE_KEYS.has(part))
  ? raw
  : fail(path, 'is required: letters, digits and "_.-", at most 64'));

const optionalFieldName: Reader = (raw, path) => (raw === undefined || raw === null ? undefined : fieldName(raw, path));

const inputType: Reader = (raw, path) => {
  if (raw === "password") return fail(path, "password fields are not allowed in a widget; use request_credential for secrets");
  return oneOf("text", "number", "email", "tel", "url")(raw, path);
};

const imageSrc: Reader = (raw, path) => (isWebUrl(raw, ["https:"]) ? raw : fail(path, "must be an https url"));

// ── Products ────────────────────────────────────────────────────────────────
// A Product is a shopping card: picture, name, price, store, rating, badges
// and Buy now. Its picture and buttons are ordinary Image and Button children
// written here, so a press is checked, recorded and sent like any other one,
// and a client that does not know Product still draws the picture and Buy now.

/** A price as the card shows it: digits with two decimals ("49.99"). */
const price: Reader = (raw) => {
  const value = typeof raw === "string" ? Number(raw.replace(/[\s,$€£¥]/g, "")) : raw;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1e9 ? value.toFixed(2) : undefined;
};
const currency: Reader = (raw) => (typeof raw === "string" && /^[A-Za-z]{3}$/.test(raw.trim()) ? raw.trim().toUpperCase() : undefined);
const productUrl: Reader = (raw, path) => {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw === "string" && raw.length > WIDGET_LIMITS.productUrl) return fail(path, `must be at most ${WIDGET_LIMITS.productUrl} characters`);
  return isWebUrl(raw, ["http:", "https:"]) ? raw : fail(path, "must be an http or https url");
};
const badges: Reader = (raw, path) => {
  if (raw === undefined || raw === null) return undefined;
  const list = Array.isArray(raw) ? raw : [raw];
  const kept = list.slice(0, WIDGET_LIMITS.productBadges)
    .map((item, index) => line(WIDGET_LIMITS.label)(isRecord(item) ? item.label : item, `${path}[${index}]`))
    .filter((item): item is string => typeof item === "string");
  return kept.length ? kept : undefined;
};

/** What Buy now says the person picked when the bot gave it no action of its own. */
export const PRODUCT_BUY_ACTION = "buy_now";
export const PRODUCT_BUY_LABEL = "Buy now";
export const PRODUCT_VIEW_LABEL = "View";

/** The Product's own children: its picture, Buy now and View. Whatever the
 * bot put under it is replaced: a product card has one layout. */
function productChildren(raw: Record<string, unknown>, path: string): unknown[] {
  const title = line(WIDGET_LIMITS.title, "nonEmpty")(raw.title ?? raw.name, `${path}.title`) as string;
  const url = productUrl(raw.url, `${path}.url`) as string | undefined;
  const children: unknown[] = [];
  if (raw.src !== undefined || raw.image !== undefined) {
    children.push({ type: "Image", src: raw.src ?? raw.image, alt: line(WIDGET_LIMITS.caption)(raw.alt, `${path}.alt`) ?? title, fit: "contain", aspectRatio: 1, radius: 12 });
  }
  const given = action(raw.buyAction, `${path}.buyAction`) as WidgetAction | undefined;
  const payload: Record<string, JsonValue> = { title };
  for (const [key, read] of [["price", price], ["currency", currency], ["store", line(WIDGET_LIMITS.label)]] as const) {
    const value = read(key === "store" ? raw.store ?? raw.seller ?? raw.merchant : raw[key], `${path}.${key}`);
    if (typeof value === "string") payload[key] = value;
  }
  if (url) payload.url = url;
  children.push({
    type: "Button",
    label: line(WIDGET_LIMITS.label)(raw.buyLabel, `${path}.buyLabel`) ?? PRODUCT_BUY_LABEL,
    style: "primary",
    block: true,
    ...(raw.inStock === false ? { disabled: true } : {}),
    onClickAction: given ?? { type: PRODUCT_BUY_ACTION, payload },
  });
  if (url) children.push({ type: "Button", label: PRODUCT_VIEW_LABEL, style: "secondary", block: true, iconEnd: "external-link", onClickAction: { type: "open_url", payload: { url } } });
  return children;
}

const CHART_MAX = 1e12;
const CHART_DAY = /^\d{4}-\d{2}-\d{2}$/;

const chartAsOf: Reader = (raw, path) => {
  if (raw === undefined || raw === null || raw === "") return undefined;
  return typeof raw === "string" && CHART_DAY.test(raw) ? raw : fail(path, "is a date, YYYY-MM-DD");
};

/** Where a chart's numbers came from. Absent: the chart draws as before. */
const chartSources: Reader = (raw, path) => {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.length > 8) return fail(path, "is a list of up to 8 sources");
  return raw.map((item, index) => {
    const at = `${path}[${index}]`;
    if (typeof item === "string" && item.trim()) return { piece: item.trim().slice(0, 200) };
    if (!isRecord(item) || typeof item.piece !== "string" || !item.piece.trim()) return fail(at, "names the piece the numbers came from");
    const asOf = chartAsOf(item.asOf, `${at}.asOf`);
    return { piece: item.piece.trim().slice(0, 200), ...(typeof asOf === "string" ? { asOf } : {}) };
  });
};

const chartData: Reader = (raw, path) => {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > WIDGET_LIMITS.chartRows) return fail(path, `needs 1 to ${WIDGET_LIMITS.chartRows} rows`);
  return raw.map((row, index) => {
    if (!isRecord(row)) return fail(`${path}[${index}]`, "must be an object");
    const out: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(row).slice(0, 12)) {
      if (UNSAFE_KEYS.has(key)) continue;
      if (typeof value === "number" ? Number.isFinite(value) : typeof value === "string" || value === null) {
        // a chart library lays out what it is given: keep numbers within what every one of them can
        out[key.slice(0, 64)] = typeof value === "string" ? value.slice(0, 120) : typeof value === "number" ? clamp(value, -CHART_MAX, CHART_MAX) : null;
      }
    }
    return out;
  });
};

const chartSeries: Reader = (raw, path) => {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > WIDGET_LIMITS.chartSeries) return fail(path, `needs 1 to ${WIDGET_LIMITS.chartSeries} series`);
  return raw.map((item, index) => {
    const at = `${path}[${index}]`;
    if (!isRecord(item)) return fail(at, "must be {type, dataKey}");
    const series: Record<string, string> = {
      type: (oneOf("bar", "line", "area")(item.type, at) as string | undefined) ?? "bar",
      dataKey: text(64, "nonEmpty")(item.dataKey, `${at}.dataKey`) as string,
    };
    const label = line(WIDGET_LIMITS.label)(item.label, `${at}.label`);
    if (typeof label === "string") series.label = label;
    const stack = text(32)(item.stack, `${at}.stack`);
    if (typeof stack === "string") series.stack = stack;
    return series;
  });
};

const chartAxis: Reader = (raw, path) => ({ dataKey: text(64, "nonEmpty")(isRecord(raw) ? raw.dataKey : raw, `${path}.dataKey`) });

// ── Node specs ──────────────────────────────────────────────────────────────

const LAYOUT: Record<string, Reader> = {
  gap: spacing(),
  padding,
  align: oneOf("start", "center", "end", "baseline", "stretch"),
  justify: oneOf("start", "center", "end", "between", "around", "evenly", "stretch"),
  wrap: (raw) => (raw === true || raw === "wrap" ? true : undefined),
  flex: flexShare,
  width: length(), height: length(), minWidth: length(), maxWidth: length(), minHeight: length(), maxHeight: length(),
  aspectRatio, background, border, radius,
};
const TEXT_STYLE: Record<string, Reader> = { weight, color: inkColor, textAlign, truncate: on, maxLines: integer(1, 20), width: length() };
const ROOT: Record<string, Reader> = {
  title: line(WIDGET_LIMITS.title), caption: line(WIDGET_LIMITS.caption), meta: line(WIDGET_LIMITS.label), status,
  confirm: buttonSpec, cancel: buttonSpec,
};
/** Every control: its name, and a label drawn with it, which also names it in
 * the message a press is recorded as. */
const FIELD: Record<string, Reader> = { name: fieldName, label: line(WIDGET_LIMITS.title), disabled: on, required: on };
const PLACEHOLDER = line(WIDGET_LIMITS.title);

interface NodeSpec {
  props: Record<string, Reader>;
  children?: "any" | "items" | "rows" | "cells" | "one" | "products";
}

const SPECS: Record<string, NodeSpec> = {
  Card: { props: { ...ROOT, size: oneOf("sm", "md", "lg", "full"), padding }, children: "any" },
  // `name` makes the list a choice: its rows are selectable, one at a time, and
  // the chosen row's `value` travels with confirm like any other field.
  ListView: { props: { ...ROOT, limit: integer(1, WIDGET_LIMITS.listItems), name: optionalFieldName, defaultValue: line(200) }, children: "items" },
  ListViewItem: { props: { gap: spacing(), align: LAYOUT.align, onClickAction: action, value: line(200) }, children: "any" },
  Box: { props: { ...LAYOUT, direction: oneOf("row", "col") }, children: "any" },
  Row: { props: LAYOUT, children: "any" },
  Col: { props: LAYOUT, children: "any" },
  Form: { props: { ...LAYOUT, direction: oneOf("row", "col"), onSubmitAction: action }, children: "any" },
  Spacer: { props: { minSize: length(400) } },
  Divider: { props: { spacing: spacing(), flush: on } },
  Table: { props: {}, children: "rows" },
  "Table.Row": { props: { header: on }, children: "cells" },
  "Table.Cell": {
    props: { align: textAlign, vAlign: textAlign, colSpan: integer(1, WIDGET_LIMITS.tableCols), rowSpan: integer(1, 20), width: length(), colSize: oneOf("xs", "sm", "md", "lg", "xl"), padding },
    children: "any",
  },
  Text: { props: { value: text(WIDGET_LIMITS.text, "required"), size: oneOf("xs", "sm", "md", "lg", "xl"), ...TEXT_STYLE, italic: on, lineThrough: on, minLines: integer(1, 20) } },
  Title: { props: { value: text(WIDGET_LIMITS.text, "required"), size: oneOf("sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl"), ...TEXT_STYLE } },
  Caption: { props: { value: text(WIDGET_LIMITS.text, "required"), size: oneOf("sm", "md", "lg"), ...TEXT_STYLE } },
  Label: { props: { value: line(WIDGET_LIMITS.title, "nonEmpty"), fieldName: text(64), size: oneOf("xs", "sm", "md", "lg", "xl"), weight, color: inkColor, textAlign, width: length() } },
  Markdown: { props: { value: text(WIDGET_LIMITS.markdown, "required") } },
  Image: {
    props: {
      src: imageSrc, alt: line(WIDGET_LIMITS.caption), fit: oneOf("none", "fill", "cover", "contain", "scale-down"),
      position: oneOf("center", "top", "bottom", "left", "right", "top left", "top right", "bottom left", "bottom right"),
      frame: on, flush: on, width: length(), height: length(), minWidth: length(), maxWidth: length(), minHeight: length(), maxHeight: length(), aspectRatio, radius,
    },
  },
  Icon: { props: { name: icon("dot"), color: inkColor, size: oneOf("xs", "sm", "md", "lg", "xl", "2xl", "3xl") } },
  Chart: { props: { data: chartData, series: chartSeries, xAxis: chartAxis, showYAxis: on, showLegend: off, showGrid: off, height: length(400), aspectRatio, flex: flexShare, width: length(), sources: chartSources, asOf: chartAsOf } },
  Badge: { props: { label: line(WIDGET_LIMITS.label, "nonEmpty"), color: oneOf("secondary", "success", "danger", "warning", "info", "discovery"), variant: oneOf("soft", "solid", "outline", "dot"), size: oneOf("sm", "md", "lg"), pill: off } },
  Progress: { props: { value: progressValue, label: line(WIDGET_LIMITS.caption) } },
  Button: { props: { label: line(WIDGET_LIMITS.label), iconStart: icon(), iconEnd: icon(), block: on, disabled: on, submit: on, onClickAction: action } },
  Select: { props: { ...FIELD, options, placeholder: PLACEHOLDER, defaultValue: text(200), clearable: on, block: on } },
  DatePicker: { props: { ...FIELD, placeholder: PLACEHOLDER, defaultValue: isoDate, min: isoDate, max: isoDate, clearable: on, block: on } },
  // MausBot additions: a time of day, and days of the week
  TimePicker: { props: { ...FIELD, placeholder: PLACEHOLDER, defaultValue: timeOfDay, min: timeOfDay, max: timeOfDay, step: integer(1, 60), clearable: on, block: on } },
  DayPicker: { props: { ...FIELD, defaultValue: weekdaysReader } },
  Checkbox: { props: { ...FIELD, defaultChecked: on } },
  RadioGroup: { props: { ...FIELD, options, defaultValue: text(200), direction: oneOf("row", "col"), ariaLabel: line(WIDGET_LIMITS.title) } },
  Input: { props: { ...FIELD, inputType, placeholder: PLACEHOLDER, defaultValue: text(WIDGET_LIMITS.fieldValue), pattern: text(200) } },
  Textarea: { props: { ...FIELD, placeholder: PLACEHOLDER, defaultValue: text(WIDGET_LIMITS.fieldValue), rows: integer(1, 12), maxRows: integer(1, 20), autoResize: on } },
  Transition: { props: {}, children: "one" },
  // Shopping: products side by side, in stock first, and one product's card.
  Carousel: { props: { title: line(WIDGET_LIMITS.title) }, children: "products" },
  Product: {
    props: {
      title: (raw, path) => line(WIDGET_LIMITS.title, "nonEmpty")(raw, path),
      price, compareAtPrice: price, currency,
      store: line(WIDGET_LIMITS.label), rating: decimal(0, 5), reviews: integer(0, 1e9),
      badges, inStock: off, url: productUrl, delivery: line(WIDGET_LIMITS.caption),
    },
    children: "any",
  },
};

/** Every node type a widget may contain, roots first. */
export const WIDGET_NODE_TYPES: readonly string[] = Object.keys(SPECS);

function buttonStyle(raw: Record<string, unknown>): string {
  if (raw.color === "danger" || raw.style === "danger") return "danger";
  if (raw.variant === "ghost" || raw.style === "quiet") return "quiet";
  if (raw.style === "secondary" || raw.variant === "outline" || raw.variant === "soft" || raw.color === "secondary") return "secondary";
  return raw.style === "primary" || raw.color === "primary" || raw.variant === "solid" || raw.submit === true ? "primary" : "secondary";
}

interface Context {
  nodes: number;
  images: number;
  fields: Set<string>;
}

function typeOf(raw: Record<string, unknown>): string {
  return typeof raw.type === "string" ? TYPE_ALIASES[raw.type] ?? raw.type : "";
}

function normalize(input: unknown, path: string, depth: number, slot: "root" | "any" | "items" | "rows" | "cells" | "products", context: Context): WidgetNode {
  if (!isRecord(input)) return fail(path, "must be an object with a type");
  let raw = input;
  let type = typeOf(raw);
  if (!Object.hasOwn(SPECS, type)) return fail(path, `unknown type ${JSON.stringify(raw.type)}; use one of ${WIDGET_NODE_TYPES.join(", ")}`);
  if (slot === "items" && type !== "ListViewItem") [raw, type] = [{ type: "ListViewItem", children: [raw] }, "ListViewItem"];
  if (slot === "cells" && type !== "Table.Cell") [raw, type] = [{ type: "Table.Cell", children: [raw] }, "Table.Cell"];
  if (slot === "rows" && type !== "Table.Row") return fail(path, "a Table takes Table.Row children");
  if (slot === "products" && type !== "Product") return fail(path, "a Carousel takes Product children");
  if (type === "Product") raw = { ...raw, title: raw.title ?? raw.name, store: raw.store ?? raw.seller ?? raw.merchant, children: productChildren(raw, path) };
  if (slot !== "root" && ROOT_TYPES.has(type)) return fail(path, `${type} is a root and cannot be nested`);
  if (slot === "any" && (type === "Table.Row" || type === "Table.Cell")) return fail(path, `${type} belongs inside a Table`);
  if (depth > WIDGET_LIMITS.depth) return fail(path, `is nested deeper than ${WIDGET_LIMITS.depth} levels`);
  context.nodes += 1;
  if (context.nodes > WIDGET_LIMITS.nodes) return fail(path, `the widget has more than ${WIDGET_LIMITS.nodes} nodes`);

  const spec = SPECS[type];
  const node: WidgetNode = { type, id: `n${context.nodes}` };
  const source: Record<string, unknown> = { ...raw };
  // ChatKit's shorthands for both axes.
  for (const [shorthand, a, b] of [["size", "width", "height"], ["minSize", "minWidth", "minHeight"], ["maxSize", "maxWidth", "maxHeight"]] as const) {
    const both = source[shorthand];
    // `size` on text, icons and badges is a token, not a length.
    if (type === "Card" || type === "Spacer" || !(typeof both === "number" || both === "100%" || pxOf(both) !== undefined)) continue;
    source[a] ??= both;
    source[b] ??= both;
  }
  for (const [key, read] of Object.entries(spec.props)) {
    const value = read(source[key], `${path}.${key}`);
    if (value !== undefined) node[key] = value;
  }
  if (type === "Button") node.style = buttonStyle(raw);
  if (type === "Icon") node.name ??= "dot";
  if (type === "Progress") {
    const max = typeof raw.max === "number" && Number.isFinite(raw.max) && raw.max > 0 ? raw.max : undefined;
    const given = typeof raw.value === "number" && Number.isFinite(raw.value) ? raw.value : undefined;
    // {value: 3, max: 4} is three quarters
    if (max !== undefined && given !== undefined) node.value = clamp(given / max, 0, 1);
    if (node.value === undefined) return fail(`${path}.value`, "is required: a number from 0 to 1");
  }
  if (type === "Image" && ++context.images > WIDGET_LIMITS.images) return fail(path, `the widget has more than ${WIDGET_LIMITS.images} images`);
  if (FIELD_TYPES.has(type)) {
    const name = node.name as string;
    if (context.fields.has(name)) return fail(`${path}.name`, `repeats the field name ${JSON.stringify(name)}`);
    context.fields.add(name);
    if (context.fields.size > WIDGET_LIMITS.fields) return fail(path, `the widget has more than ${WIDGET_LIMITS.fields} fields`);
    if (type === "TimePicker" || type === "DatePicker") {
      if (typeof node.min === "string" && typeof node.max === "string" && node.min > node.max) delete node.max;
      const picked = node.defaultValue;
      if (typeof picked === "string" && ((typeof node.min === "string" && picked < node.min) || (typeof node.max === "string" && picked > node.max))) delete node.defaultValue;
    }
    const chosen = node.defaultValue;
    if ((type === "Select" || type === "RadioGroup") && chosen !== undefined && !(node.options as Array<{ value: string }>).some((option) => option.value === chosen)) delete node.defaultValue;
  }

  if (spec.children) {
    const list = raw.children === undefined || raw.children === null ? [] : Array.isArray(raw.children) ? raw.children : [raw.children];
    const kept = spec.children === "one" ? list.slice(0, 1) : list;
    if (type === "ListView" && kept.length > WIDGET_LIMITS.listItems) return fail(`${path}.children`, `a list takes at most ${WIDGET_LIMITS.listItems} items`);
    if (type === "Table" && kept.length > WIDGET_LIMITS.tableRows) return fail(`${path}.children`, `a table takes at most ${WIDGET_LIMITS.tableRows} rows`);
    if (type === "Table.Row" && kept.length > WIDGET_LIMITS.tableCols) return fail(`${path}.children`, `a row takes at most ${WIDGET_LIMITS.tableCols} cells`);
    if (type === "Carousel") {
      if (kept.length < 1 || kept.length > WIDGET_LIMITS.carouselItems) return fail(`${path}.children`, `a Carousel takes 1 to ${WIDGET_LIMITS.carouselItems} products`);
      // in stock first, the bot's order kept otherwise
      kept.sort((a, b) => Number(isRecord(a) && a.inStock === false) - Number(isRecord(b) && b.inStock === false));
    }
    const childSlot = spec.children === "one" ? "any" : spec.children;
    node.children = kept.map((child, index) => normalize(child, `${path}.children[${index}]`, depth + 1, childSlot, context));
  }
  if (type === "ListView") {
    if (typeof node.name === "string") selectable(node, raw, path, context);
    else {
      // not a choice: a row's value and a default mean nothing here
      delete node.defaultValue;
      for (const row of node.children ?? []) delete row.value;
    }
  }
  if (type === "ListViewItem" && slot !== "items") delete node.value;
  return node;
}

/** A list with a `name`: each row gets a distinct `value` (its own, else the
 * row's name, else its position), a press on a row selects it, and the list
 * is required unless it says otherwise. It needs `confirm`, the only thing
 * that can send the choice. */
function selectable(list: WidgetNode, raw: Record<string, unknown>, path: string, context: Context): void {
  const name = list.name as string;
  if (context.fields.has(name)) fail(`${path}.name`, `repeats the field name ${JSON.stringify(name)}`);
  context.fields.add(name);
  if (context.fields.size > WIDGET_LIMITS.fields) fail(path, `the widget has more than ${WIDGET_LIMITS.fields} fields`);
  if (!isRecord(list.confirm)) fail(`${path}.confirm`, "a list with a name lets the person choose a row; it needs confirm: {label, action} to send the choice");
  const rows = list.children ?? [];
  if (rows.length < 2) fail(`${path}.children`, "a list with a name needs at least two rows to choose from");
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const at = `${path}.children[${index}]`;
    if (row.onClickAction !== undefined) fail(`${at}.onClickAction`, "the rows of a list with a name are selected, not pressed; remove onClickAction from the rows, or remove name from the list");
    const value = widgetString(row, "value") ?? (firstText(row) || String(index + 1));
    if (seen.has(value)) fail(`${at}.value`, `repeats the value ${JSON.stringify(value)}; give each row its own value`);
    seen.add(value);
    row.value = value;
  });
  if (raw.required !== false) list.required = true;
  if (typeof list.defaultValue === "string" && !seen.has(list.defaultValue)) delete list.defaultValue;
}

/** Normalise untrusted model input into a canonical tree, or say what is
 * wrong with it in one sentence that names the path. */
export function parseWidgetInput(value: unknown): ParsedWidgetInput {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { ok: false, error: "widget: must be a JSON object, not text." };
    }
  }
  if (!isRecord(raw)) return { ok: false, error: "widget: must be an object with a type." };
  let bytes: number;
  try {
    bytes = JSON.stringify(raw).length;
  } catch {
    return { ok: false, error: "widget: must be plain JSON." };
  }
  if (bytes > WIDGET_LIMITS.bytes) return { ok: false, error: `widget: is ${bytes} characters of JSON; keep it under ${WIDGET_LIMITS.bytes}.` };
  try {
    const rooted = ROOT_TYPES.has(typeOf(raw)) ? raw : { type: "Card", children: [raw] };
    const root = normalize(rooted, "widget", 1, "root", { nodes: 0, images: 0, fields: new Set() });
    const seen = new Map<string, string>();
    for (const entry of collectActions(root, true)) {
      if (!entry.label) return { ok: false, error: `widget: the ${entry.kind} at ${entry.ref} has an action but no label; give it a label (a list item takes its first Text or Title).` };
      if (entry.client) continue;
      if (seen.has(entry.label)) return { ok: false, error: `widget: two actions are both labelled ${JSON.stringify(entry.label)}; give each a distinct label.` };
      seen.set(entry.label, entry.ref);
    }
    return { ok: true, value: root };
  } catch (error) {
    if (error instanceof WidgetInputError) return { ok: false, error: `${error.message}.` };
    throw error;
  }
}

// ── Reading a canonical tree ────────────────────────────────────────────────

export const widgetString = (node: WidgetNode, key: string): string | undefined => (typeof node[key] === "string" ? node[key] as string : undefined);
export const widgetNumber = (node: WidgetNode, key: string): number | undefined => (typeof node[key] === "number" ? node[key] as number : undefined);

function buttonSpecOf(root: WidgetRoot, key: "confirm" | "cancel"): WidgetButtonSpec | undefined {
  const spec = root[key];
  return isRecord(spec) && typeof spec.label === "string" && isRecord(spec.action) ? spec as unknown as WidgetButtonSpec : undefined;
}

function walk(node: WidgetNode, visit: (node: WidgetNode, ancestors: WidgetNode[]) => void, ancestors: WidgetNode[] = []): void {
  visit(node, ancestors);
  const next = [...ancestors, node];
  for (const child of Array.isArray(node.children) ? node.children : []) if (isRecord(child)) walk(child, visit, next);
}

function lastOf<T>(items: readonly T[], match: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) if (match(items[index])) return items[index];
  return undefined;
}

/** What a row is called: its first Title or Text, on one line. A text held
 * to a fixed width is a column label ("TO"), or can be squeezed to nothing,
 * so it never names the row; and the name stops at the label limit, so what
 * is recorded for a press is what fits on the row the person pressed. */
function firstText(node: WidgetNode): string {
  let found = "";
  walk(node, (inner) => {
    if (found || (inner.type !== "Title" && inner.type !== "Text") || typeof inner.value !== "string" || typeof inner.width === "number") return;
    found = inner.value.replace(/\s+/g, " ").trim().slice(0, WIDGET_LIMITS.label);
  });
  return found;
}

/** One pressable thing in a widget. */
export interface WidgetActionEntry {
  /** "confirm", "cancel", or the node id of the button or list item. */
  ref: string;
  /** What the person is recorded as having said. */
  label: string;
  action: WidgetAction;
  /** Present when the press settles the widget. */
  tone?: "confirm" | "cancel" | "submit";
  /** Handled on the device (open_url, and the in-app open_page, open_routine
   * and open_run). An open_url press is never sent; an in-app one is sent
   * only to be recorded as done, it starts no turn. */
  client?: true;
  kind: "button" | "item" | "confirm" | "cancel";
}

/** What a button inside is named after when its label repeats. */
const ROW_TYPES = new Set(["ListViewItem", "Table.Row", "Row", "Product"]);

function collectActions(root: WidgetRoot, strict: boolean): WidgetActionEntry[] {
  const found: Array<WidgetActionEntry & { row?: string; product?: true }> = [];
  walk(root, (node, ancestors) => {
    if (node.type === "Button") {
      if (node.disabled === true) return;
      const form = lastOf(ancestors, (ancestor) => ancestor.type === "Form");
      const own = isRecord(node.onClickAction) ? node.onClickAction as unknown as WidgetAction : undefined;
      const submitted = node.submit === true && isRecord(form?.onSubmitAction) ? form.onSubmitAction as unknown as WidgetAction : undefined;
      const picked = own ?? submitted;
      if (!picked) {
        if (strict && node.submit === true) throw new WidgetInputError(`widget: the submit Button at ${node.id} needs a Form with onSubmitAction around it`);
        return;
      }
      const row = lastOf(ancestors, (ancestor) => ROW_TYPES.has(ancestor.type));
      const product = row?.type === "Product" ? widgetString(row, "title") : undefined;
      found.push({ ref: node.id, label: widgetString(node, "label") ?? "", action: picked, kind: "button", ...(node.submit === true ? { tone: "submit" as const } : {}), ...(row ? { row: product ?? firstText(row) } : {}), ...(product ? { product: true } : {}) });
    } else if (node.type === "ListViewItem" && isRecord(node.onClickAction)) {
      found.push({ ref: node.id, label: firstText(node), action: node.onClickAction as unknown as WidgetAction, kind: "item" });
    }
  });
  for (const key of ["confirm", "cancel"] as const) {
    const spec = buttonSpecOf(root, key);
    if (spec) found.push({ ref: key, label: spec.label, action: spec.action, tone: key, kind: key });
  }
  // "View" on three rows is three presses: each takes its row's name.
  const counts = new Map<string, number>();
  for (const entry of found) counts.set(entry.label, (counts.get(entry.label) ?? 0) + 1);
  // A product's button always names its product: "Buy now: Trail shoes".
  return found.map(({ row, product, ...entry }) => ({
    ...entry,
    ...(entry.action.type === "open_url" || widgetAppAction(entry.action) ? { client: true as const } : {}),
    label: row && entry.label && (product || (counts.get(entry.label) ?? 0) > 1) ? `${entry.label}: ${row}`.slice(0, WIDGET_LIMITS.label * 2) : entry.label,
  }));
}

/** Every pressable thing in a canonical widget, in document order. */
export function widgetActions(root: WidgetRoot): WidgetActionEntry[] {
  return collectActions(root, false);
}

/** The action a recorded label stands for, for the model's reading of a press. */
export function widgetActionByLabel(root: WidgetRoot, label: string): WidgetActionEntry | undefined {
  return widgetActions(root).find((entry) => !entry.client && entry.label === label);
}

/** Where a press collects its values: the nearest Form around the pressed
 * node, or the whole widget. */
export function widgetScope(root: WidgetRoot, ref: string): WidgetNode {
  let scope: WidgetNode = root;
  walk(root, (node, ancestors) => {
    if (node.id === ref) scope = lastOf(ancestors, (ancestor) => ancestor.type === "Form") ?? root;
  });
  return scope;
}

export interface WidgetField {
  name: string;
  type: string;
  /** Its Label's text, else a Checkbox's own label, else its name: only words
   * drawn beside the field, because this is how the field is named in the
   * message a press is recorded as. */
  label: string;
  node: WidgetNode;
}

/** The named fields under `scope`. Labels are looked up across `root`. */
export function widgetFields(scope: WidgetNode, root: WidgetRoot = scope): WidgetField[] {
  const labels = new Map<string, string>();
  walk(root, (node) => {
    if (node.type === "Label" && typeof node.fieldName === "string" && typeof node.value === "string") labels.set(node.fieldName, node.value);
  });
  const fields: WidgetField[] = [];
  walk(scope, (node) => {
    if (typeof node.name !== "string" || !(FIELD_TYPES.has(node.type) || node.type === "ListView")) return;
    const own = node.type === "ListView" ? widgetString(node, "title") : widgetString(node, "label");
    fields.push({ name: node.name, type: node.type, node, label: labels.get(node.name) ?? own ?? node.name });
  });
  return fields;
}

/** What a choice field offers: a Select's or RadioGroup's options, or the
 * rows of a list with a name (each row's name, and the value it stands for). */
export function widgetFieldOptions(node: WidgetNode): Array<{ label: string; value: string }> {
  if (node.type === "ListView") {
    return (Array.isArray(node.children) ? node.children : []).filter(isRecord).map((row) => {
      const value = String((row as WidgetNode).value ?? "");
      return { label: firstText(row as WidgetNode) || value, value };
    });
  }
  return Array.isArray(node.options) ? node.options as Array<{ label: string; value: string }> : [];
}

/** What each field holds before the person touches it. */
export function widgetInitialValues(scope: WidgetNode): WidgetValues {
  const values: WidgetValues = {};
  for (const field of widgetFields(scope)) {
    values[field.name] = field.type === "Checkbox" ? field.node.defaultChecked === true : widgetString(field.node, "defaultValue") ?? "";
  }
  return values;
}

export type ResolvedWidgetAction =
  | { ok: true; ref: string; label: string; action: WidgetAction; values: WidgetValues; text: string; tone?: "confirm" | "cancel" | "submit"; device?: WidgetAppAction }
  | { ok: false; status: 400 | 404 | 409; error: string };

/** Check one press against the stored widget. `text` is the user message it
 * becomes: the label, then one "Field: value" line per filled field. */
export function resolveWidgetAction(payload: WidgetPayload, ref: string, values: unknown): ResolvedWidgetAction {
  const entry = widgetActions(payload.root).find((candidate) => candidate.ref === ref);
  // Opening a place stays possible once the widget is answered.
  if (payload.settled && !(entry?.client && widgetAppAction(entry.action))) return { ok: false, status: 409, error: "This was already answered." };
  if (!entry) return { ok: false, status: 404, error: "That button is no longer on this widget." };
  if (entry.client) {
    // An in-app destination was opened on the device: the press is recorded
    // so the bot knows, with no values and nothing to settle.
    const device = widgetAppAction(entry.action);
    if (!device) return { ok: false, status: 400, error: "That action opens on the device and is not sent." };
    return { ok: true, ref, label: entry.label, action: entry.action, values: {}, text: entry.label, device };
  }
  const done = (clean: WidgetValues, lines: string[]): ResolvedWidgetAction => ({
    ok: true, ref, label: entry.label, action: entry.action, values: clean, text: [entry.label, ...lines].join("\n"), ...(entry.tone ? { tone: entry.tone } : {}),
  });
  if (entry.tone === "cancel") return done({}, []);

  const scope = widgetScope(payload.root, ref);
  const fields = widgetFields(scope, payload.root);
  const given = values === undefined || values === null ? {} : values;
  if (!isRecord(given)) return { ok: false, status: 400, error: "values must be an object of field names." };
  const known = new Set(fields.map((field) => field.name));
  for (const key of Object.keys(given)) if (!known.has(key)) return { ok: false, status: 400, error: `There is no field named ${JSON.stringify(key)} here.` };

  const initial = widgetInitialValues(scope);
  const clean: WidgetValues = {};
  const lines: string[] = [];
  const mustFill = entry.tone === "confirm" || entry.tone === "submit";
  for (const field of fields) {
    // a field the person could not change keeps what it was drawn with
    const raw = Object.hasOwn(given, field.name) && field.node.disabled !== true ? given[field.name] : initial[field.name];
    if (field.type === "Checkbox") {
      if (typeof raw !== "boolean") return { ok: false, status: 400, error: `${field.label} must be on or off.` };
      if (mustFill && field.node.required === true && !raw) return { ok: false, status: 400, error: `${field.label} is required.` };
      clean[field.name] = raw;
      if (raw) lines.push(`${field.label}: yes`);
      continue;
    }
    if (typeof raw !== "string") return { ok: false, status: 400, error: `${field.label} must be text.` };
    const value = field.type === "Textarea" ? raw.trim() : raw.trim().replace(/\s+/g, " ");
    if (value.length > WIDGET_LIMITS.fieldValue) return { ok: false, status: 400, error: `${field.label} must be at most ${WIDGET_LIMITS.fieldValue} characters.` };
    if (mustFill && field.node.required === true && !value) return { ok: false, status: 400, error: `${field.label} is required.` };
    let shown = value;
    let kept = value;
    if (value && (field.type === "Select" || field.type === "RadioGroup" || field.type === "ListView")) {
      const option = widgetFieldOptions(field.node).find((candidate) => candidate.value === value);
      if (!option) return { ok: false, status: 400, error: `${field.label} must be one of the offered options.` };
      shown = option.label;
    }
    if (value && field.type === "TimePicker") {
      const time = timeOfDay(value, "");
      if (time === undefined) return { ok: false, status: 400, error: `${field.label} must be a time like 09:30.` };
      const min = widgetString(field.node, "min");
      const max = widgetString(field.node, "max");
      if ((min && (time as string) < min) || (max && (time as string) > max)) return { ok: false, status: 400, error: `${field.label} is outside the times offered.` };
      kept = shown = time as string;
    }
    if (field.type === "DayPicker" && value) {
      const days = weekdays(value);
      if (!days || days.split(",").length !== value.split(",").length) return { ok: false, status: 400, error: `${field.label} must be days of the week.` };
      kept = days;
      shown = dayList(days);
    }
    if (value && field.type === "DatePicker") {
      if (isoDate(value, "") === undefined) return { ok: false, status: 400, error: `${field.label} must be a date like 2026-10-14.` };
      const min = widgetString(field.node, "min");
      const max = widgetString(field.node, "max");
      if ((min && value < min) || (max && value > max)) return { ok: false, status: 400, error: `${field.label} is outside the dates offered.` };
    }
    clean[field.name] = kept;
    // whole: this line is all the bot reads of what the person typed
    if (value) lines.push(`${field.label}: ${shown}`);
  }
  return done(clean, lines);
}

/** A word to the bot about a widget that parses but does not do what it
 * looks like it is for: rows to choose between and no way to choose, or a
 * time, date or days the person is asked to type. Undefined when there is
 * nothing to say. */
export function widgetAdvice(root: WidgetRoot): string | undefined {
  const notes: string[] = [];
  const rows = Array.isArray(root.children) ? root.children.length : 0;
  if (root.type === "ListView" && rows >= 2 && buttonSpecOf(root, "confirm") && widgetFields(root).length === 0
    && !widgetActions(root).some((entry) => entry.kind === "item" || entry.kind === "button")) {
    notes.push("No row of this list can be chosen: the person can only confirm or cancel it as a whole. If they are meant to pick one row, call update_widget and give the ListView a name (and each row a value), so the rows become selectable and confirm sends the pick.");
  }
  const typed = widgetFields(root).filter((field) => field.type === "Input" || field.type === "Textarea");
  const asks = (pattern: RegExp) => typed.filter((field) => pattern.test(`${field.name} ${field.label} ${widgetString(field.node, "placeholder") ?? ""}`)).map((field) => field.label);
  const pickers: Array<[RegExp, string]> = [
    [/\b(days?|weekdays?|weekly|repeat)\b/i, "DayPicker"],
    [/\b(times?|o'?clock|hh:mm)\b|\b\d{1,2}(:\d{2})?\s?[ap]m\b|\b\d{1,2}:\d{2}\b/i, "TimePicker"],
    [/\b(dates?|deadline|due)\b/i, "DatePicker"],
  ];
  const seen = new Set<string>();
  for (const [pattern, picker] of pickers) {
    const labels = asks(pattern).filter((label) => !seen.has(label));
    labels.forEach((label) => seen.add(label));
    if (labels.length) notes.push(`${labels.map((label) => JSON.stringify(label)).join(", ")} asks the person to type what a ${picker} lets them pick. Call update_widget with a ${picker} in its place.`);
  }
  return notes.length ? notes.join(" ") : undefined;
}

/** Days as a person says them: "Every day", "Weekdays", "Weekends", or the names. */
export function dayList(days: string): string {
  const picked = days.split(",").filter(Boolean);
  if (picked.length === 7) return "Every day";
  if (picked.join(",") === "mon,tue,wed,thu,fri") return "Weekdays";
  if (picked.join(",") === "sat,sun") return "Weekends";
  const names: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
  return picked.map((day) => names[day] ?? day).join(", ");
}

// ── Text fallback ───────────────────────────────────────────────────────────

function inlineText(node: WidgetNode): string {
  switch (node.type) {
    case "Text": case "Title": case "Caption": case "Label":
      return widgetString(node, "value") ?? "";
    case "Markdown":
      return (widgetString(node, "value") ?? "").replace(/\s+/g, " ");
    case "Badge":
      return widgetString(node, "label") ?? "";
    case "Button":
      return node.label ? `[${String(node.label)}]` : "";
    case "Image":
      return node.alt ? `[image: ${String(node.alt)}]` : "[image]";
    case "Progress":
      return [widgetString(node, "label"), `${Math.round((widgetNumber(node, "value") ?? 0) * 100)}%`].filter(Boolean).join(" ");
    case "Chart": {
      const series = (Array.isArray(node.series) ? node.series as Array<{ label?: string; dataKey: string }> : []).map((item) => item.label ?? item.dataKey).join(", ");
      const sources = Array.isArray(node.sources) ? node.sources as Array<{ piece?: string; asOf?: string }> : [];
      const pieces = sources.map((source) => source.piece?.trim()).filter((piece): piece is string => Boolean(piece));
      const asOf = typeof node.asOf === "string" ? node.asOf : sources.find((source) => source.asOf)?.asOf;
      const cite = [pieces.join(", "), asOf ? `as of ${asOf}` : ""].filter(Boolean).join(", ");
      return `[chart: ${series}${cite ? ` (${cite})` : ""}]`;
    }
    case "Product":
      return productLine(node);
    case "Checkbox":
      return `[ ] ${widgetString(node, "label") ?? String(node.name)}`;
    case "Select": case "RadioGroup":
      return `(${(Array.isArray(node.options) ? node.options as Array<{ label: string }> : []).slice(0, 6).map((option) => option.label).join(" / ")})`;
    case "DayPicker":
      return `[${typeof node.defaultValue === "string" ? dayList(node.defaultValue) : "days"}]`;
    case "Input": case "Textarea": case "DatePicker": case "TimePicker":
      return `[${widgetString(node, "placeholder") ?? String(node.name)}]`;
    default:
      return (Array.isArray(node.children) ? node.children : []).map(inlineText).filter(Boolean).join(" · ");
  }
}

/** One product on one line: name, price, store, rating, stock, badges. */
export function productLine(node: WidgetNode): string {
  const amount = widgetString(node, "price");
  const money = amount ? [amount, widgetString(node, "currency")].filter(Boolean).join(" ") : "";
  const was = widgetString(node, "compareAtPrice");
  const rating = widgetNumber(node, "rating");
  const reviews = widgetNumber(node, "reviews");
  return [
    widgetString(node, "title"),
    money && was ? `${money} (was ${was})` : money,
    widgetString(node, "store"),
    rating !== undefined ? `${rating.toFixed(1)}/5${reviews !== undefined ? ` (${reviews})` : ""}` : "",
    node.inStock === false ? "Out of stock" : "",
    widgetString(node, "delivery"),
    ...(Array.isArray(node.badges) ? node.badges as string[] : []),
  ].filter(Boolean).join(" · ");
}

function blockLines(node: WidgetNode): string[] {
  const children = Array.isArray(node.children) ? node.children : [];
  if (node.type === "Carousel") return [...(widgetString(node, "title") ? [widgetString(node, "title")!] : []), ...children.map((product) => `- ${productLine(product)}`)];
  if (node.type === "Product") return [`- ${productLine(node)}`];
  if (node.type === "ListViewItem") return [`- ${inlineText(node)}`];
  if (node.type === "Table") return children.map((row) => (Array.isArray(row.children) ? row.children : []).map(inlineText).join(" | "));
  if (node.type === "Markdown") return [widgetString(node, "value") ?? ""];
  const stacked = node.type === "Col" || node.type === "Form" || node.type === "Transition" || (node.type === "Box" && node.direction !== "row");
  return stacked ? children.flatMap(blockLines) : [inlineText(node)];
}

/** The readable version of a widget: the message `text`, read by previews,
 * notifications, exports, replayed history and clients that do not know the kind. */
export function widgetToText(root: WidgetRoot): string {
  const lines: string[] = [];
  const statusText = isRecord(root.status) && typeof root.status.text === "string" ? root.status.text : "";
  if (statusText) lines.push(statusText);
  const title = widgetString(root, "title");
  const head = [title ? `**${title}**` : "", widgetString(root, "caption"), widgetString(root, "meta")].filter(Boolean).join(" · ");
  if (head) lines.push(head);
  for (const child of Array.isArray(root.children) ? root.children : []) lines.push(...blockLines(child));
  const buttons = (["confirm", "cancel"] as const).map((key) => buttonSpecOf(root, key)?.label).filter(Boolean).map((label) => `[${label}]`).join(" ");
  if (buttons) lines.push(buttons);
  const out = lines.map((line) => line.trimEnd()).filter(Boolean).join("\n");
  return out.length <= WIDGET_LIMITS.fallback ? out : `${out.slice(0, WIDGET_LIMITS.fallback - 1).trimEnd()}…`;
}
