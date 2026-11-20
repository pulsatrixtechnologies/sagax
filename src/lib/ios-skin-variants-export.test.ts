// The phone wears the same skin variants the desktop does (PR #843: colours,
// Full intensity, duo-tones, moods, textures, Hibou 98's Windows editions).
// This file keeps ios/Sources/CompanionCore/SkinVariantsData.swift in step
// with the desktop's own sources, so the phone never carries a second copy
// of a colour that can drift:
//
// - the families, their variants and the legacy skins: src/lib/skin-families.ts;
// - the tokens of every base skin + tint (+ Full), as the browser resolves
//   them: the `[data-skin][data-skin-tint]` blocks of src/styles.css
//   (« Colour tints »), src/styles/skin-duo.css, skin-ambiance.css,
//   skin-depth.css and the palette blocks of src/styles/retro-editions/*.css,
//   read through scripts/check-skin-contrast.mjs's own parser (`skinTokens`).
//   Only the tokens that differ from the base skin are written: the phone
//   lays them over its base table (DesktopSkins in Skins.swift) as the CSS
//   lays a tint block over its base block;
// - the gradients (--accent-gradient), the top glows (--app-glow) and the
//   swatches (--skin-swatch);
// - the textures' layers (src/styles/skin-texture.css);
// - the English labels of the picker (src/locales/en.json).
//
// The check runs by default; `UPDATE_IOS_SKINS=1 pnpm vitest run
// src/lib/ios-skin-variants-export.test.ts` rewrites the Swift file after a
// desktop change.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  LEGACY_SKINS,
  SKIN_DEPTHS,
  SKIN_FAMILIES,
  SKIN_TEXTURES,
  SKIN_TINT_IDS,
  type SkinVariantGroup,
} from "./skin-families";
import en from "../locales/en.json";
import { CUSTOM_KINDS } from "./custom-tint";

// M-20261119-073: the custom colours (their tokens are derived at run time
// from the person's colours, src/lib/custom-colours.ts) and the textures the
// phone does not draw yet (an SVG noise, two crossing diagonals, a sheen) stay
// on the desktop; the phone reads such a tint or texture as unknown and wears
// the family's own look, as with any value it does not know.
const PHONE_TEXTURES = SKIN_TEXTURES.filter((texture) => !["fine", "paper", "mesh", "frost"].includes(texture));
const onPhone = (variant: { tint?: string }) => !variant.tint || !(CUSTOM_KINDS as readonly string[]).includes(variant.tint);
const PHONE_FAMILIES = SKIN_FAMILIES.map((family) => ({ ...family, variants: family.variants.filter(onPhone) }));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SWIFT = join(ROOT, "ios/Sources/CompanionCore/SkinVariantsData.swift");
const UPDATE = process.env.UPDATE_IOS_SKINS === "1";
const GROUPS: readonly SkinVariantGroup[] = ["color", "duo", "ambiance", "edition"];

/** The stylesheets the contrast script measures, in its own order. */
function stylesheets(): string {
  let css = readFileSync(join(ROOT, "src/styles.css"), "utf8");
  for (const name of ["depth", "duo", "ambiance", "texture"]) css += "\n" + readFileSync(join(ROOT, `src/styles/skin-${name}.css`), "utf8");
  const editions = join(ROOT, "src/styles/retro-editions");
  for (const file of readdirSync(editions).filter((name) => name.endsWith(".css")).sort()) css += "\n" + readFileSync(join(editions, file), "utf8");
  return css;
}

type SkinTokens = (css: string, id: string) => Record<string, string> | null;
let skinTokens: SkinTokens;
const CSS = stylesheets();

beforeAll(async () => {
  const mod = (await import(pathToFileURL(join(ROOT, "scripts", "check-skin-contrast.mjs")).href)) as { skinTokens: SkinTokens };
  skinTokens = mod.skinTokens;
});

/** The phone's token names (DesktopSkins.keys and the shell's sidebar set), and the CSS property each reads. */
const TOKENS: ReadonlyArray<[string, string]> = [
  ...[
    "app", "panel", "raised", "raised-hover", "card", "menu", "inset", "control", "hairline",
    "ink", "ink-secondary", "ink-tertiary", "accent", "accent-border", "accent-text", "focus", "accent-ink",
    "bubble-user", "bubble-user-ink", "success", "danger", "danger-ink", "success-ink", "warning", "composer",
    "unread", "composer-ring",
    "sidebar", "sidebar-ink", "sidebar-ink-secondary", "sidebar-hover", "sidebar-selected", "sidebar-hairline",
  ].map((name): [string, string] => [name, `--color-${name}`]),
  ["accent-from", "--accent-from"],
  ["accent-to", "--accent-to"],
];

function flat(source: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") Object.assign(out, flat(value as Record<string, unknown>, name));
    else if (typeof value === "string") out[name] = value;
  }
  return out;
}
const EN = flat(en as Record<string, unknown>);
function label(key: string): string {
  const value = EN[key];
  if (!value) throw new Error(`en.json has no ${key}`);
  return value;
}

/** The raw declarations of one exact selector's block, or null. */
function rawBlock(selector: string): Record<string, string> | null {
  const escaped = selector.replace(/[[\]"]/g, (c) => `\\${c}`);
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
  if (!match) return null;
  const out: Record<string, string> = {};
  for (const [, name, value] of match[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[name] = value.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  return out;
}

const tintSelector = (skin: string, tint: string) => `[data-skin="${skin}"][data-skin-tint="${tint}"]`;
const fullSelector = (skin: string, tint: string) => `${tintSelector(skin, tint)}[data-skin-depth="full"]`;

/** Every worn base skin + tint (+ "+full" for a plain colour that has a Full block). */
function looks(): Array<{ key: string; skin: string; tint: string; full: boolean }> {
  const out: Array<{ key: string; skin: string; tint: string; full: boolean }> = [];
  const seen = new Set<string>();
  for (const family of PHONE_FAMILIES) {
    for (const variant of family.variants) {
      if (!variant.tint) continue;
      for (const skin of [variant.light, variant.dark]) {
        if (!skin) continue;
        const key = `${skin}+${variant.tint}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ key, skin, tint: variant.tint, full: false });
        if (variant.group === "color" && rawBlock(fullSelector(skin, variant.tint))) out.push({ key: `${key}+full`, skin, tint: variant.tint, full: true });
      }
    }
  }
  return out;
}

const hexes = (value: string) => [...value.matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0].toLowerCase());

/** `--app-glow`: each `color-mix(in oklch, <colour> N%, transparent)` as [hex, alpha]; [] for none. */
function glow(value: string | undefined, accent: string): Array<[string, number]> | undefined {
  if (value === undefined) return undefined;
  if (value.trim() === "none") return [];
  return [...value.matchAll(/color-mix\(\s*in\s+oklch\s*,\s*(#[0-9a-f]{6}|var\(--color-accent\))\s+(\d+(?:\.\d+)?)%/gi)].map(
    ([, colour, pct]) => [colour.startsWith("var") ? accent.slice(0, 7) : colour.toLowerCase(), Number(pct) / 100],
  );
}

type Layer = { kind: "dot" | "vertical" | "horizontal" | "diagonal"; tileWidth: number; tileHeight: number; x: number; y: number; size: number; alpha: number };

function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if (text[i] === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

/** Each texture's layers, read from skin-texture.css: the pattern's geometry and how much ink shows. */
function textures(): Record<string, Layer[]> {
  const source = readFileSync(join(ROOT, "src/styles/skin-texture.css"), "utf8");
  const out: Record<string, Layer[]> = {};
  for (const texture of PHONE_TEXTURES) {
    if (texture === "none") continue;
    const block = new RegExp(`\\[data-skin-texture="${texture}"\\][^{]*\\{([^}]*)\\}`).exec(source)?.[1];
    if (!block) throw new Error(`skin-texture.css has no ${texture} block`);
    const decl = (name: string) => new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(block)?.[1].trim();
    const alphas: Record<string, number> = {};
    for (const name of ["--tx-c", "--tx-c2"]) {
      const pct = /var\(--tx-ink\)\s+(\d+(?:\.\d+)?)%/.exec(decl(name) ?? "")?.[1];
      if (pct) alphas[name] = Number(pct) / 100;
    }
    const images = splitTop(decl("--tx-img") ?? "");
    const sizes = splitTop(decl("--tx-size") ?? "");
    const px = (text: string) => [...text.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    out[texture] = images.map((image, index) => {
      const colour = /var\((--tx-c2?)\)/.exec(image)?.[1] ?? "--tx-c";
      const alpha = alphas[colour];
      const [tileWidth = 0, tileHeight = 0] = sizes[index] === "auto" || sizes[index] === undefined ? [] : px(sizes[index]);
      if (image.startsWith("radial-gradient")) {
        const [x, y, solid, edge] = px(image);
        // the dot's radius: halfway through its soft edge
        return { kind: "dot", tileWidth, tileHeight, x, y, size: (solid + edge) / 2, alpha };
      }
      if (image.startsWith("repeating-linear-gradient")) {
        const values = px(image);
        return { kind: "diagonal", tileWidth: values[values.length - 1], tileHeight: 0, x: 0, y: 0, size: values[0], alpha };
      }
      const kind = image.includes("to right") ? "vertical" : "horizontal";
      return { kind, tileWidth, tileHeight, x: 0, y: 0, size: px(image)[0], alpha };
    });
  }
  return out;
}

const q = (value: string) => JSON.stringify(value);
const opt = (value: string | undefined | null) => (value ? q(value) : "nil");
const num = (value: number) => (Number.isInteger(value) ? `${value}` : `${Number(value.toFixed(4))}`);

function swift(): string {
  const lines: string[] = [
    "// GENERATED by src/lib/ios-skin-variants-export.test.ts from src/lib/skin-families.ts,",
    "// src/styles.css (« Colour tints »), src/styles/skin-duo.css, skin-ambiance.css,",
    "// skin-depth.css, skin-texture.css, src/styles/retro-editions/*.css and",
    "// src/locales/en.json. Do not edit: regenerate with",
    "// `UPDATE_IOS_SKINS=1 pnpm vitest run src/lib/ios-skin-variants-export.test.ts`.",
    "// swiftlint:disable all",
    "",
    "/// A colour, duo-tone, mood or Windows edition laid over a base skin (`omb-skin-tint`).",
    "public enum SkinTint: String, CaseIterable, Sendable, Codable {",
    ...SKIN_TINT_IDS.map((tint) => `    case ${tint}`),
    "}",
    "",
    "/// The picker's swatch rows.",
    "public enum SkinVariantGroup: String, CaseIterable, Sendable {",
    ...GROUPS.map((group) => `    case ${group}`),
    "}",
    "",
    "/// How far a colour reaches (`omb-skin-depth`): the accent only, or every surface.",
    "public enum SkinDepth: String, CaseIterable, Sendable {",
    ...SKIN_DEPTHS.map((depth) => `    case ${depth}`),
    "}",
    "",
    "/// A light texture over the ground (`omb-skin-texture`).",
    "public enum SkinTexture: String, CaseIterable, Sendable {",
    ...PHONE_TEXTURES.map((texture) => `    case ${texture}`),
    "}",
    "",
    "/// One layer of a texture, in points (CSS px): a dot, a vertical or horizontal hairline, or a",
    "/// diagonal hairline rising to the right (`tileWidth` is then the period across the lines).",
    "public struct SkinTextureLayer: Equatable, Sendable {",
    "    public enum Kind: String, Sendable { case dot, vertical, horizontal, diagonal }",
    "    public let kind: Kind",
    "    public let tileWidth: Double",
    "    public let tileHeight: Double",
    "    public let x: Double",
    "    public let y: Double",
    "    /// A dot's radius, or a hairline's width.",
    "    public let size: Double",
    "    /// How much of the ground's ink shows.",
    "    public let alpha: Double",
    "}",
    "",
    "enum DesktopSkinVariantData {",
    "    struct Variant { let id: String; let light: String?; let dark: String?; let tint: SkinTint?; let group: SkinVariantGroup }",
    "    struct Family { let id: String; let name: String; let tagline: String; let secret: Bool; let variants: [Variant] }",
    "",
    "    /// SKIN_FAMILIES (src/lib/skin-families.ts).",
    "    static let families: [Family] = [",
  ];
  for (const family of PHONE_FAMILIES) {
    lines.push(`        Family(id: ${q(family.id)}, name: ${q(family.name)}, tagline: ${q(label(`settings.skin.family.${family.id}.tagline`))}, secret: ${family.secret ? "true" : "false"}, variants: [`);
    for (const variant of family.variants) {
      lines.push(`            Variant(id: ${q(variant.id)}, light: ${opt(variant.light)}, dark: ${opt(variant.dark)}, tint: ${variant.tint ? `.${variant.tint}` : "nil"}, group: .${variant.group}),`);
    }
    lines.push("        ]),");
  }
  lines.push("    ]", "", "    /// LEGACY_SKINS: a skin no variant lists any more, worn as its closest base and colour.");
  lines.push("    static let legacy: [String: (skin: String, tint: SkinTint)] = [");
  for (const [skin, mapped] of Object.entries(LEGACY_SKINS)) if (mapped) lines.push(`        ${q(skin)}: (${q(mapped.skin)}, .${mapped.tint}),`);
  lines.push("    ]", "");

  const names = (prefix: string, ids: readonly string[]) => ids.map((id) => `        ${q(id)}: ${q(label(`${prefix}.${id}`))},`);
  const variantIds = [...new Set(PHONE_FAMILIES.flatMap((family) => family.variants.map((variant) => variant.id)))];
  lines.push("    /// The picker's English labels (settings.skin.*); the app localizes them.");
  lines.push("    static let variantNames: [String: String] = [", ...names("settings.skin.variant", variantIds), "    ]");
  lines.push("    static let groupNames: [String: String] = [", ...names("settings.skin.group", GROUPS), "    ]");
  lines.push(`    static let depthLabel = ${q(label("settings.skin.depthLabel"))}`);
  lines.push("    static let depthNames: [String: String] = [", ...names("settings.skin.depth", SKIN_DEPTHS), "    ]");
  lines.push(`    static let textureLabel = ${q(label("settings.skin.textureLabel"))}`);
  lines.push("    static let textureNames: [String: String] = [", ...names("settings.skin.texture", PHONE_TEXTURES), "    ]", "");

  lines.push("    /// Each base skin's swatch (--skin-swatch).");
  lines.push("    static let baseSwatches: [String: String] = [");
  const bases = [...new Set(SKIN_FAMILIES.flatMap((family) => family.variants.flatMap((variant) => [variant.light, variant.dark]).filter(Boolean)))] as string[];
  for (const skin of bases) {
    const swatch = skinTokens(CSS, skin)?.["--skin-swatch"];
    if (swatch) lines.push(`        ${q(skin)}: ${q(swatch)},`);
  }
  lines.push("    ]", "");

  const overrides: string[] = [];
  const gradients: string[] = [];
  const glows: string[] = [];
  const swatches: string[] = [];
  for (const look of looks()) {
    const base = skinTokens(CSS, look.skin);
    const worn = skinTokens(CSS, look.key);
    if (!base || !worn) throw new Error(`no tokens for ${look.key}`);
    const changed = TOKENS.filter(([, css]) => worn[css] !== undefined && worn[css] !== base[css]).map(([name, css]) => `${q(name)}: ${q(worn[css])}`);
    overrides.push(`        ${q(look.key)}: [${changed.join(", ")}],`);
    const tintBlock = rawBlock(tintSelector(look.skin, look.tint)) ?? {};
    const fullBlock = look.full ? rawBlock(fullSelector(look.skin, look.tint)) ?? {} : {};
    if (!look.full) {
      const gradient = tintBlock["--accent-gradient"];
      if (gradient && gradient !== "none") gradients.push(`        ${q(look.key)}: [${hexes(gradient).map(q).join(", ")}],`);
      const swatch = worn["--skin-swatch"];
      if (swatch) swatches.push(`        ${q(look.key)}: ${q(swatch)},`);
    }
    const lit = glow(fullBlock["--app-glow"] ?? tintBlock["--app-glow"], worn["--color-accent"]);
    if (lit) glows.push(`        ${q(look.key)}: [${lit.map(([hex, alpha]) => `(${q(hex)}, ${num(alpha)})`).join(", ")}],`);
  }
  lines.push("    /// \"skin+tint\" and \"skin+tint+full\": the tokens that differ from the base skin, resolved.");
  lines.push("    static let overrides: [String: [String: String]] = [", ...overrides, "    ]", "");
  lines.push("    /// \"skin+tint\": the stops of --accent-gradient (duo-tones and moods).");
  lines.push("    static let gradients: [String: [String]] = [", ...gradients, "    ]", "");
  lines.push("    /// The top glow (--app-glow) as colour and opacity; an empty list is none.");
  lines.push("    static let glows: [String: [(String, Double)]] = [", ...glows, "    ]", "");
  lines.push("    /// \"skin+tint\": the variant's swatch (--skin-swatch).");
  lines.push("    static let swatches: [String: String] = [", ...swatches, "    ]", "");
  lines.push("    /// src/styles/skin-texture.css.");
  lines.push("    static let textures: [String: [SkinTextureLayer]] = [");
  for (const [texture, layers] of Object.entries(textures())) {
    lines.push(`        ${q(texture)}: [`);
    for (const l of layers) {
      lines.push(`            SkinTextureLayer(kind: .${l.kind}, tileWidth: ${num(l.tileWidth)}, tileHeight: ${num(l.tileHeight)}, x: ${num(l.x)}, y: ${num(l.y)}, size: ${num(l.size)}, alpha: ${num(l.alpha)}),`);
    }
    lines.push("        ],");
  }
  lines.push("    ]", "}", "");
  return lines.join("\n");
}

describe("the phone's copy of the skin variants", () => {
  it("matches the desktop's families, tints, Full blocks, gradients, glows and textures", () => {
    const content = swift();
    if (UPDATE) {
      writeFileSync(SWIFT, content);
      return;
    }
    // a Windows checkout can hand the file over with CRLF; the content is what is compared
    expect(readFileSync(SWIFT, "utf8").replace(/\r\n/g, "\n"), `${SWIFT} is out of date: run UPDATE_IOS_SKINS=1 pnpm vitest run src/lib/ios-skin-variants-export.test.ts`).toBe(content);
  });

  it("covers every tint over every base skin its family offers", () => {
    const keys = looks().map((look) => look.key);
    // every colour variant has a Full block over each of its skins
    for (const family of PHONE_FAMILIES) {
      for (const variant of family.variants) {
        if (variant.group !== "color" || !variant.tint) continue;
        for (const skin of [variant.light, variant.dark]) if (skin) expect(keys).toContain(`${skin}+${variant.tint}+full`);
      }
    }
    // the seven Windows editions sit over Hibou 98
    expect(keys.filter((key) => key.startsWith("retro98+")).length).toBe(7);
  });

  it("reads every texture's layers", () => {
    const read = textures();
    expect(Object.keys(read).sort()).toEqual(PHONE_TEXTURES.filter((t) => t !== "none").slice().sort());
    for (const layers of Object.values(read)) {
      expect(layers.length).toBeGreaterThan(0);
      for (const layer of layers) {
        expect(layer.alpha).toBeGreaterThan(0);
        expect(layer.size).toBeGreaterThan(0);
      }
    }
  });
});
