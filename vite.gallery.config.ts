import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
