import type { HighlighterCore, ThemeRegistration } from "shiki/core";
import { BRAND_SURFACES } from "../lib/switch-colors";
import { contrastRatio, toneForSurface } from "../lib/color-contrast";

// Shiki's package entry registers every grammar and theme (hundreds of
// chunks). Chat only ever asks for the two GitHub themes and the languages
// the code-block badge already names, so each of those is its own import and
// the rest never enter the bundle. A fence loads its grammar the first time
// it appears; a later fence for the same language waits on that load.
const LIGHT_THEME = "github-light-default";
const DARK_THEME = "github-dark-default";
const grammarLoaders = {
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  json5: () => import("shiki/langs/json5.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  fish: () => import("shiki/langs/fish.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  sass: () => import("shiki/langs/sass.mjs"),
  less: () => import("shiki/langs/less.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  mdx: () => import("shiki/langs/mdx.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  dart: () => import("shiki/langs/dart.mjs"),
  r: () => import("shiki/langs/r.mjs"),
  lua: () => import("shiki/langs/lua.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  graphql: () => import("shiki/langs/graphql.mjs"),
  proto: () => import("shiki/langs/proto.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  makefile: () => import("shiki/langs/makefile.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  wasm: () => import("shiki/langs/wasm.mjs"),
};
type GrammarFile = keyof typeof grammarLoaders;
/** Fence ids that are not themselves the grammar file name. */
const grammarAlias: Record<string, GrammarFile> = {
  js: "javascript", node: "javascript",
  ts: "typescript",
  sh: "bash", zsh: "bash", shell: "bash",
  ps1: "powershell",
  py: "python",
  htm: "html",
  yml: "yaml",
  md: "markdown",
  svg: "xml",
  "c++": "cpp", cc: "cpp", cxx: "cpp",
  cs: "csharp", "c#": "csharp",
  rs: "rust",
  golang: "go",
  rb: "ruby",
  kt: "kotlin",
  gql: "graphql",
  protobuf: "proto",
  docker: "dockerfile",
  make: "makefile",
};
const PLAIN_LANGS = new Set(["", "text", "txt", "plaintext", "plain"]);
let highlighterPromise: Promise<HighlighterCore> | undefined;
const grammarLoading = new Map<string, Promise<void>>();

function grammarFile(lang: string): GrammarFile | undefined {
  const alias = grammarAlias[lang];
  if (alias) return alias;
  return Object.prototype.hasOwnProperty.call(grammarLoaders, lang) ? lang as GrammarFile : undefined;
}

/** WCAG 1.4.3: a code block is 12 px text. */
const CODE_MIN_CONTRAST = 4.5;
/** The darkest ground a light code block can sit on: every light skin's
 * inset (the block's fill, #d5e8e5 the darkest, measured 2026-11-08) is
 * lighter than this grey, so a token that clears it clears them all. */
export const LIGHT_CODE_GROUND = BRAND_SURFACES.light[1];

const HEX6 = /^#[0-9a-f]{6}$/i;

/** One token colour of the light theme, deepened along its hue until it
 * reads at 4.5:1 on the darkest light inset. github-light-default's red,
 * purple and grey measured 4.0 to 4.27:1 on Pulsatrix Light's block (#3035). */
export function readableLightToken(color: string): string {
  if (!HEX6.test(color)) return color;
  const hex = color.toLowerCase();
  return contrastRatio(hex, LIGHT_CODE_GROUND) >= CODE_MIN_CONTRAST ? hex : toneForSurface(hex, LIGHT_CODE_GROUND, CODE_MIN_CONTRAST);
}

/** The light theme with every token colour readable on a light skin's code
 * block. Only the token colours move; the dark theme is left as shipped. */
export function readableLightTheme(theme: ThemeRegistration): ThemeRegistration {
  const tokenColors = (theme.tokenColors ?? theme.settings ?? []).map((rule) => {
    const fg = rule.settings?.foreground;
    return fg ? { ...rule, settings: { ...rule.settings, foreground: readableLightToken(fg) } } : rule;
  });
  const colors = { ...theme.colors };
  if (colors["editor.foreground"]) colors["editor.foreground"] = readableLightToken(colors["editor.foreground"]);
  return { ...theme, colors, settings: tokenColors, tokenColors, ...(theme.fg ? { fg: readableLightToken(theme.fg) } : {}) };
}

function getHighlighter(): Promise<HighlighterCore> {
  if (highlighterPromise) return highlighterPromise;
  const created = (async () => {
    const { createHighlighterCore } = await import("shiki/core");
    const { createJavaScriptRegexEngine } = await import("shiki/engine/javascript");
    return createHighlighterCore({
      themes: [
        import("shiki/themes/github-light-default.mjs").then((mod) => readableLightTheme(mod.default)),
        import("shiki/themes/github-dark-default.mjs").then((mod) => mod.default),
      ],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  })().catch((error: unknown) => {
    highlighterPromise = undefined;
    throw error;
  });
  highlighterPromise = created;
  return created;
}

function loadGrammar(highlighter: HighlighterCore, file: GrammarFile): Promise<void> {
  const pending = grammarLoading.get(file);
  if (pending) return pending;
  const next = grammarLoaders[file]().then((mod) => highlighter.loadLanguage(mod.default)).catch((error: unknown) => {
    grammarLoading.delete(file);
    throw error;
  });
  grammarLoading.set(file, next);
  return next;
}

/** Highlight with the two chat themes. A language outside the curated set
 * rejects, and the code block keeps its plain text. */
export async function highlightFence(code: string, lang: string): Promise<string> {
  const highlighter = await getHighlighter();
  const requested = lang.trim().toLowerCase();
  const plain = PLAIN_LANGS.has(requested);
  const file = plain ? undefined : grammarFile(requested);
  if (!plain && !file) throw new Error(`No bundled grammar for ${requested}`);
  if (file) await loadGrammar(highlighter, file);
  return highlighter.codeToHtml(code, {
    lang: file ?? "text",
    themes: { light: LIGHT_THEME, dark: DARK_THEME },
    defaultColor: "light-dark()",
  });
}
/** One coloured run of a line (the coding chat's diffs): its text and the
 * two themes' colour (`light-dark()`), never HTML. */
export interface CodeToken {
  content: string;
  style?: Record<string, string>;
}

/** The same grammars and themes as a code fence, as tokens per line, for a
 * renderer that draws its own rows. Null for a language outside the curated
 * set or a text past HIGHLIGHT_MAX_CHARS: the rows stay plain. */
export async function highlightCodeLines(code: string, lang: string): Promise<CodeToken[][] | null> {
  if (code.length > HIGHLIGHT_MAX_CHARS) return null;
  const file = grammarFile(lang.trim().toLowerCase());
  if (!file) return null;
  const highlighter = await getHighlighter();
  await loadGrammar(highlighter, file);
  const result = highlighter.codeToTokens(code, {
    lang: file,
    themes: { light: LIGHT_THEME, dark: DARK_THEME },
    defaultColor: "light-dark()",
  });
  return result.tokens.map((line) => line.map((token) => ({
    content: token.content,
    ...(token.htmlStyle ? { style: token.htmlStyle as Record<string, string> } : token.color ? { style: { color: token.color } } : {}),
  })));
}

// Past this size a block stays plain text. Shiki tokenizes on the renderer's
// main thread: 100 KB of TypeScript took 1.1 s, 200 KB 2.3 s and 1 MB 12 s,
// and HTML that big is never cached (HIGHLIGHT_CACHE_MAX_CHARS), so every
// remount froze the window again. Chat snippets sit far below the bound.
export const HIGHLIGHT_MAX_CHARS = 100_000;
