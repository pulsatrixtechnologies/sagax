import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

// The gallery has no Sagax server: a page card's preview frame
// (/pages/preview/<id>/<n>) fell through to the app's index.html, which booted
// the whole app inside the card and showed its error screen (QA 0.8.66 F11).
// Answer it with a synthetic page instead, as the capture scripts do.
export function galleryPagePreview(): Plugin {
  // in the gallery's language (QA 0.8.67 G10): lang=fr showed an English report
  const page = (dark: boolean, fr: boolean) => `<!doctype html><html lang="${fr ? "fr" : "en"}"><body style="font:16px/1.55 system-ui;margin:0;padding:72px 2rem 2rem;background:${dark ? "#0f1520" : "#fff"};color:${dark ? "#e8edf5" : "#111"}">
<h1 style="margin:0 0 .5rem">${fr ? "Rapport mensuel synthétique" : "Synthetic monthly report"}</h1><p>${fr ? "Billets fermés, délais de réponse et arriéré d'une équipe synthétique." : "Closed tickets, response times and backlog for a synthetic team."}</p>
${Array.from({ length: 3 }, (_, i) => `<h2>Section ${i + 1}</h2><p>${(fr ? "Chiffres et notes synthétiques. " : "Synthetic figures and notes. ").repeat(12)}</p>`).join("")}</body></html>`;
  return {
    name: "gallery-page-preview",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/pages/preview/")) return next();
        const theme = new URL(req.url, "http://gallery").searchParams.get("theme");
        // the frame's own URL has no lang and the app sends it with no
        // referrer: the gallery page sets a cookie (src/gallery/page-chat-real.tsx)
        const cookie = /(?:^|;\s*)sagax-gallery-lang=(\w+)/.exec(req.headers.cookie ?? "")?.[1];
        const lang = new URL(req.url, "http://gallery").searchParams.get("lang") ?? cookie;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(page(theme !== "light", lang === "fr"));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), galleryPagePreview()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  root: path.resolve(__dirname),
  publicDir: path.resolve(__dirname, "public"),
  server: {
    port: 5199,
    strictPort: true,
    // A worktree's node_modules is often a link to another checkout: let the
    // gallery serve its fonts from there too (dev server only).
    fs: { allow: [path.resolve(__dirname), fs.realpathSync(path.resolve(__dirname, "node_modules"))] },
  },
  build: {
    outDir: path.resolve(__dirname, "dist-gallery"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "src/gallery/video-widgets.html"),
    },
  },
});
