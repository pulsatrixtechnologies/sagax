// The app's Geist face (latin, variable weight) as an @font-face rule with a
// data: URL, for the documents the server draws bot content in: the widget
// self-check (server/widgets/widget-check.ts) and the published pages' frame
// (server/pages/published-pages-render.ts). A data: font needs no request, so the
// frames keep `font-src data:` and no network.
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { widgetFontFace } from "../src/lib/widget-kit.ts";

let fontFace: string | undefined;
/** The chat's own font, so text wraps where it wraps in the app: from the
 * package in development, from the built UI (SAGAX_STATIC_DIR, where Vite
 * emits geist-latin-wght-normal-<hash>.woff2) in the image and the desktop,
 * which carry no node_modules. "" when neither is there: the fallback stack
 * then draws. Read once. */
export function geistFace(staticDir: string | null | undefined = process.env.SAGAX_STATIC_DIR || null): string {
  if (fontFace !== undefined) return fontFace;
  fontFace = "";
  const candidates: Array<() => string> = [
    () => join(dirname(createRequire(import.meta.url).resolve("@fontsource-variable/geist")), "files", "geist-latin-wght-normal.woff2"),
    () => {
      const assets = join(staticDir ?? "", "assets");
      const name = staticDir ? readdirSync(assets).find((file) => /^geist-latin-wght-normal.*\.woff2$/.test(file)) : undefined;
      if (!name) throw new Error("no font");
      return join(assets, name);
    },
  ];
  for (const candidate of candidates) {
    try {
      fontFace = widgetFontFace(`data:font/woff2;base64,${readFileSync(candidate()).toString("base64")}`);
      break;
    } catch { /* next; none: the fallback stack measures close enough */ }
  }
  return fontFace;
}
