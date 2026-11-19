import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { DurationSequencer } from "./scripts/testing/duration-sequencer.ts";
import { hostTimeout } from "./server/testing/host-timeout.ts";
import { pdfjsAssets } from "./scripts/vite-pdfjs-assets.ts";

// The About dialog shows the shipped version; package.json is the one place
// it is already maintained, so it is inlined at build time rather than
// round-tripped through the preload bridge (which is absent in dev).
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { version: string; baseVersion?: string; forkVersion?: string };
const baseVersion = pkg.baseVersion ?? pkg.version;
const forkVersion = pkg.forkVersion ?? pkg.version;

function nodeModulesRealpath(): string[] {
  try { return [realpathSync(fileURLToPath(new URL("./node_modules", import.meta.url)))]; } catch { return []; }
}

export default defineConfig({
  // React Compiler, opt-in per file or function with the "use memo"
  // directive (annotation mode) while it is proven on the hot views: the chat
  // and room transcripts and their rows. Files without the directive are not
  // touched; the preset's filter skips them before Babel parses anything.
  // pdfjsAssets: the PDF viewer's CMaps, standard fonts and wasm decoders,
  // served by the app (scripts/vite-pdfjs-assets.ts).
  plugins: [react(), babel({ presets: [reactCompilerPreset({ compilationMode: "annotation" })] }), tailwindcss(), pdfjsAssets()],
  define: {
    __APP_VERSION__: JSON.stringify(forkVersion),
    __BASE_VERSION__: JSON.stringify(baseVersion),
    // About's "Built <date>" (#4097): the day of the build, UTC, or the
    // reproducible build's own date when SOURCE_DATE_EPOCH is set
    __BUILD_DATE__: JSON.stringify(new Date(process.env.SOURCE_DATE_EPOCH ? Number(process.env.SOURCE_DATE_EPOCH) * 1000 : Date.now()).toISOString().slice(0, 10)),
  },
  // Two pages: the app, and the bar around a published page that a reader
  // opens from its link (page-reader.html, src/page-reader/). The server
  // reads the built page-reader.html for its script and style tags.
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        "page-reader": fileURLToPath(new URL("./page-reader.html", import.meta.url)),
      },
    },
  },
  test: {
    environment: "node",
    include: [
      "evals/**/*.test.ts",
      "server/**/*.test.ts",
      "electron/**/*.test.mjs",
      "src/**/*.test.ts",
      "shared/**/*.test.ts",
      "companion/**/*.test.ts",
      "scripts/**/*.test.mjs",
      "scripts/**/*.test.ts",
    ],
    setupFiles: ["server/testing/setup.ts"],
    // A per-run Local VM namespace: tests never touch openmausbot-computer.
    globalSetup: ["server/testing/global-setup.ts"],
    // the suite spawns fake provider CLIs and a real harness server;
    // parallel files introduce load-sensitive flakes for no win
    fileParallelism: false,
    // --shard splits the files by recorded CI seconds, not count (docs/ci.md)
    sequence: { sequencer: DurationSequencer },
    // Known flakes in scripts/testing/ci-retry-list.json get two retries in
    // CI only, and each retry is reported (docs/ci.md, "Flaky tests").
    runner: "./scripts/testing/ci-retry-runner.ts",
    // Doubled on Windows, whose runners are about 1.45x slower
    // (server/testing/host-timeout.ts).
    testTimeout: hostTimeout(20_000),
    hookTimeout: hostTimeout(30_000),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    // A worktree links node_modules to the main checkout's. Vite serves a
    // file only from under the root, so the real folder behind the link is
    // allowed too: otherwise every `?inline` font import (and the component
    // tests that load one) fails with "Denied ID" in a worktree.
    fs: { allow: [fileURLToPath(new URL(".", import.meta.url)), ...nodeModulesRealpath()] },
    // IPv4 explicitly — a bare ::1 bind makes localhost a coin-flip for
    // clients that resolve IPv4 first
    host: "127.0.0.1",
    port: Number(process.env.SAGAX_UI_PORT) || 5199,
    // packager output lands inside the repo — its HTML files must never
    // trigger dev full-page reloads
    watch: {
      ignored: ["**/release/**", "**/build/**", "**/dist/**", "**/electron/resources/**"],
    },
    // the harness server owns every provider process; the app only ever
    // talks to /api — clients hold no transports
    proxy: {
      "/api": {
        ws: true,
        target: `http://127.0.0.1:${process.env.SAGAX_PORT || process.env.OGB_PORT || 8799}`,
      },
      // published pages: the app frames its own preview of a page (2026-10-28)
      "/pages": {
        target: `http://127.0.0.1:${process.env.SAGAX_PORT || process.env.OGB_PORT || 8799}`,
      },
      "/.well-known/openmausbot/environment": {
        target: `http://127.0.0.1:${process.env.SAGAX_PORT || process.env.OGB_PORT || 8799}`,
      },
    },
  },
});
