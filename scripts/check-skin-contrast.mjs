#!/usr/bin/env node
// Reads the skin blocks out of src/styles.css and measures every text/surface
// pair the components actually produce. Run it after touching a palette:
//
//   pnpm check:contrast            # every skin, every context
//   pnpm check:contrast --verbose  # also prints the passing contexts' counts
//   node scripts/check-skin-contrast.mjs --css path/to/other.css
//
// It parses the CSS rather than taking a second copy of the values, so the
// check can never pass against a palette that is no longer the shipped one.
//
// A token is measured where it is RENDERED, not only where it is declared.
// Three kinds of context re-declare tokens for a subtree and are measured on
// their own, each over the skin it sits in:
//
//   - a skin's own scoped band, `[data-skin="x"] .content-topbar { … }`:
//     Pulsatrix Light repaints the chat header navy and points `ink` at the
//     rail's light ink there. Every popover opened from that header used to
//     inherit the light ink onto its white card (the thread picker's rows
//     measured 1.11:1), and nothing here saw it, because the pair only exists
//     inside the band.
//   - `.popover-surface`, the class every popover, menu and sheet wears: it
//     points the generic tokens back at the `--color-popover-*` set, which
//     each skin resolves once at its own root. Measured over the root and
//     over every band, so a popover reads the same wherever it opens.
//   - the inverted user bubble of Daylight and Meadow (`@scope` blocks).
import { readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";


function declarations(body) {
  const tokens = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[name] = value.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  }
  return tokens;
}

/** The tokens every skin starts from: the `@theme` defaults, the bare
 * `:root` block and the generic `[data-skin]` block. A skin that does not
 * redefine one of these still SHIPS it, so the check has to measure it,
 * otherwise a token upstream adds is inherited untested by every skin, and
 * the run stays green while a light skin wears a dark skin's focus ring.
 * That is exactly what happened when upstream introduced --color-focus.
 *
 * `@theme inline` tokens are kept apart: they resolve where they are USED,
 * so a context that re-declares `ink` changes them too. */
function parseBase(source) {
  const base = {};
  const inline = {};
  for (const [, isInline, body] of source.matchAll(/(?:^|\n)(?:@theme(\s+inline)?|:root|\[data-skin\])\s*\{([^}]*)\}/g)) {
    Object.assign(isInline ? inline : base, declarations(body));
  }
  return { base, inline };
}

/** Every `[data-skin="x"] { … }` block, as id → raw {token: value}. */
function parseSkins(source) {
  const skins = new Map();
  for (const [, id, body] of source.matchAll(/(?:^|\n)\[data-skin="([a-z0-9-]+)"\]\s*\{([^}]*)\}/g)) {
    skins.set(id, declarations(body));
  }
  // A colour tint, `[data-skin="x"][data-skin-tint="t"] { … }`, is measured
  // as worn: its tokens over its base skin's, under the id "x+t".
  for (const [, id, tint, body] of source.matchAll(/(?:^|\n)\[data-skin="([a-z0-9-]+)"\]\[data-skin-tint="([a-z0-9-]+)"\]\s*\{([^}]*)\}/g)) {
    if (skins.has(id)) skins.set(`${id}+${tint}`, { ...skins.get(id), ...declarations(body) });
  }
  // A full-surface colour, `[data-skin="x"][data-skin-tint="t"][data-skin-depth="full"] { … }`:
  // over the tint over the base, as "x+t+full".
  for (const [, id, tint, body] of source.matchAll(/(?:^|\n)\[data-skin="([a-z0-9-]+)"\]\[data-skin-tint="([a-z0-9-]+)"\]\[data-skin-depth="full"\]\s*\{([^}]*)\}/g)) {
    const tinted = skins.get(`${id}+${tint}`);
    if (tinted) skins.set(`${id}+${tint}+full`, { ...tinted, ...declarations(body) });
  }
  // A gradient fill (duo-tones, moods) declares its two ends as --accent-from
  // and --accent-to: the accent's pairs are measured at each end as well, as
  // "x+t@from" and "x+t@to", since a label crosses the whole gradient.
  // collected apart, then added: setting entries while iterating the map would visit them
  const ends = new Map();
  for (const [id, tokens] of skins) {
    for (const end of ["--accent-from", "--accent-to"]) {
      if (tokens[end]) ends.set(`${id}@${end.slice(9)}`, { ...tokens, "--color-accent": tokens[end] });
    }
  }
  for (const [id, tokens] of ends) skins.set(id, tokens);
  return skins;
}

/** Scoped bands: `[data-skin="x"] .class { … }` blocks that re-declare a
 * colour token for their subtree. */
function parseBands(source) {
  const bands = [];
  for (const [, id, selector, body] of source.matchAll(/(?:^|\n)\[data-skin="([a-z0-9-]+)"\]\s+(\.[\w-]+)\s*\{([^}]*)\}/g)) {
    const tokens = declarations(body);
    if (Object.keys(tokens).some((name) => name.startsWith("--color-"))) bands.push({ id, selector, tokens });
  }
  return bands;
}

function parsePopover(source) {
  const body = /(?:^|\n)\s*\.popover-surface\s*\{([^}]*)\}/.exec(source)?.[1];
  return body ? declarations(body) : null;
}

// ── colour values ────────────────────────────────────────────────────────
function parseHex(value) {
  const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (!match) return null;
  const h = match[1];
  const full = h.length <= 4 ? Array.from(h, (c) => c + c).join("") : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
  };
}

/** Split a function's arguments on the top-level commas only. */
function splitArgs(text) {
  const parts = [];
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

/** `color-mix(in srgb, A p%, B)`, premultiplied as the browser does it. */
function mix(first, firstPct, second, secondPct) {
  let p1 = firstPct ?? (secondPct === undefined ? 0.5 : 1 - secondPct);
  let p2 = secondPct ?? 1 - p1;
  const sum = p1 + p2;
  p1 /= sum;
  p2 /= sum;
  const alpha = first.a * p1 + second.a * p2;
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const channel = (k) => (first[k] * first.a * p1 + second[k] * second.a * p2) / alpha;
  return { r: channel("r"), g: channel("g"), b: channel("b"), a: alpha };
}

/** Evaluate a token value to {r,g,b,a}, or null when it is not a colour
 * this script understands. `lookup` resolves a var() in the same context. */
function evaluate(value, lookup) {
  const text = value.trim();
  if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const hex = parseHex(text);
  if (hex) return hex;
  const variable = /^var\(\s*(--[\w-]+)\s*(?:,(.*))?\)$/s.exec(text);
  if (variable) {
    const found = lookup(variable[1]);
    if (found) return found;
    return variable[2] ? evaluate(variable[2], lookup) : null;
  }
  const colorMix = /^color-mix\(\s*in\s+srgb\s*,(.*)\)$/s.exec(text);
  if (colorMix) {
    const [a, b] = splitArgs(colorMix[1]).map((part) => {
      const pct = /\s(\d+(?:\.\d+)?)%$/.exec(part);
      return { color: evaluate(pct ? part.slice(0, pct.index) : part, lookup), pct: pct ? Number(pct[1]) / 100 : undefined };
    });
    if (!a?.color || !b?.color) return null;
    return mix(a.color, a.pct, b.color, b.pct);
  }
  return null;
}

/** Resolve a set of declarations on one element: `parent` is what the
 * element inherits (already resolved), `own` what it declares. A var() in
 * `own` sees the element's own declarations first, as in CSS. The `inline`
 * set (from `@theme inline`) is re-resolved here unless `own` declares it. */
function resolve(own, parent, inline) {
  const result = { ...parent };
  const declared = { ...inline, ...own };
  const stack = new Set();
  const lookup = (name) => {
    if (name in declared) {
      if (stack.has(name)) return null;
      stack.add(name);
      const value = evaluate(declared[name], lookup);
      stack.delete(name);
      return value;
    }
    return parent[name] ?? null;
  };
  for (const name of Object.keys(declared)) result[name] = lookup(name);
  return result;
}

function flatten(fg, bg) {
  if (fg.a === 1) return fg;
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

function luminance({ r, g, b }) {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast of fg over bg; a translucent bg is first laid over `under`
 * (the surface it actually sits on). Null when a colour is missing or the
 * ground is still translucent. */
function contrast(fg, bg, under) {
  if (!fg || !bg) return null;
  const ground = bg.a === 1 ? bg : under ? flatten(bg, under) : null;
  if (!ground || ground.a !== 1) return null;
  const flat = flatten(fg, ground);
  const [hi, lo] = [luminance(flat), luminance(ground)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

// ── the pairs ────────────────────────────────────────────────────────────
// Each pair is [fg, bg, min, under?]. `under` names the opaque surface a
// translucent bg is laid over (a hover wash, a status tint).
//
// Thresholds: 4.5:1 for text (body and secondary alike: the secondary ink
// carries timestamps and hints at 11-12px), 3:1 for icons, check marks and
// borders that identify a control (WCAG 1.4.11), and a just-perceptible step
// for decorative hairlines and surface-on-surface fills.

const SURFACES = ["--color-app", "--color-panel", "--color-raised", "--color-raised-hover", "--color-card", "--color-inset", "--color-composer", "--color-menu"];
const TEXT_INKS = ["--color-ink", "--color-ink-secondary", "--color-ink-tertiary"];
const PAIRS = [
  ...SURFACES.flatMap((s) => TEXT_INKS.map((ink) => [ink, s, 4.5])),
  // Grok-style layered surfaces (`@theme inline`): the header pills, the
  // model / approval / where-it-works chips, the sidebar popover menus
  // (account, folder, the thread "..." actions) all paint `elevated`, and
  // their hover is `elevated-hover` or the translucent `hover` wash.
  ...["--color-elevated", "--color-elevated-hover"].flatMap((s) => TEXT_INKS.map((ink) => [ink, s, 4.5, "--color-panel"])),
  ...TEXT_INKS.map((ink) => [ink, "--color-hover", 4.5, "--color-elevated"]),
  ...TEXT_INKS.map((ink) => [ink, "--color-selected", 4.5, "--color-panel"]),
  ["--color-bubble-user-ink", "--color-bubble-user", 4.5],
  ["--color-accent-ink", "--color-accent", 4.5],
  ["--color-danger-ink", "--color-danger", 4.5],
  ["--color-success-ink", "--color-success", 4.5],
  // The Primary Bot star (Avatar.tsx PrimaryBotBadge): its orange disc is
  // the mark, 3:1 on the rail it sits on (the star inside is decoration).
  ["--color-primary-badge", "--color-sidebar", 3],
  ...["--color-app", "--color-panel", "--color-card", "--color-menu", "--color-composer", "--color-raised-hover", "--color-inset"].map((s) => ["--color-accent-text", s, 4.5]),
  ...["--color-danger", "--color-success", "--color-warning"].flatMap((tone) => [
    [tone, "--color-card", 4.5],
    [tone, "--color-panel", 4.5],
    [tone, "--color-menu", 4.5],
  ]),
  // Status text on its own tint: the approval, error and key cards paint
  // `bg-danger/10` (or /15) behind `text-danger` on a card.
  ...["--color-danger", "--color-success", "--color-warning"].flatMap((tone) => [
    [tone, `${tone}/10`, 4.5, "--color-card"],
    [tone, `${tone}/15`, 4.5, "--color-card"],
  ]),
  ["--color-accent-text", "--color-accent/10", 4.5, "--color-card"],
  ["--color-accent-text", "--color-accent/15", 4.5, "--color-card"],
  // On, active, connected, paused, waiting and scheduled wear this tint
  // (`bg-accent/15 text-accent-text`), on a card or on the panel, never the
  // success green or the warning amber (their own tints are held above).
  ["--color-accent-text", "--color-accent/15", 4.5, "--color-panel"],
  // The standard switch, on: an `accent` track (never the success green) with
  // an `accent-border` ring and an `accent-ink` thumb (4.5:1 on the track,
  // paired above). The track is a UI component, so 3:1 against every surface
  // a switch sits on, through its ring: Dusk's muted accent fill alone is
  // 2.4:1 on raised.
  ...["--color-panel", "--color-card", "--color-raised"].map((s) => ["--color-accent-border", s, 3]),
  // The accent as a glyph: check marks, the active-row tick, toggles and
  // the accent icons on menus and cards. A glyph is held to 3:1.
  ...["--color-app", "--color-panel", "--color-card", "--color-menu", "--color-raised-hover", "--color-composer"].map((s) => ["--color-accent", s, 3]),
  // borders and dots are UI components, not text; AA asks 3:1 of them
  ["--color-hairline", "--color-app", 1.5],
  ["--color-scrollbar", "--color-app", 1.5],
  // The persistent left rail: Pulsatrix Light paints it in its own navy
  // chrome, not `panel`/`ink`, so it needs its own pairs. The rows' hover
  // and selected fills are translucent washes over the rail, and the
  // selected row's timestamp and preview line sit on that wash.
  ["--color-sidebar-ink", "--color-sidebar", 4.5],
  ["--color-sidebar-ink-secondary", "--color-sidebar", 4.5],
  ["--color-sidebar-ink", "--color-sidebar-hover", 4.5, "--color-sidebar"],
  ["--color-sidebar-ink-secondary", "--color-sidebar-hover", 4.5, "--color-sidebar"],
  ["--color-sidebar-ink", "--color-sidebar-selected", 4.5, "--color-sidebar"],
  ["--color-sidebar-ink-secondary", "--color-sidebar-selected", 4.5, "--color-sidebar"],
  ["--color-sidebar-ink", "--color-sidebar-elevated", 4.5],
  ["--color-sidebar-hairline", "--color-sidebar", 1.5],
  // The focus ring sits outside the control (outline-offset: 2px), so it
  // lands on whatever surface is behind it. WCAG 1.4.11 asks 3:1 of a
  // non-text indicator. A focused text field paints its own border in the
  // ring colour, so the ring also has to clear the fills fields use.
  ...["--color-app", "--color-panel", "--color-card", "--color-inset", "--color-raised", "--color-control"].map((s) => ["--color-focus", s, 3]),
  // Surface against surface. Text contrast alone will not catch a skin that
  // gives two surfaces the same value: Atelier and Lagoon both defined
  // `raised` as the pure white they use for a card, so every chip, hover fill
  // and answered row painted in `raised` on a card was invisible while this
  // file stayed green. A surface is not text, it only has to be seen at all,
  // so the bar is a just-perceptible step rather than a WCAG ratio.
  ["--color-control", "--color-card", 1.06],
  ["--color-control", "--color-panel", 1.06],
  ["--color-control", "--color-app", 1.04],
  ["--color-control", "--color-inset", 1.04],
  ["--color-control", "--color-raised-hover", 1.04],
  ["--color-raised-hover", "--color-card", 1.04],
  ["--color-inset", "--color-card", 1.04],
  ["--color-card", "--color-app", 1.04],
  ["--color-panel", "--color-app", 1.03],
];

// Measured inside a `.popover-surface`, over the skin root and over every
// band. The popover's own tokens, and the generic tokens a component nested
// in a popover (a shared button, a menu row) still reads.
const POPOVER_PAIRS = [
  ...["--color-popover-ink", "--color-popover-ink-secondary", "--color-popover-placeholder"].flatMap((ink) =>
    ["--color-popover", "--color-popover-field", "--color-popover-hover"].map((s) => [ink, s, 4.5])),
  ["--color-popover-accent", "--color-popover", 4.5],
  ["--color-popover-accent", "--color-popover-hover", 4.5],
  // the field outline and the popover's own edge identify them: 3:1
  ["--color-popover-border", "--color-popover", 3],
  ["--color-popover-border", "--color-popover-field", 3],
  ["--color-popover-hover", "--color-popover", 1.04],
  ["--color-popover-field", "--color-popover", 1.04],
  // what a nested component reads through the generic names
  ...["--color-card", "--color-menu", "--color-inset", "--color-raised", "--color-raised-hover"].flatMap((s) => TEXT_INKS.map((ink) => [ink, s, 4.5])),
  ...["--color-elevated", "--color-elevated-hover"].flatMap((s) => TEXT_INKS.map((ink) => [ink, s, 4.5, "--color-panel"])),
  ...TEXT_INKS.map((ink) => [ink, "--color-hover", 4.5, "--color-elevated"]),
  ["--color-raised", "--color-card", 1.04],
];

// A band repaints its own ground; its text sits on that ground and on the
// pills and circles built from `elevated`/`raised` over it.
const BAND_PAIRS = [
  ...["--color-panel", "--color-elevated", "--color-elevated-hover"].flatMap((s) => TEXT_INKS.map((ink) => [ink, s, 4.5, "--color-panel"])),
  ...TEXT_INKS.map((ink) => [ink, "--color-raised", 4.5, "--color-panel"]),
  ...TEXT_INKS.map((ink) => [ink, "--color-raised-hover", 4.5, "--color-panel"]),
];

// Midnight faithfully keeps one upstream contrast gap (white on its accent
// fill). It may improve, but must not get worse; every other below-target
// pair is a regression. Its danger gap (white on red, 3.10:1) was closed
// when the red was lifted for error text on its own tint.
const BASELINE_FLOORS = new Map([
  ["midnight|--color-accent-ink|--color-accent", 3.65],
]);
const BASELINE_DRIFT = 0.01;

/** A token, or `--name/NN` for that token at NN% (a Tailwind opacity
 * modifier: the status tints behind approval and error cards). */
function token(tokens, name) {
  const [base, pct] = name.split("/");
  const value = tokens[base];
  if (!value || pct === undefined) return value;
  return { ...value, a: value.a * (Number(pct) / 100) };
}

/** Measure `pairs` in one context. Returns {measured, problems, missing}. */
function measure(tokens, pairs) {
  const problems = [];
  const missing = new Set();
  let measured = 0;
  for (const [fg, bg, min, under] of pairs) {
    // A pair we cannot measure is reported, never silently skipped: an
    // unmeasured pair used to be counted as a passing one.
    const ratio = contrast(tokens[fg], token(tokens, bg), under ? tokens[under] : undefined);
    if (ratio === null) {
      const absent = [fg, bg, under].filter((name) => name && !token(tokens, name));
      for (const name of absent) missing.add(name);
      if (!absent.length) missing.add(`${fg} on ${bg} (unmeasurable)`);
      continue;
    }
    measured++;
    if (ratio < min) problems.push({ fg, bg, ratio, min });
  }
  return { measured, problems, missing: [...missing] };
}

/** One skin's tokens as they resolve at its root, as `#rrggbb[aa]` hex:
 * what a tuning script nudges, and what a test can assert on. */
export function skinTokens(css, id) {
  const { base, inline } = parseBase(css);
  const raw = parseSkins(css).get(id);
  if (!raw) return null;
  const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("") + (c.a < 1 ? Math.round(c.a * 255).toString(16).padStart(2, "0") : "");
  const resolved = resolve({ ...base, ...raw }, {}, inline);
  return Object.fromEntries(Object.entries(resolved).filter(([, v]) => v && typeof v === "object").map(([k, v]) => [k, hex(v)]));
}

/** Measure every skin of `css` in every context. Pure: returns the report
 * lines and the failing pairs rather than printing them, so the unit test
 * and a tuning script can call it on a modified stylesheet. */
export function checkContrast(css, { verbose = false } = {}) {
  const { base, inline } = parseBase(css);
  const POPOVER = parsePopover(css);
  const skins = parseSkins(css);
  const bands = parseBands(css);

  let failed = false;
    const out = [];
    const found = [];
  let failingPairs = 0;
  function report(id, label, { measured, problems, missing }) {
    let contextFailed = missing.length > 0;
    for (const { fg, bg, ratio } of problems) {
      const floor = BASELINE_FLOORS.get(`${id}|${fg}|${bg}`);
      if (floor === undefined || ratio < floor - BASELINE_DRIFT) contextFailed = true;
    }
    const name = label ? `${id} ${label}` : id;
    if (missing.length) out.push(`✗ ${name}: undefined or unmeasurable: ${missing.join(", ")}`);
    if (problems.length === 0) {
      if (!missing.length && (verbose || !label)) out.push(`✓ ${name}: ${measured} pairs, none below target`);
    } else {
      out.push(`${contextFailed ? "✗" : "~"} ${name}${contextFailed ? "" : " (known upstream gaps)"}`);
      for (const { fg, bg, ratio, min } of problems) {
        const floor = BASELINE_FLOORS.get(`${id}|${fg}|${bg}`);
        const baseline = floor === undefined ? "" : `; baseline ${floor.toFixed(2)}:1`;
        out.push(`    ${fg} on ${bg}: ${ratio.toFixed(2)}:1 (needs ${min}:1${baseline})`);
        if (floor === undefined) {
          failingPairs++;
          found.push({ skin: id, context: label || "root", fg, bg, ratio, min });
        }
      }
    }
    if (contextFailed) failed = true;
  }

  if (!POPOVER) {
    failed = true;
    out.push("✗ no `.popover-surface { … }` block: popovers would inherit whatever band they open from");
  }

  for (const [id, raw] of skins) {
    const rootTokens = resolve({ ...base, ...raw }, {}, inline);
    report(id, "", measure(rootTokens, PAIRS));
    const contexts = [["popover", rootTokens]];
    for (const band of bands.filter((b) => b.id === id.split(/[+@]/)[0])) {
      const bandTokens = resolve(band.tokens, rootTokens, inline);
      report(id, band.selector, measure(bandTokens, BAND_PAIRS));
      contexts.push([`${band.selector} popover`, bandTokens]);
    }
    for (const [label, parent] of contexts) {
      // Without the class a popover is just its parent context.
      const tokens = POPOVER ? resolve(POPOVER, parent, inline) : parent;
      report(id, label, measure(tokens, POPOVER_PAIRS));
    }
  }

  // Mascots. The Neutral white character (shared/mascot-colors.ts) is
  // near-white, so on a light surface alone it has no contrast to speak of.
  // There is no disc behind it: on a light skin the silhouette wears a drop
  // shadow (--mascot-shadow-color), so the gate is that every light skin sets
  // one with at least 0.3 alpha. The white-on-surface figures are printed for
  // the record; they are not gated.
  const mascotWhite = /white:\s*"(#[0-9a-fA-F]{6})"/.exec(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "shared", "mascot-colors.ts"), "utf8"))?.[1];
  if (!mascotWhite) {
    failed = true;
    out.push("\u2717 mascot: cannot find the Neutral white in shared/mascot-colors.ts");
  }
  for (const [id, raw] of skins) {
    if (!mascotWhite) break;
    const light = (raw["--code-color-scheme"] ?? base["--code-color-scheme"]) === "light";
    if (!light) continue;
    const tokens = { ...resolve({ ...base, ...raw }, {}, inline), "--mascot-white": parseHex(mascotWhite) };
    const shadow = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec((raw["--mascot-shadow-color"] ?? "").trim());
    if (!shadow || Number(shadow[4]) < 0.3) {
      failed = true;
      failingPairs++;
      out.push(`\u2717 ${id} mascot: a light skin sets no --mascot-shadow-color of at least 0.3 alpha`);
      continue;
    }
    const alone = ["--color-app", "--color-panel", "--color-card", "--color-inset"].map((t) => `${t.slice(8)} ${contrast(tokens["--mascot-white"], tokens[t])?.toFixed(2)}`).join(", ");
    out.push(`  ${id} mascot white alone: ${alone}; shadow ${shadow[0]}`);
  }

  // The inverted bubbles (Daylight's ink-black, Meadow's green-black) have
  // their own inherited context: the editor, labels, quotes and file chips
  // explicitly use these tokens, not parent color.
  for (const skinId of ["daylight", "meadow"]) {
    const scope = css.match(new RegExp(`@scope \\(\\[data-skin="${skinId}"\\]\\) to \\(\\[data-skin\\]\\)\\s*\\{\\s*\\.bg-bubble-user\\s*\\{([^}]*)\\}`))?.[1];
    if (!scope) {
      failed = true;
      out.push(`✗ ${skinId} bubble: no @scope block for the inverted bubble`);
      continue;
    }
    const rootTokens = resolve({ ...base, ...skins.get(skinId) }, {}, inline);
    const bubble = resolve(declarations(scope), rootTokens, inline);
    report(skinId, "bubble", measure(bubble, [
      ["--color-ink", "--color-bubble-user", 4.5],
      ["--color-ink-secondary", "--color-bubble-user", 4.5],
      ["--color-ink", "--color-raised", 4.5],
      ["--color-ink-secondary", "--color-raised-hover", 4.5],
      ["--color-ink-secondary", "--color-inset", 4.5],
      ["--color-ink-tertiary", "--color-bubble-user", 4.5],
      ["--color-ink-tertiary", "--color-raised-hover", 4.5],
      ["--color-ink-tertiary", "--color-inset", 4.5],
      ["--color-accent", "--color-inset", 4.5],
      ["--color-accent-text", "--color-bubble-user", 4.5],
      ["--color-ink", "--color-control", 4.5],
      ["--color-accent-ink", "--color-accent", 4.5],
      ["--color-danger-ink", "--color-danger", 4.5],
      ["--color-success-ink", "--color-success", 4.5],
    ]));
    if (POPOVER) report(skinId, "bubble popover", measure(resolve(POPOVER, bubble, inline), POPOVER_PAIRS));
  }

  return { failed, failingPairs, lines: out, problems: found };

}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const args = process.argv.slice(2);
  const cssArg = args.indexOf("--css");
  let css = readFileSync(cssArg >= 0 ? args[cssArg + 1] : join(root, "src/styles.css"), "utf8");
  // Hibou 98's Windows editions keep their palette blocks beside their chrome
  // (src/styles/retro-editions/*.css): measured as retro98 tints like the colours.
  if (cssArg < 0) {
    // the richer variants' blocks (full colours, duo-tones, moods) sit in their own files
    for (const name of ["depth", "duo", "ambiance", "texture"]) css += "\n" + readFileSync(join(root, `src/styles/skin-${name}.css`), "utf8");
    const editions = join(root, "src/styles/retro-editions");
    for (const file of readdirSync(editions).filter((name) => name.endsWith(".css")).sort()) css += "\n" + readFileSync(join(editions, file), "utf8");
  }
  const result = checkContrast(css, { verbose: args.includes("--verbose") });
  for (const line of result.lines) console.log(line);
  console.log(result.failed ? `\n${result.failingPairs} pair(s) below target` : "\nall skins clear their targets in every context");
  process.exit(result.failed ? 1 : 0);
}
