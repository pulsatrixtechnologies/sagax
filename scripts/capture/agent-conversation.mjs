#!/usr/bin/env node
/**
 * Headless screenshots of an outside agent's conversation with a bot
 * (gallery agent-conversation, Playwright, no window): the bot's chat with
 * the conversation line and the Earlier topics list, then the open
 * conversation "<agent> ⇆ Nova", at a narrow and a medium width, dark and
 * light. The script answers the thread read itself.
 * Usage: node scripts/capture/agent-conversation.mjs [--out DIR] [--port N] [--agent NAME]
 * Files: <list|open>-<width>-<scheme>.png
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "agent-conversation")));
const port = Number(arg("--port", "5298"));
const agent = arg("--agent", "Voice assistant");
const skins = [{ id: "pulsatrix", label: "dark" }, { id: "pulsatrix-light", label: "light" }];
const widths = [{ width: 560, label: "narrow" }, { width: 1100, label: "medium" }];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite gallery did not start at ${url}`);
}

const at = Date.now();
const messages = [
  { id: "m1", role: "user", kind: "text", text: "What is on my calendar this afternoon?", at: at - 90_000, aiClient: true },
  { id: "m2", role: "bot", kind: "text", text: "Two meetings: the weekly review at 2 PM and a call with the support lead at 4 PM.", at: at - 60_000 },
  { id: "m3", role: "user", kind: "text", text: "Move the support call to tomorrow morning.", at: at - 30_000, aiClient: true },
  { id: "m4", role: "bot", kind: "text", text: "Done: the call is now tomorrow at 9 AM, and the invite was updated.", at: at - 10_000 },
];

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/agent-conversation.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : {});
  for (const { width, label: size } of widths) {
    const page = await browser.newPage({ viewport: { width, height: 760 }, deviceScaleFactor: 2 });
    await page.route("**/api/threads/*/messages*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ messages, hasMore: false }) }));
    for (const { id, label } of skins) {
      await page.goto(`${base}?skin=${id}&agent=${encodeURIComponent(agent)}`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-gallery-line] [data-agent-avatar]");
      const list = join(outDir, `list-${size}-${label}.png`);
      await page.screenshot({ path: list });
      console.log(list);
      await page.click("[data-gallery-line] [data-testid=bot-exchange-chip]");
      await page.waitForSelector("[data-testid=bot-exchange-sheet] [data-mid=m4]");
      await page.waitForTimeout(300);
      const open = join(outDir, `open-${size}-${label}.png`);
      await page.screenshot({ path: open });
      console.log(open);
    }
    await page.close();
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
