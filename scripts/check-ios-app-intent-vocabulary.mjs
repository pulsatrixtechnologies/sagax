// Fails when a supported locale is missing AppIntentVocabulary examples for
// INSendMessageIntent or INStartCallIntent (ITMS-90626 / QA1950). Source-only:
// does not prove App Store Connect cleared the warnings after an upload.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REQUIRED_LOCALES = ["Base", "en", "fr", "pt-BR"];
export const REQUIRED_INTENTS = ["INSendMessageIntent", "INStartCallIntent"];

/**
 * @param {string} xml
 * @returns {Map<string, string[]>}
 */
export function parseIntentExamples(xml) {
  const body = String(xml).replace(/\r\n/g, "\n");
  /** @type {Map<string, string[]>} */
  const out = new Map();
  const blocks = [...body.matchAll(/<dict>([\s\S]*?)<\/dict>/g)].map((match) => match[1] ?? "");
  for (const block of blocks) {
    const name = block.match(/<key>IntentName<\/key>\s*<string>([^<]+)<\/string>/)?.[1]?.trim();
    if (!name) continue;
    const examplesBlock = block.match(/<key>IntentExamples<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] ?? "";
    const examples = [...examplesBlock.matchAll(/<string>([^<]*)<\/string>/g)]
      .map((match) => (match[1] ?? "").trim())
      .filter(Boolean);
    out.set(name, examples);
  }
  return out;
}

/**
 * @param {{ root: string, locales?: string[], intents?: string[], exists?: (file: string) => boolean, read?: (file: string) => string, list?: (dir: string) => string[] }} input
 * @returns {{ ok: true, files: string[] } | { ok: false, message: string }}
 */
export function checkIosAppIntentVocabulary({
  root,
  locales = REQUIRED_LOCALES,
  intents = REQUIRED_INTENTS,
  exists = existsSync,
  read = (file) => readFileSync(file, "utf8"),
  list = (dir) => readdirSync(dir),
}) {
  const appDir = join(root, "ios", "App");
  if (!exists(appDir)) {
    return { ok: false, message: `ios/App is missing under ${root}` };
  }
  const files = [];
  const problems = [];
  for (const locale of locales) {
    const rel = `ios/App/${locale}.lproj/AppIntentVocabulary.plist`;
    const file = join(root, rel);
    if (!exists(file)) {
      problems.push(`${rel} is missing`);
      continue;
    }
    files.push(rel);
    let examples;
    try {
      examples = parseIntentExamples(read(file));
    } catch (error) {
      problems.push(`${rel} could not be read: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    for (const intent of intents) {
      const phrases = examples.get(intent) ?? [];
      if (phrases.length === 0) {
        problems.push(`${rel} has no IntentExamples for ${intent}`);
      }
    }
    for (const [intent, phrases] of examples) {
      if (!intents.includes(intent)) {
        problems.push(`${rel} declares unexpected IntentName ${intent}`);
      }
      if (phrases.some((phrase) => phrase.length < 3)) {
        problems.push(`${rel} has an empty or too-short example for ${intent}`);
      }
    }
  }
  // Catch a locale folder that gained a vocabulary file but was left out of
  // the required list (a new catalog language must get examples too).
  for (const entry of list(appDir)) {
    if (!entry.endsWith(".lproj")) continue;
    const locale = entry.slice(0, -".lproj".length);
    const rel = `ios/App/${entry}/AppIntentVocabulary.plist`;
    if (exists(join(root, rel)) && !locales.includes(locale)) {
      problems.push(`${rel} exists but ${locale} is not in the required locale list`);
    }
  }
  if (problems.length) {
    return {
      ok: false,
      message: `AppIntentVocabulary check failed (#1895):\n- ${problems.join("\n- ")}`,
    };
  }
  return { ok: true, files };
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const result = checkIosAppIntentVocabulary({ root });
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(`OK: ${result.files.length} AppIntentVocabulary.plist files cover ${REQUIRED_INTENTS.join(", ")}`);
}
