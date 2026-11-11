// Resolve `*.onnx?url` and `*.wasm?url` to a module whose default export is
// the file URL. The acceptance runner supplies its own voice detector, so
// these files are not executed. A custom resolver replaces Node's
// strip-types extension lookup, so extensionless relative imports get `.ts`,
// and Vite's `@/` alias (vite.config.ts) points at src/: the voice call
// reaches src/lib/plain-error.ts, which imports `@/lib/i18n` (#3521).
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

const ASSET = /\.(?:onnx|wasm)(?:\?|$)/;
const SRC = new URL("../../src/", import.meta.url);

function typescriptSpecifier(specifier, parentURL) {
  const alias = specifier.startsWith("@/");
  if (!alias && !specifier.startsWith(".") && !specifier.startsWith("/")) return null;
  const bare = alias ? specifier.slice(2).split("?")[0] : specifier.split("?")[0];
  const parent = alias ? SRC : parentURL ?? import.meta.url;
  if (extname(bare)) return alias ? new URL(bare, parent).href : null;
  for (const candidate of [`${bare}.ts`, `${bare}.tsx`, `${bare}.mts`, `${bare}/index.ts`]) {
    const url = new URL(candidate, parent);
    if (url.protocol === "file:" && existsSync(fileURLToPath(url))) return alias ? url.href : candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (ASSET.test(specifier)) {
    const bare = specifier.split("?")[0];
    const parent = context.parentURL ?? import.meta.url;
    const url = new URL(bare, parent);
    return { url: `${url.href}?asset-url`, shortCircuit: true };
  }
  const rewritten = typescriptSpecifier(specifier, context.parentURL);
  const resolved = await nextResolve(rewritten ?? specifier, context);
  // Vite imports JSON without an attribute (src/locales/index.ts); Node
  // wants `with { type: "json" }`.
  if (resolved.url.startsWith("file:") && resolved.url.endsWith(".json") && !context.importAttributes?.type) {
    return { ...resolved, importAttributes: { ...context.importAttributes, type: "json" } };
  }
  return resolved;
}

// Vite's `import.meta.env` (src/locales/index.ts reads its MODE) as a
// production build sees it.
const VITE_ENV = 'import.meta.env ??= { MODE: "production", DEV: false, PROD: true, SSR: false, BASE_URL: "/" };\n';

export async function load(url, context, nextLoad) {
  if (!url.includes("?asset-url") || !ASSET.test(url)) {
    const loaded = await nextLoad(url, context);
    if (!url.startsWith(SRC.href) || loaded.source == null || !(loaded.format ?? "").startsWith("module")) return loaded;
    const source = String(loaded.source);
    return source.includes("import.meta.env") ? { ...loaded, source: VITE_ENV + source } : loaded;
  }
  const file = url.slice(0, url.indexOf("?"));
  return {
    format: "module",
    source: `export default ${JSON.stringify(file)};\n`,
    shortCircuit: true,
  };
}
