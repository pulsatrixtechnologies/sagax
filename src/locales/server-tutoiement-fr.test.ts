import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

// @babel/core ships no types; only the few fields read here are declared.
interface BabelNode {
  type: string;
  value?: unknown;
  name?: string;
  callee?: BabelNode;
  key?: BabelNode;
  loc?: { start: { line: number } };
  quasis?: { value: { raw: string; cooked?: string | null } }[];
}
interface NodePath {
  node: BabelNode;
  parent: BabelNode;
  parentPath: NodePath | null;
}
interface Babel {
  parseSync(code: string, options: object): object | null;
  traverse(ast: object, visitors: Record<string, (path: NodePath) => void>): void;
}
const { parseSync, traverse } = createRequire(import.meta.url)("@babel/core") as Babel;

// #3261: chat-tutoiement-fr.test.ts guards fr.json, but the server writes
// French of its own (the Feedback bot, the intro tour, a new bot's greeting,
// routine cards, notices sent by text message). Every string literal and
// template of server/ and shared/ speaks with « tu » too: no « vous »,
// « votre », « vos », and no verb in -ez.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCANNED = ["server", "shared"];

const VOUS = /(^|[^\p{L}])(vous|votre|vos|vôtre|vôtres)(?![\p{L}])/iu;
const EZ = /(?<![\p{L}])\p{L}+i?ez(?![\p{L}])/giu;
// The other second person plural forms that do not end in -ez.
const PLURAL_YOU = /(^|[^\p{L}])(faites|dites|êtes)(?![\p{L}])/iu;
const NOT_A_VERB = new Set(["chez", "assez", "nez", "rez"]);
// « rendez-vous » is a noun, not a way to address the person.
const NOUNS = /rendez-vous/giu;
// The source of a RegExp kept in a string ("[ée]cri(?:s|vez)").
const REGEXP_SOURCE = /\(\?[:!=<]|\\[bBsSdDwWp]|\p{L}\|\p{L}/u;
// Brazilian Portuguese texts beside the French ones ("uma vez", "dez").
const PORTUGUESE = /ção|ções|ão\b|\b(você|vocês|não|uma|seu|sua|seus|suas)\b/iu;
const OTHER_LANGUAGE_KEYS = new Set(["en", "pt", "pt-BR", "ptBR", "es"]);

// Files skipped as a whole, each for a reason:
// - French stopword lists and matchers that read what a person wrote (they
//   must keep recognizing « vous », « allez-y », « arrêtez »);
// - text addressed to third parties, not to the person: the spoken message
//   of an outgoing call and the notice posted to everyone in a meeting
//   (plural « vous »), and the Meet page labels the bot reads;
// - app bundle ids, generated blobs and test fixtures.
const SKIPPED_FILES = new Set([
  "server/meetings/meet-scripts.ts",
  "server/org/org-member-routes.ts",
  "server/recall/semantic-encoder.ts",
  "server/self-knowledge/self-knowledge.ts",
  "server/small-talk.ts",
  "server/tts/english-reading.ts",
  "server/tts/french-reading.ts",
  "server/voice/voice-keyterms.ts",
  "shared/computer-app.ts",
  "shared/engine-connectors.ts",
  "shared/looks-french.ts",
  "shared/outbound-call.ts",
  "shared/parallel-tasks.ts",
  "shared/primary-request.ts",
  "shared/stop-intent.ts",
]);
const skippedFile = (file: string) => SKIPPED_FILES.has(file) || file.startsWith("server/testing/") || file.endsWith(".generated.ts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

/** True when the string feeds a RegExp (new RegExp(...), String.raw`...`). */
function feedsRegExp(path: NodePath): boolean {
  for (let current: NodePath | null = path.parentPath; current; current = current.parentPath) {
    const node = current.node;
    if ((node.type === "NewExpression" || node.type === "CallExpression") && node.callee?.type === "Identifier" && node.callee.name === "RegExp") return true;
    if (node.type === "TaggedTemplateExpression") return true;
    if (node.type.endsWith("Statement") || node.type.endsWith("Declaration")) return false;
  }
  return false;
}

/** True for a word of new Set([...]): a list the server matches what the
 * person wrote against (« envoyez », « annulez »), not text it shows. */
function inWordSet(path: NodePath): boolean {
  const list = path.parentPath;
  const call = list?.parentPath?.node;
  return list?.node.type === "ArrayExpression" && call?.type === "NewExpression" && call.callee?.type === "Identifier" && call.callee.name === "Set";
}

/** True for the value of an { en, "pt-BR" } key: not French. */
function otherLanguage(path: NodePath): boolean {
  const parent = path.parent;
  if (parent.type !== "ObjectProperty" || parent.value !== path.node) return false;
  const key = parent.key?.type === "Identifier" ? parent.key.name : parent.key?.type === "StringLiteral" ? parent.key.value : "";
  return typeof key === "string" && OTHER_LANGUAGE_KEYS.has(key);
}

function vouvoiementIn(file: string, code: string): string[] {
  const ast = parseSync(code, {
    filename: file,
    babelrc: false,
    configFile: false,
    parserOpts: { sourceType: "module", plugins: ["typescript", ...(file.endsWith(".tsx") ? (["jsx"] as const) : [])] },
  });
  if (!ast) return [];
  const bad: string[] = [];
  const check = (raw: string, line: number | undefined) => {
    if (REGEXP_SOURCE.test(raw) || PORTUGUESE.test(raw)) return;
    const text = raw.replace(NOUNS, "");
    const words = [
      ...[VOUS, PLURAL_YOU].flatMap((pattern) => text.match(pattern)?.[2] ?? []),
      ...[...text.matchAll(EZ)].map((match) => match[0]).filter((word) => !NOT_A_VERB.has(word.toLowerCase())),
    ];
    for (const word of words) bad.push(`${file}:${line ?? 0}: ${word}: ${text.slice(0, 120)}`);
  };
  traverse(ast, {
    StringLiteral(path) {
      if (path.parent.type === "ImportDeclaration" || path.parent.type === "ExportNamedDeclaration" || path.parent.type === "ExportAllDeclaration") return;
      if (path.parent.type === "TSLiteralType" || feedsRegExp(path) || otherLanguage(path) || inWordSet(path)) return;
      check(String(path.node.value), path.node.loc?.start.line);
    },
    TemplateLiteral(path) {
      if (feedsRegExp(path) || otherLanguage(path)) return;
      check((path.node.quasis ?? []).map((quasi) => quasi.value.cooked ?? quasi.value.raw).join(" "), path.node.loc?.start.line);
    },
    JSXText(path) {
      check(String(path.node.value), path.node.loc?.start.line);
    },
  });
  return bad;
}

it("the scanner flags « vous », « votre », « vos », « vôtre » and -ez verbs in strings", () => {
  expect(vouvoiementIn("x.ts", `const a = "Que puis-je faire pour vous ?";`)).toHaveLength(1);
  expect(vouvoiementIn("x.ts", "const a = `Choisissez, ${x} dans vos mots.`;")).toHaveLength(2);
  expect(vouvoiementIn("x.ts", `const a = "Choisis, ou décris-le dans tes mots.";`)).toEqual([]);
  expect(vouvoiementIn("x.ts", `const a = "Faites pointer le MX.";`)).toHaveLength(1);
  expect(vouvoiementIn("x.ts", 'const a = "le vôtre";')).toHaveLength(1);
  expect(vouvoiementIn("x.ts", 'const a = "les vôtres";')).toHaveLength(1);
  expect(vouvoiementIn("x.ts", `const a = /vous/; const b = new RegExp("votre"); // vous`)).toEqual([]);
  expect(vouvoiementIn("x.ts", `const a = "Allez chez toi, assez.";`)).toHaveLength(1);
  expect(vouvoiementIn("x.ts", `const a = "Marquer le rendez-vous comme fait"; const b = "[ée]cri(?:s|vez)";`)).toEqual([]);
  expect(vouvoiementIn("x.ts", `const a = new Set(["envoyez", "annulez"]);`)).toEqual([]);
  expect(vouvoiementIn("x.ts", `const a = { en: "Rez", fr: "Créez", "pt-BR": "Crie uma vez" };`)).toHaveLength(1);
});

it("fr: French written by the server and shared code uses tu, never vous / votre / vos nor a verb in -ez", async () => {
  const bad = SCANNED.flatMap((dir) => sourceFiles(join(ROOT, dir)))
    .map((path) => relative(ROOT, path).split("\\").join("/"))
    .filter((file) => !skippedFile(file))
    .flatMap((file) => vouvoiementIn(file, readFileSync(join(ROOT, file), "utf8")));
  if (process.env.DUMP) (await import("node:fs")).writeFileSync(process.env.DUMP, bad.join("\n"));
  expect(bad).toEqual([]);
});
