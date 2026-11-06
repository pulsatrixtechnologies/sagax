import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  REQUIRED_INTENTS,
  REQUIRED_LOCALES,
  checkIosAppIntentVocabulary,
  parseIntentExamples,
} from "./check-ios-app-intent-vocabulary.mjs";

const directories = [];

function fixture(locales = REQUIRED_LOCALES) {
  const root = mkdtempSync(join(tmpdir(), "sagax-app-intent-vocab-"));
  directories.push(root);
  for (const locale of locales) {
    const dir = join(root, "ios", "App", `${locale}.lproj`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "AppIntentVocabulary.plist"), plist(locale));
  }
  return root;
}

function plist(locale, intents = REQUIRED_INTENTS) {
  const message = locale === "fr"
    ? "Envoie un message à Scout avec Sagax"
    : "Send a message to Scout with Sagax";
  const call = locale === "fr"
    ? "Appelle Scout avec Sagax"
    : "Call Scout with Sagax";
  const phrase = {
    INSendMessageIntent: message,
    INStartCallIntent: call,
  };
  const dicts = intents.map((intent) => `\t\t<dict>
\t\t\t<key>IntentName</key>
\t\t\t<string>${intent}</string>
\t\t\t<key>IntentExamples</key>
\t\t\t<array>
\t\t\t\t<string>${phrase[intent]}</string>
\t\t\t</array>
\t\t</dict>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>IntentPhrases</key>
\t<array>
${dicts}
\t</array>
</dict>
</plist>
`;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("checkIosAppIntentVocabulary", () => {
  it("parses IntentExamples for both Siri intents", () => {
    const examples = parseIntentExamples(plist("en"));
    expect([...examples.keys()].sort()).toEqual([...REQUIRED_INTENTS].sort());
    expect(examples.get("INSendMessageIntent")).toEqual(["Send a message to Scout with Sagax"]);
    expect(examples.get("INStartCallIntent")).toEqual(["Call Scout with Sagax"]);
  });

  it("accepts Base, en, fr and pt-BR with both intents", () => {
    const root = fixture();
    const result = checkIosAppIntentVocabulary({ root });
    expect(result).toEqual({
      ok: true,
      files: REQUIRED_LOCALES.map((locale) => `ios/App/${locale}.lproj/AppIntentVocabulary.plist`),
    });
  });

  it("fails when a required locale file is missing", () => {
    const root = fixture(["Base", "en", "fr"]);
    const result = checkIosAppIntentVocabulary({ root });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("pt-BR.lproj/AppIntentVocabulary.plist is missing");
  });

  it("fails when an intent has no examples", () => {
    const root = fixture(["en"]);
    writeFileSync(
      join(root, "ios", "App", "en.lproj", "AppIntentVocabulary.plist"),
      plist("en", ["INSendMessageIntent"]),
    );
    const result = checkIosAppIntentVocabulary({ root, locales: ["en"] });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("no IntentExamples for INStartCallIntent");
  });

  it("fails when a new .lproj vocabulary file is not in the required list", () => {
    const root = fixture();
    const de = join(root, "ios", "App", "de.lproj");
    mkdirSync(de, { recursive: true });
    writeFileSync(join(de, "AppIntentVocabulary.plist"), plist("en"));
    expect(checkIosAppIntentVocabulary({ root }).message)
      .toContain("de.lproj/AppIntentVocabulary.plist exists but de is not in the required locale list");
  });
});
