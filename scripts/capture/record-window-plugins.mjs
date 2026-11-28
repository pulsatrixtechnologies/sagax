#!/usr/bin/env node
/**
 * Headless screenshots of the record windows of the other plugins
 * (M-20261127-141, M-20261127-146): a SentinelOne threat, an Axcient
 * x360Recover protected system, a BookStack page, a Twilio conversation, an X
 * post and a folder of files, each in its tabs (and the folder in its three
 * views), then the threat over a console that serves its card only, dark and
 * light, French and English. With `--mockup DIR`, each capture is also set
 * beside the mockup's capture of the same state (DIR/<name>.png), in
 * `side-<name>-<skin>-<lang>.png`. Synthetic data only
 * (src/gallery/record-window-plugins.html). Headless Chrome: no window opens,
 * never the owner's port 5173.
 * Usage: node scripts/capture/record-window-plugins.mjs [--out DIR] [--mockup DIR] [--lang fr|en|both]
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "record-window-plugins"));
const mockupDir = arg("--mockup") ? resolve(arg("--mockup")) : undefined;
const langs = (arg("--lang") ?? "both") === "both" ? ["fr", "en"] : [arg("--lang")];
const skins = [{ id: "pulsatrix", label: "dark" }, { id: "daylight", label: "light" }];

async function freePort() {
  for (let candidate = 5300; candidate <= 5399; candidate += 1) {
    const free = await new Promise((done) => {
      const probe = createServer().once("error", () => done(false)).once("listening", () => probe.close(() => done(true)));
      probe.listen(candidate, "127.0.0.1");
    });
    if (free) return candidate;
  }
  throw new Error("no free port between 5300 and 5399");
}
const port = await freePort();

async function waitForServer(url, ms = 180_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

// the invented products' marks (the console serves an https address)
const mark = (fill, text, ink = "#fff") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${fill}"/><text x="32" y="42" font-size="26" font-family="system-ui" font-weight="700" text-anchor="middle" fill="${ink}">${text}</text></svg>`;
const MARKS = { s1: mark("#6b46c1", "S1"), ax: mark("#1f9d8b", "Ax"), bs: mark("#2f7fd6", "B"), tw: mark("#e5304a", "T"), x: mark("#000", "X"), files: mark("#3a86d6", "F") };
const WINDOW = "[data-record-window]";
// the X post's pictures on X's own CDN (invented: a boot check's screen and a round picture)
const X_MEDIA = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAGAAAAA2CAIAAAC3LQuFAAAEkklEQVR42u3UNw7sBBRAUVbAJIdm4p+cOtuTPDk7u2URrISFsSyKp2u9isYI8YWls4Jb3F9+bTuKC0/U2htssSvU23sc4ItG+4iTchbN9gVX3ESrfVceeAqj/cIbn4LZ/iJAKKx2hFhJhN1OkSEXv1SBqkAlA3UcxYUnap0NttgV6p09DvBFo3PESTmLZueCK26i1bkrDzyF0XnhjU/B7HwRIBRWJ0KsJMLupMiQiypQFahsoK6juPBErbvBFrtCvbvHAb5odI84KWfR7F5wxU20unflgacwui+88SmY3S8ChMLqRoiVRNjdFBlyUQWqApUN1HMUF56o9TbYYleo9/Y4wBeN3hEn5SyavQuuuIlW76488BRG74U3PgWz90WAUFi9CLGSCLuXIkMuqkBVoLKB+o7iwhO1/gZb7Ar1/h4H+KLRP+KknEWzf8EVN9Hq35UHnsLov/DGp2D2vwgQCqsfIVYSYfdTZMhFFagKVDbQwFFceKI22GCLXaE+2OMAXzQGR5yUs2gOLrjiJlqDu/LAUxiDF974FMzBFwFCYQ0ixEoi7EGKDLmoAlWBygb64SguPOH/+fvPyPwRIBTWjwixkgj7R4oMuagCVYHKBho6igtP/KyBhgFCYQ0jxEoi7GGKDLmoApULVBtusMWuUB/ucYAvGsMjTspZNIcXXHETreFdeeApjOELb3wK5vCLfzDQyFFceKI22mCLXaE+2uMAXzRGR5yUs2iOLrjiJlqju/LAUxijF974FMzRFwFCYY0ixEoi7FGKDLmoAlWBygYaO4oLT9TGG2yxK9THexzgi8b4iJNyFs3xBVfcRGt8Vx54CmP8whufgjn+IkAorHGEWEmEPU6RIRdVoCpQ2UATR3Hhid9+/+P/wJ6kyJCLKlC5QLXJBlvsCvXJHgf4ojE54qScRXNywRU30ZrclQeewpi88ManYE6+CBAKaxIhVhLxt4GmjuLCE7XpBlvsCvXpHgf4ojE94qScRXN6wRU30ZrelQeewpi+8ManYE6/CBAKaxohVhJhT1NkyEUVqApUNtDMUVx44j+7VWP2xqdgzr4IEAprFiFWEmHPUmTIRRWoXKDabIMtdoX6bI8DfNGYHXFSzqI5u+CKm2jN7soDT2HMXvjXAs0dxYUnavMNttgV6vM9DvBFY37ESTmL5vyCK26iNb8rDzyFMX/hjU/BnH8RIBTWPEKsJMKep8iQiypQFahsoIWjuPBEbbHBFrtCfbHHAb5oLI44KWfRXFxwxU20FnflgacwFi+88SmYiy8ChMJaRIiVRNiLFBlyUQWqApUNtHQUF56oLTfYYleoL/c4wBeN5REn5SyaywuuuInW8q488BTG8oU3PgVz+UWAUFjLCLGSCHuZIkMuqkBVoLKBVo7iwhO11QZb7Ar11R4H+KKxOuKknEVzdcEVN9Fa3ZUHnsJYvfDGp2CuvggQCmsVIVYSYa9SZMhFFagKVDbQ2lFceKK23mCLXaG+3uMAXzTWR5yUs2iuL7jiJlrru/LAUxjrF974FMz1FwFCYa0jxEoi7HWKDLmoAlWBygX6C6iDom+MN2WfAAAAAElFTkSuQmCC", "base64");
const X_AVATAR = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAc0lEQVR42mN49voDTRHDoLNAo+IOlS0AmogfkW8BQaOJsYaBKqbjsYOBWqbjsoOBiqZjtYOBuqZj2sFAddPR7KCjBVQ0HdmOUQsGjQVUNx1ux2gcjCgLhn5hR4/6gB41Gj3qZHq0KujRLqJHy45ObVMKEQBw3foxsDUEEwAAAABJRU5ErkJggg==", "base64");

// what each capture opens: the chip's kind, then the steps to its state
const PLAN = [
  { kind: "threat", shots: [["threat-overview"], ["threat-timeline", "timeline", "[data-record-steps]"], ["threat-device", "device", "[data-record-tiles]"], ["threat-notes", "notes", "[data-record-note]"]] },
  { kind: "device", shots: [["backup-overview"], ["backup-points", "points", "[data-record-list] li"], ["backup-volumes", "volumes", "[data-record-volume]"]] },
  { kind: "page", shots: [["page-page"], ["page-revisions", "revisions", "[data-record-steps]"], ["page-attachments", "attachments", "[data-record-attachment]"]] },
  { kind: "message", shots: [["conversation-conversation"], ["conversation-delivered", null, null, '[data-record-sms][data-record-sms-state="delivered"] >> nth=1'], ["conversation-compose", null, null, "[data-record-sms-new]"], ["conversation-log", "log", "[data-record-grid] tbody tr"], ["conversation-calls", "calls", "[data-record-call]"], ["conversation-number", "number", "[data-record-number]"]] },
  { kind: "post", shots: [["post-post"], ["post-replies", "replies", "[data-x-reply]"], ["post-stats", "stats", "[data-x-hourly]"]] },
  { kind: "folder", shots: [["folder-icons"], ["folder-list", null, null, '[data-finder-view="list"]'], ["folder-columns", null, null, '[data-finder-view="columns"]']] },
];
const READY = { threat: "[data-record-threat-verdict]", device: "[data-record-tiles]", page: "[data-record-page]", message: "[data-record-sms-thread]", post: "[data-x-post]", folder: "[data-finder-icons]" };

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/record-window-plugins.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const shots = [];
  for (const lang of langs) {
    for (const { id, label } of skins) {
      const context = await browser.newContext({ viewport: { width: 1320, height: 940 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      await page.route("https://marks.example/*", (route) => route.fulfill({ contentType: "image/svg+xml", body: MARKS[new URL(route.request().url()).pathname.slice(1).replace(/\.svg$/, "")] ?? MARKS.files }));
      await page.route("https://pbs.twimg.com/**", (route) => route.fulfill({ contentType: "image/png", body: route.request().url().includes("/media/") ? X_MEDIA : X_AVATAR }));
      page.on("pageerror", (error) => console.error("page error:", String(error).slice(0, 400)));
      const shot = async (name) => {
        const path = join(outDir, `${name}-${label}-${lang}.png`);
        await page.waitForTimeout(300);
        await page.locator(WINDOW).first().screenshot({ path, animations: "disabled" });
        shots.push({ name, label, lang, path });
        console.log(path);
      };
      const open = async (kind, query = {}) => {
        await page.goto(`${base}?${new URLSearchParams({ skin: id, lang, ...query })}`);
        await page.waitForSelector(`[data-gallery-chat] [data-record-link="${kind}"]`, { timeout: 60_000 });
        await page.locator(`[data-record-link="${kind}"]`).first().click();
        await page.waitForSelector(`${WINDOW}[data-record-state="card"]`, { timeout: 15_000 });
      };
      for (const { kind, shots: list } of PLAN) {
        await open(kind);
        await page.waitForSelector(READY[kind], { timeout: 15_000 });
        for (const [name, tab, ready, click] of list) {
          if (tab) {
            await page.locator(`[data-record-tab="${tab}"]`).click();
            if (ready) await page.waitForSelector(ready, { timeout: 30_000 }).catch(async (error) => {
              await page.screenshot({ path: join(outDir, `failed-${name}-${label}-${lang}.png`) });
              throw error;
            });
          }
          if (click) await page.locator(click).first().click();
          await shot(name);
        }
      }
      // a console that serves the threat's card only: the frame's own view of the card, nothing more
      await open("threat", { console: "card" });
      await page.waitForSelector(`${WINDOW} [data-record-pane="left"]`, { timeout: 15_000 });
      await shot("threat-card-only");
      await context.close();
    }
  }
  if (mockupDir) {
    const context = await browser.newContext({ viewport: { width: 2700, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    for (const { name, label, lang, path } of shots) {
      const mock = join(mockupDir, `${name}.png`);
      if (!existsSync(mock)) continue;
      const data = async (file) => `data:image/png;base64,${(await readFile(file)).toString("base64")}`;
      await page.setContent(`<!doctype html><body style="margin:0;background:#111;display:flex;gap:24px;padding:24px;align-items:flex-start;font:14px system-ui;color:#ddd">
        <figure style="margin:0;width:1300px"><figcaption style="margin-bottom:8px">Maquette</figcaption><img style="width:1300px" src="${await data(mock)}"></figure>
        <figure style="margin:0;width:1300px"><figcaption style="margin-bottom:8px">Sagax (${label}, ${lang})</figcaption><img style="width:1300px" src="${await data(path)}"></figure></body>`);
      const side = join(outDir, `side-${name}-${label}-${lang}.png`);
      await page.screenshot({ path: side, fullPage: true });
      console.log(side);
    }
    await context.close();
  }
} catch (error) {
  console.error(String(error?.stack ?? error));
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
