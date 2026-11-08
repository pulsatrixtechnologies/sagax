// Minimal string catalog — deliberately not a library. The renderer follows
// the system language; unknown tags and untranslated keys fall back to
// English, so a partial pack can ship the day it has one string.
import { languageChoice } from "@/lib/language-preference";
import {
  en,
  ensureLocale,
  localeChoices,
  localeTags,
  locales,
  pickerCodeFor,
  type LocaleKey,
  type LocalePack,
} from "@/locales";

/** "zh-Hant-TW" → exact tag, then "zh-hant", then "zh", then "en". Pure, for tests. */
export function resolveLocale(tag: string | undefined, available: ReadonlySet<string>): string {
  if (!tag) return "en";
  let candidate = tag.toLowerCase();
  while (candidate) {
    if (available.has(candidate)) return candidate;
    const separator = candidate.lastIndexOf("-");
    if (separator < 0) break;
    candidate = candidate.slice(0, separator);
  }
  return "en";
}

// None of the shipped packs is right-to-left; these are here so adding one
// (Arabic, Hebrew, Persian, Urdu) flips the page direction with no other edit.
const RTL_LANGUAGES = new Set(["ar", "fa", "he", "ur"]);

function registeredTags(): Set<string> {
  // Shipped tags plus any temporary pack a test registered on `locales`.
  return new Set([...localeTags, ...Object.keys(locales)]);
}

function applyLocale(resolved: string): void {
  activePack = locales[resolved] ?? en;
  active = resolved;
  // Screen readers choose pronunciation from <html lang>; index.html ships
  // "en", so without this a German page is read out with English rules.
  const root = typeof document === "undefined" ? undefined : document?.documentElement;
  if (root) {
    root.lang = documentLanguage(resolved);
    root.dir = RTL_LANGUAGES.has(root.lang.split("-")[0]!) ? "rtl" : "ltr";
  }
}

/** Switch the active language (a future settings picker calls this too).
 * Returns the locale that actually took effect after fallback. The registry
 * is read live, so a pack registered after boot is immediately reachable.
 * The pack must already be in `locales` (ensureLocale / loadLocale); otherwise
 * English strings show until the pack arrives. */
export function setLocale(tag: string | undefined): string {
  const resolved = resolveLocale(tag, registeredTags());
  applyLocale(resolved);
  return resolved;
}

/** Ensure the pack is loaded, then switch. App boot and language changes use
 * this; setLocale stays sync for tests and already-cached packs. */
export async function loadLocale(tag: string | undefined): Promise<string> {
  const resolved = resolveLocale(tag, registeredTags());
  await ensureLocale(resolved);
  return setLocale(resolved);
}

/** The BCP-47 tag for a registry key, for <html lang>. An alias ("pt",
 * "zh-hk") is tagged as the picker language whose pack it shows, then cased
 * the standard way: "pt-br" → "pt-BR", "zh-hant" → "zh-Hant". */
export function documentLanguage(code: string): string {
  const shown = pickerCodeFor(code);
  // Prefer the pack's picker when the pack is loaded (reference equality used
  // to find it); pickerCodeFor covers the unloaded and alias cases.
  const pack = locales[code];
  const fromPack = pack
    ? localeChoices.find((choice) => locales[choice.code] === pack)?.code
    : undefined;
  const tag = fromPack ?? shown;
  return tag
    .split("-")
    .map((part, index) =>
      index === 0 ? part.toLowerCase()
        : part.length === 2 ? part.toUpperCase()
          : part.length === 4 ? part[0]!.toUpperCase() + part.slice(1).toLowerCase()
            : part.toLowerCase())
    .join("-");
}

/** The locale t() is answering in. React cannot see a module variable, so a
 * memoized subtree that renders catalog strings takes this as a prop and
 * re-renders when it changes — the transcript does exactly that. */
export function activeLocale(): string {
  return active;
}

let active = "en";
let activePack: LocalePack = en;

/** The language of the page that holds this one in a frame, when that page is
 * of the same origin and says it (<html lang>, set by applyLocale). A page
 * preview frame or a widget frame carries no ?lang=, and its error screen
 * read in English under a French page (QA 0.8.66 F11). */
export function embeddingFrameLanguage(win: Pick<Window, "parent"> | undefined = typeof window === "undefined" ? undefined : window): string | undefined {
  try {
    if (!win || !win.parent || win.parent === win) return undefined;
    const lang = win.parent.document?.documentElement?.lang;
    return lang ? lang : undefined;
  } catch {
    // A frame of another origin: its language is not ours to read.
    return undefined;
  }
}

/** ?lang=, else the language of the same-origin page holding this frame, else
 * the device choice, else the system language. Empty device choice means
 * "follow the system". */
function initialLocaleTag(): string | undefined {
  try {
    if (typeof location !== "undefined") {
      const fromUrl = new URLSearchParams(location.search).get("lang");
      if (fromUrl) return fromUrl;
    }
  } catch {
    // Workers and tests may lack a real location.
  }
  const fromFrame = embeddingFrameLanguage();
  if (fromFrame) return fromFrame;
  const choice = languageChoice();
  if (choice === null || choice === "") return globalThis.navigator?.language;
  return choice;
}

// Load English + the active language before any importer paints. Other packs
// stay out of the startup chunk until loadLocale asks for them.
await loadLocale(initialLocaleTag());

/** Translate a key the server chose rather than the renderer — the note a
 * held approval card shows. A key this build does not know (an older client
 * meeting a newer server, or a card saved before the key existed) falls back
 * to the English the server sends beside it, so the note always reads. */
export function tFromServer(key: string | undefined, fallback: string | undefined): string | undefined {
  return key && Object.hasOwn(en, key) ? t(key as LocaleKey) : fallback;
}

/** Look up a catalog string. `{name}` placeholders interpolate from params;
 * a placeholder without a matching param stays verbatim so a bad pack shows
 * its seams instead of dropping words. */
export function t(key: LocaleKey, params?: Record<string, string | number>): string {
  const template = activePack[key] ?? en[key];
  if (!params) return template;
  return interpolate(active === "fr" || active.startsWith("fr-") ? elideFrench(template, params) : template, params);
}

/** Look up a catalog string in another language than the page's (a call
 * speaks the call's language). Null when that language's pack lacks the
 * key: the caller decides, rather than falling back to English. */
export function tIn(tag: string, key: LocaleKey, params?: Record<string, string | number>): string | null {
  const resolved = resolveLocale(tag, registeredTags());
  if (resolved === "en" && !/^en(?:-|$)/i.test(tag)) return null;
  const pack = locales[resolved];
  if (!pack) return null;
  const template = pack[key];
  if (!template) return null;
  if (!params) return template;
  return interpolate(resolved === "fr" ? elideFrench(template, params) : template, params);
}

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** French elides "de" before a vowel: "Écran de {name}" with "Assistant"
 * reads "Écran d'Assistant", with "Pepper" stays "Écran de Pepper". Only a
 * placeholder's value decides; an "h" is left alone (aspirated or not, a
 * name cannot tell). Pure, for tests. */
export function elideFrench(template: string, params: Record<string, string | number>): string {
  return template.replace(/(^|[\s(«"'’])([Dd])e \{(\w+)\}/g, (match, before: string, d: string, name: string) =>
    name in params && /^[aeiouyàâäæéèêëîïôöœùûü]/iu.test(String(params[name]).trimStart()) ? `${before}${d}'{${name}}` : match,
  );
}
