// The voice acceptance job loads the voice call through this hook. The call
// reaches src/lib/plain-error.ts, which imports `@/lib/i18n`, and i18n reads
// JSON catalogs and `import.meta.env`: plain Node knew none of the three, so
// the job failed on every run before running a scenario (#3521).
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- a plain .mjs loader hook without types
import { load, resolve } from "./asset-url-hook.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const parentURL = pathToFileURL(`${ROOT}src/lib/plain-error.ts`).href;
const passThrough = async (specifier: string, context: { parentURL?: string }) =>
  ({ url: new URL(specifier, context.parentURL ?? parentURL).href });

describe("voice acceptance loader hook", () => {
  it("resolves Vite's @/ alias to src/, with or without an extension", async () => {
    const i18n = await resolve("@/lib/i18n", { parentURL, importAttributes: {} }, passThrough);
    expect(i18n.url).toBe(pathToFileURL(`${ROOT}src/lib/i18n.ts`).href);
    const locales = await resolve("@/locales", { parentURL, importAttributes: {} }, passThrough);
    expect(locales.url).toBe(pathToFileURL(`${ROOT}src/locales/index.ts`).href);
  });

  it("imports a JSON file Vite-style, without an import attribute", async () => {
    const indexURL = pathToFileURL(`${ROOT}src/locales/index.ts`).href;
    const en = await resolve("./en.json", { parentURL: indexURL, importAttributes: {} }, passThrough);
    expect(en.importAttributes).toEqual({ type: "json" });
  });

  it("gives a src/ module that reads import.meta.env a production env", async () => {
    const url = pathToFileURL(`${ROOT}src/locales/index.ts`).href;
    const nextLoad = async () => ({ format: "module-typescript", source: 'if (import.meta.env.MODE === "test") {}\n' });
    const loaded = await load(url, {}, nextLoad);
    expect(String(loaded.source)).toMatch(/^import\.meta\.env \?\?= \{ MODE: "production"/);
    const untouched = await load(url, {}, async () => ({ format: "module", source: "export {};\n" }));
    expect(untouched.source).toBe("export {};\n");
  });

  it("still turns an onnx or wasm ?url import into its file URL", async () => {
    const asset = await resolve("./model.onnx?url", { parentURL, importAttributes: {} }, passThrough);
    expect(asset.url).toMatch(/model\.onnx\?asset-url$/);
    const loaded = await load(asset.url, {}, async () => { throw new Error("not reached"); });
    expect(loaded.source).toContain("model.onnx");
  });
});
