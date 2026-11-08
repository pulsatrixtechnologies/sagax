import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { documentLanguage, elideFrench, resolveLocale, setLocale, t, tFromServer } from "./i18n";
import { en, localeChoices, localeTags, locales } from "@/locales";

const here = dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  setLocale("en");
});

describe("resolveLocale", () => {
  const available = new Set(["en", "de", "pt-br", "zh", "zh-hant", "zh-tw"]);

  it("keeps a registered exact tag, case-insensitively", () => {
    expect(resolveLocale("pt-BR", available)).toBe("pt-br");
    expect(resolveLocale("de", available)).toBe("de");
  });

  it("falls back from a regional tag to its base language", () => {
    expect(resolveLocale("de-AT", available)).toBe("de");
  });

  it("falls back through script tags before the base language", () => {
    expect(resolveLocale("zh-Hant-TW", available)).toBe("zh-hant");
  });

  it("falls back to English for unknown or missing tags", () => {
    expect(resolveLocale("fr-FR", available)).toBe("en");
    expect(resolveLocale(undefined, available)).toBe("en");
    expect(resolveLocale("", available)).toBe("en");
  });
});

describe("t", () => {
  it("returns the English catalog value by default", () => {
    expect(t("engines.cloud")).toBe("Cloud");
  });

  it("keeps new team lifecycle labels available in partial packs, with interpolated names and counts", () => {
    setLocale("de");
    expect(t("team.create")).toBe("Create team");
    expect(t("team.moveTo", { name: "Research" })).toBe("Move bots to Research");
    expect(t("team.moveMany", { count: 2 })).toBe("Move 2 bots");
    expect(t("team.deleteTitle", { name: "Research" })).toBe("Delete Research team?");
    expect(t("team.instructionsTitle", { name: "Research" })).toBe("Research shared instructions");
  });

  it("elides French \"de\" before a name that starts with a vowel, never in English", () => {
    setLocale("fr");
    expect(t("computer.screenOf", { name: "Assistant" })).toBe("Écran d'Assistant");
    expect(t("computer.browserOf", { name: "Émile" })).toBe("Navigateur d'Émile");
    expect(t("computer.screenOf", { name: "Pepper" })).toBe("Écran de Pepper");
    expect(t("computer.screenOf", { name: "Hugo" })).toBe("Écran de Hugo");
    setLocale("en");
    expect(t("computer.screenOf", { name: "Assistant" })).toBe("Assistant's screen");
  });

  it("elideFrench touches only \"de\" as a word right before a placeholder", () => {
    expect(elideFrench("Mode {name}", { name: "Auto" })).toBe("Mode {name}");
    expect(elideFrench("De {name} à {other}", { name: "Ana", other: "Eve" })).toBe("D'{name} à {other}");
    expect(elideFrench("Écran de {count}", { count: 8 })).toBe("Écran de {count}");
    expect(elideFrench("Écran de {name}", {})).toBe("Écran de {name}");
  });

  it("setLocale reports the locale that actually took effect", () => {
    // a shipped base pack catches its regional variants…
    expect(setLocale("de-AT")).toBe("de");
    expect(t("engines.local")).toBe("Lokal");
    // …and a genuinely unknown tag falls back to English
    expect(setLocale("xx-YY")).toBe("en");
    expect(t("engines.local")).toBe("Local");
  });

  it("resolves every registered locale to itself", () => {
    for (const code of localeTags) {
      expect(resolveLocale(code, localeTags)).toBe(code);
    }
  });

  it("routes common system tags onto the shipped packs", () => {
    expect(resolveLocale("zh-CN", localeTags)).toBe("zh");
    expect(resolveLocale("zh-TW", localeTags)).toBe("zh-tw");
    expect(resolveLocale("zh-Hant-TW", localeTags)).toBe("zh-hant");
    expect(resolveLocale("zh-HK", localeTags)).toBe("zh-hk");
    expect(resolveLocale("ja-JP", localeTags)).toBe("ja");
    expect(resolveLocale("pt-BR", localeTags)).toBe("pt-br");
    expect(resolveLocale("pt-PT", localeTags)).toBe("pt");
    expect(resolveLocale("hi-IN", localeTags)).toBe("hi");
  });

  it("eagerly imports only the English catalog from the locale registry", () => {
    const source = readFileSync(join(here, "../locales/index.ts"), "utf8");
    expect(source).toMatch(/import en from "\.\/en\.json"/);
    expect(source).not.toMatch(/import \w+ from "\.\/(?!en\.json)[^"]+\.json"/);
    for (const { code } of localeChoices) {
      if (code === "en") continue;
      expect(source, code).toContain(`import("./${code}.json")`);
    }
  });

  it("every registered pack carries only known keys with non-empty values", () => {
    for (const pack of Object.values(locales)) {
      for (const [key, value] of Object.entries(pack)) {
        expect(Object.hasOwn(en, key)).toBe(true);
        expect((value ?? "").trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("ships translated model and trusted-access help for threads", () => {
    for (const [code, pack] of Object.entries(locales)) {
      if (code === "en") continue;
      for (const key of ["model.threadBusy", "model.chooseThreadHint", "approvalMode.threadTrustedNotice"] as const) {
        expect(pack[key], `${code}: ${key}`).toBeTruthy();
        expect(pack[key], `${code}: ${key}`).not.toBe(en[key]);
      }
    }
  });

  it("fullDuplexHelp is off by default, names the server flag, and ships in every language", () => {
    // Rev 3 turned the Advanced switch off. A leftover "on by default" in a
    // partial pack, or a help line that omits the server kill switch, would
    // tell the person the toggle still runs duplex on its own.
    const onByDefault = /on by default here|activado por defecto aqu[ií]|activé par défaut ici|aktiviert hier standardmäßig|ligado por padrão aqui|デフォルトではオン|默认开启|預設開啟|за замовчуванням увімкнен/i;
    for (const { code } of localeChoices) {
      const help = locales[code]?.["voiceMode.call.fullDuplexHelp"];
      expect(help, `${code}: missing voiceMode.call.fullDuplexHelp`).toBeTruthy();
      expect(help, code).toContain("SAGAX_VOICE_FULL_DUPLEX=1");
      expect(help, code).not.toMatch(onByDefault);
    }
  });

  it("ships exactly one JSON catalog for every picker language", () => {
    const files = Object.keys(import.meta.glob("../locales/*.json", { eager: true }))
      .map((path) => path.split("/").at(-1))
      .filter((file) => file !== "source-hashes.json")
      .sort();
    const choices = localeChoices.map(({ code }) => `${code}.json`).sort();
    expect(files).toEqual(choices);
  });

  it("overlays a partial pack and falls back to English for missing keys", () => {
    locales["zz"] = { "engines.cloud": "Wolke" };
    try {
      expect(setLocale("zz")).toBe("zz");
      expect(t("engines.cloud")).toBe("Wolke");
      // key the pack omits → English, not undefined and not the key
      expect(t("engines.local")).toBe("Local");
    } finally {
      delete locales["zz"];
      setLocale("en");
    }
  });

  it("interpolates params and keeps unmatched placeholders visible", () => {
    // exercised through a raw template so the test doesn't depend on which
    // catalog keys happen to use params yet
    const template = "Hello {name}, {missing}!";
    const rendered = template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in { name: "Maus" } ? String({ name: "Maus" }[name as "name"]) : match,
    );
    expect(rendered).toBe("Hello Maus, {missing}!");
  });
});

// The server picks which note a held approval card shows; the renderer picks
// the language. A key this build has never heard of must still read.
describe("tFromServer", () => {
  it("translates a key the catalog knows", () => {
    locales["zz"] = { "approval.held.native": "Der Anbieter verlangt deine Zustimmung." };
    try {
      setLocale("zz");
      expect(tFromServer("approval.held.native", "The provider requires your approval for this action."))
        .toBe("Der Anbieter verlangt deine Zustimmung.");
    } finally {
      delete locales["zz"];
      setLocale("en");
    }
  });

  it("falls back to English for a key this build does not carry", () => {
    expect(tFromServer("approval.held.inventedLater", "A note from a newer server."))
      .toBe("A note from a newer server.");
  });

  it.each(["constructor", "toString", "__proto__"])("rejects inherited catalog property %s", (key) => {
    expect(tFromServer(key, "A note from the server.")).toBe("A note from the server.");
  });

  it("shows a card that carries only text, and nothing when it carries neither", () => {
    expect(tFromServer(undefined, "Routine could not be applied: disk full"))
      .toBe("Routine could not be applied: disk full");
    expect(tFromServer(undefined, undefined)).toBeUndefined();
  });

  // The rule these notes have to keep — a note must name a button the reader
  // can see — now lives in ApprovalModeSelector.i18n.test.ts, which checks the
  // note against the label the selector renders in that same language. The
  // labels used to be hardcoded English, so this file pinned the English words
  // instead; the selector reads the catalog now.

  it("prefers the catalog over stale text saved with an older card", () => {
    expect(tFromServer("approval.held.undelivered", "Auto mode couldn't answer this one."))
      .toBe(en["approval.held.undelivered"]);
  });
});

// Screen readers pick a voice and pronunciation rules from <html lang>. A
// German or Japanese interface read out with English rules is gibberish, so
// the page language follows the pack that is actually showing.
describe("page language", () => {
  afterEach(() => {
    setLocale("en");
    vi.unstubAllGlobals();
  });

  it("names every picker language with a valid BCP-47 tag", () => {
    expect(localeChoices.map(({ code }) => documentLanguage(code))).toEqual([
      "en", "de", "es", "fr", "hi", "ja", "pt-BR", "zh", "zh-TW", "uk",
    ]);
    for (const { code } of localeChoices) {
      expect(Intl.getCanonicalLocales(documentLanguage(code))).toEqual([documentLanguage(code)]);
    }
  });

  it("tags an alias with the pack it shows", () => {
    expect(documentLanguage("pt")).toBe("pt-BR");
    expect(documentLanguage("zh-hant")).toBe("zh-TW");
    expect(documentLanguage("zh-hk")).toBe("zh-TW");
  });

  it("sets the page language and direction whenever the locale changes", () => {
    const root = { lang: "en", dir: "" };
    vi.stubGlobal("document", { documentElement: root });
    setLocale("de-AT");
    expect(root).toEqual({ lang: "de", dir: "ltr" });
    setLocale("pt-BR");
    expect(root.lang).toBe("pt-BR");
    setLocale("zh-Hant-TW");
    expect(root.lang).toBe("zh-TW");
    setLocale("ja");
    expect(root.lang).toBe("ja");
    // an unknown language shows English, so the page says English
    setLocale("xx-YY");
    expect(root.lang).toBe("en");
  });

  it("tags the page from the system language the moment the module loads", async () => {
    const root = { lang: "en", dir: "" };
    vi.stubGlobal("document", { documentElement: root });
    vi.stubGlobal("navigator", { language: "ja-JP" });
    vi.resetModules();
    await import("./i18n");
    expect(root).toEqual({ lang: "ja", dir: "ltr" });
  });

  it("still switches language where there is no page (tests, workers)", () => {
    vi.stubGlobal("document", undefined);
    expect(setLocale("fr")).toBe("fr");
    expect(t("engines.local")).not.toBe("");
  });
});

describe("embeddingFrameLanguage (QA 0.8.66 F11)", () => {
  it("reads the <html lang> of the same-origin page holding the frame", async () => {
    const { embeddingFrameLanguage } = await import("./i18n");
    const parent = { document: { documentElement: { lang: "fr" } } } as unknown as Window;
    expect(embeddingFrameLanguage({ parent })).toBe("fr");
  });
  it("is undefined for a top-level page", async () => {
    const { embeddingFrameLanguage } = await import("./i18n");
    const win = {} as { parent: Window };
    win.parent = win as unknown as Window;
    expect(embeddingFrameLanguage(win)).toBeUndefined();
  });
  it("is undefined when the holder is of another origin", async () => {
    const { embeddingFrameLanguage } = await import("./i18n");
    const parent = { get document(): Document { throw new DOMException("Blocked a frame", "SecurityError"); } } as unknown as Window;
    expect(embeddingFrameLanguage({ parent })).toBeUndefined();
  });
});
