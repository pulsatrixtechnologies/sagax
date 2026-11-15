#!/usr/bin/env node
/**
 * Every capture of the README (docs/readme/), in one command, from the real
 * renderer on an invented fixture: the full app on the README fixture
 * (scripts/readme-shots-fixture.ts: fake engines, a disposable home, invented
 * person, bots and messages, never ~/.sagax), a few gallery pages (src/gallery)
 * for surfaces the fixture cannot reach without a key or an account, short
 * animated captures for what moves, and the iPhone (portrait) and iPad
 * (landscape) captures from the simulators, paired with the same fixture.
 *
 * One appearance everywhere (README_SETUP): Studio theme, dark, its first
 * colour, the bot's colour as accent, tool calls off, a comfortable sidebar
 * with people apart and no suggestions, All history, permissions, sidebar
 * logo or routines badge, HD mascots off; the bots wear the owl and the
 * shapes. Desktop shots are 1440x900 at 2x; clips are frames of the same
 * page, written as animated WebP.
 *
 * Headless Chromium only: no window opens. The simulators run headless too
 * (simctl), each one created for this run and deleted after it.
 *
 * Usage: node scripts/capture/readme-shots.mjs [--out DIR] [--only a,b,c]
 *          [--skip a,b] [--fixture-log FILE] [--gallery-port N] [--no-ios]
 *   --only / --skip: shot names (SHOTS below).
 *   --fixture-log: reuse a fixture already running (the JSON line it printed).
 *   --no-ios: the desktop captures only (no simulator, no Xcode build).
 *   SAGAX_README_UI_PORT=<port> pins the fixture's UI to one port, and
 *   SAGAX_VERIFY_PORT_FROM=<port> its server to a block of 20 ports.
 *   SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser.
 * Then: scripts/optimize-readme-shots.sh squeezes the PNGs. `pnpm readme:shots`
 * runs both; `pnpm check:readme` fails when the README cites a missing file.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "readme"));
const only = arg("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
const skip = new Set(arg("--skip")?.split(",").map((s) => s.trim()).filter(Boolean) ?? []);
const withIos = !process.argv.includes("--no-ios") && process.platform === "darwin";
const galleryPort = Number(arg("--gallery-port") ?? 5198);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
// the installed Chrome, headless (WebGL mascots draw in it); SAGAX_VERIFY_BROWSER_CHROME names another
const launchOptions = { headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : { channel: "chrome" }) };

/** The owner's appearance for the README (issue #4358), as each setting stores it. */
const README_SETUP = Object.freeze({
  "omb-skin": "midnight", // Studio, dark
  "sagax-skin": "midnight",
  "omb-skin-mode": "dark",
  "sagax.botAccent.v1": "1",
  "openmausbot.sidebarDensity": "comfortable",
  "sagax.sidebarPeopleApart.v1": "on",
  "sagax.showSuggestions.v1": "0",
  "sagax.showAllHistory.v1": "0",
  "sagax.showPermissions.v1": "0",
  "sagax-show-sidebar-logo": "0",
  "sagax-show-routines-badge": "0",
  "sagax.hdMascots.v1": "off",
});
/** Studio's own colour (the first swatch): no tint over the skin. */
const README_CLEARED = ["omb-skin-tint", "omb-skin-depth", "omb-skin-texture"];

/**
 * Every capture, in the order it is taken. `late`: a surface other changes
 * are still moving (providers, the routine page); taken last so a rebase
 * right before them is enough. The approval clip answers the card the other
 * shots show, so it runs at the very end.
 */
const SHOTS = [
  { name: "chat", kind: "app" },
  { name: "bot-page", kind: "app" },
  { name: "group", kind: "app" },
  { name: "automations", kind: "app" },
  { name: "memory", kind: "app" },
  { name: "connect-apps", kind: "app" },
  { name: "computer", kind: "app" },
  { name: "voice", kind: "app" },
  { name: "page", kind: "gallery" },
  { name: "library", kind: "gallery" },
  { name: "vault-card", kind: "gallery" },
  { name: "purchase-card", kind: "gallery" },
  { name: "ios-iphone-home", kind: "ios" },
  { name: "ios-iphone-chat", kind: "ios" },
  { name: "ios-ipad-chat", kind: "ios" },
  { name: "ios-ipad-panel", kind: "ios" },
  { name: "send-message", kind: "clip" },
  { name: "model-menu", kind: "clip" },
  { name: "mascot", kind: "clip" },
  { name: "providers", kind: "app", late: true },
  { name: "routine-run", kind: "clip", late: true },
  { name: "card-answer", kind: "clip", late: true },
];
const wants = (name) => (!only || only.includes(name)) && !skip.has(name);

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await sleep(500);
  }
  throw new Error(`no server at ${url}`);
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function stopPid(pid, ms = 30_000) {
  if (!pid || !alive(pid)) return;
  try { process.kill(pid, "SIGTERM"); } catch { return; }
  for (const start = Date.now(); Date.now() - start < ms && alive(pid);) await sleep(250);
  if (alive(pid)) try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
}

/** The fixture: started here, or one already running (--fixture-log). */
async function fixtureInfo() {
  const logPath = arg("--fixture-log");
  if (logPath) {
    const line = (await readFile(logPath, "utf8")).match(/\{"appUrl".*\}/);
    if (!line) throw new Error(`no fixture JSON in ${logPath}`);
    return { info: JSON.parse(line[0]), stop: async () => {} };
  }
  const child = spawn(process.execPath, ["--experimental-strip-types", join(root, "scripts", "readme-shots-fixture.ts")], { cwd: root, env: { ...process.env, TZ: "UTC" }, stdio: ["ignore", "pipe", "pipe"] });
  let buffer = "";
  const info = await new Promise((resolveInfo, reject) => {
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const line = buffer.match(/\{"appUrl".*\}/);
      if (line) resolveInfo(JSON.parse(line[0]));
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("exit", (code) => reject(new Error(`fixture exited (${code}) before it was ready`)));
  });
  // the fixture closes its server on SIGTERM; the server is stopped by its
  // own pid too, so a fixture that dies first never leaves it running
  return { info, stop: async () => { await stopPid(child.pid); await stopPid(info.serverPid); } };
}

/** A browser context in the README's appearance. */
async function readmeContext(browser, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark", locale: "en-US", timezoneId: "UTC", ...options });
  await context.addInitScript(({ setup, cleared }) => {
    for (const [key, value] of Object.entries(setup)) localStorage.setItem(key, value);
    for (const key of cleared) localStorage.removeItem(key);
  }, { setup: README_SETUP, cleared: README_CLEARED });
  return context;
}

/** The app, loaded and ready, with the helpers every shot uses. */
async function openApp(context, info) {
  const page = await context.newPage();
  await page.goto(info.appUrl, { waitUntil: "load" });
  await page.waitForSelector("[data-sidebar-bot-row]", { timeout: 120_000 });
  await page.addStyleTag({ content: "[data-achievement-toaster]{display:none !important}" });
  const terms = page.locator("[data-terms-accept]");
  if (await terms.count()) { await terms.click(); await sleep(600); }
  const ui = {
    openBot: async (key) => { await page.click(`[data-sidebar-bot-row="${info.ids[key].id}"]`); await sleep(1200); },
    toLatest: async () => { const jump = page.getByRole("button", { name: "Jump to latest messages" }); if (await jump.count()) { await jump.first().click().catch(() => {}); await sleep(800); } },
    profileMenu: async (...items) => {
      await page.getByRole("button", { name: "Alex Morgan" }).click();
      for (const item of items) { await sleep(400); await page.getByRole("menuitem", { name: item, exact: true }).click(); }
      await sleep(1500);
    },
    settingsPage: async (title) => {
      await ui.profileMenu("Settings");
      await page.locator("[data-settings-nav-group] button, nav button").filter({ hasText: title }).first().click();
      await sleep(1500);
    },
    openPanel: async () => { await page.click("[data-bot-header-pill]"); await sleep(1500); },
  };
  return { page, ui };
}

/** The next fake engine turn (scripts/readme-shots-fixture.ts reads it). */
const writeScene = (info, scene) => writeFile(info.scenePath, JSON.stringify(scene));
/** A reply that streams after a short wait, so the working line shows. */
const streamedScene = (reply, waitMs = 2600) => ({ mode: "voice", env: { FAKE_CLAUDE_FIRST_TOKEN_MS: String(waitMs), FAKE_CLAUDE_TOKEN_MS: "55", FAKE_CLAUDE_VOICE_REPLY: reply } });

async function captureAppStill(browser, info, name) {
  const context = await readmeContext(browser);
  const { page, ui } = await openApp(context, info);
  try {
    switch (name) {
      case "chat": await ui.openBot("pixel"); await ui.toLatest(); break;
      case "bot-page": await ui.openBot("pixel"); await ui.openPanel(); await page.getByRole("button", { name: "Edit persona" }).click(); await sleep(1800); break;
      case "group": {
        await page.click(`[data-sidebar-group-row="${info.groupId}"]`); await sleep(1500);
        const notice = page.getByText("Group conversations use more");
        if (await notice.count()) { await notice.locator("xpath=..").getByRole("button").first().click().catch(() => {}); await sleep(400); }
        await ui.toLatest();
        break;
      }
      case "automations": {
        await ui.profileMenu("Tools", "Automations");
        // next week, from the morning: every routine of the fixture shows on the grid
        const next = page.getByRole("button", { name: "Next dates" });
        if (await next.count()) { await next.first().click(); await sleep(1200); }
        await page.evaluate(() => {
          const label = [...document.querySelectorAll("main *")].find((el) => el.childElementCount === 0 && el.textContent?.trim() === "8 AM");
          label?.scrollIntoView({ block: "start" });
        });
        await sleep(800);
        break;
      }
      case "memory": await ui.profileMenu("Tools", "Memory"); break;
      case "connect-apps": await ui.openBot("nova"); await page.click("[data-sidebar-connect-apps]"); await sleep(1800); break;
      case "computer": await ui.openBot("nova"); await ui.settingsPage("Computer"); break;
      case "voice": await ui.openBot("nova"); await ui.settingsPage("Voice"); break;
      case "providers": await ui.openBot("nova"); await ui.settingsPage("Providers"); break;
    }
    await page.screenshot({ path: join(outDir, `${name}.png`) });
    console.log(`shot ${name}`);
  } finally {
    await context.close();
  }
}

/**
 * A short animated capture: frames of one region of the page, taken while
 * `act` runs, then held. Identical frames merge, the last one lingers, and
 * img2webp (libwebp) writes a looping lossy WebP.
 */
async function captureClip(browser, info, name, { region, scale = 1, prepare, act, tailMs = 1500 }) {
  const context = await readmeContext(browser, { deviceScaleFactor: scale });
  const { page, ui } = await openApp(context, info);
  const frames = [];
  try {
    await prepare?.(page, ui);
    let filming = true;
    const filmed = (async () => {
      while (filming) {
        const at = Date.now();
        frames.push({ at, png: await page.screenshot({ clip: region }) });
        const spent = Date.now() - at;
        if (spent < 80) await sleep(80 - spent);
      }
    })();
    await sleep(500);
    await act(page, ui);
    await sleep(tailMs);
    filming = false;
    await filmed;
  } finally {
    await context.close();
  }
  const dir = await mkdtemp(join(tmpdir(), `readme-clip-${name}-`));
  try {
    const kept = [];
    for (const frame of frames) {
      const last = kept.at(-1);
      if (last && last.png.equals(frame.png)) continue;
      kept.push(frame);
    }
    const args = ["-loop", "0", "-lossy", "-q", "72", "-m", "6"];
    for (let i = 0; i < kept.length; i++) {
      const file = join(dir, `${String(i).padStart(4, "0")}.png`);
      await writeFile(file, kept[i].png);
      const next = kept[i + 1]?.at ?? kept[i].at + 2200; // the last frame stays a moment before the loop
      args.push("-d", String(Math.max(60, Math.min(2500, next - kept[i].at))), file);
    }
    const out = join(outDir, `${name}.webp`);
    const encoded = spawnSync("img2webp", [...args, "-o", out], { encoding: "utf8" });
    if (encoded.status !== 0) throw new Error(`img2webp ${name}: ${encoded.stderr}`);
    console.log(`clip ${name}.webp (${kept.length} frames)`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const CLIPS = {
  // a message sent, the working line, the reply streaming in
  "send-message": {
    region: { x: 280, y: 0, width: 1160, height: 900 },
    prepare: async (_page, ui) => { await ui.openBot("quill"); },
    act: async (page, _ui, info) => {
      await writeScene(info, streamedScene("Here is the draft for Friday: a faster signup, the new pricing page and three fixes. I kept it to five lines so it fits the email. Want me to post it in the Launch room?"));
      await page.locator("[data-composer] textarea, textarea").last().click();
      await page.keyboard.type("Draft the release notes for Friday from the merged pull requests.", { delay: 28 });
      await sleep(300);
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.body.innerText.includes("Want me to post it in the Launch room?"), null, { timeout: 60_000 });
      await sleep(800);
    },
    tailMs: 1800,
  },
  // the model menu: providers first, then that provider's models
  "model-menu": {
    region: { x: 880, y: 300, width: 560, height: 600 },
    scale: 2,
    prepare: async (_page, ui) => { await ui.openBot("nova"); },
    act: async (page) => {
      await page.getByRole("button", { name: /Claude Sonnet 5/ }).last().click();
      await sleep(1400);
      await page.getByText("Claude", { exact: true }).last().hover(); await sleep(400);
      await page.getByText("Claude", { exact: true }).last().click();
      await sleep(1800);
      await page.keyboard.press("Escape"); await sleep(300); await page.keyboard.press("Escape");
    },
    tailMs: 900,
  },
  // the bot's mascot while it works, then when it is done
  mascot: {
    region: { x: 1133, y: 50, width: 307, height: 140 },
    scale: 2,
    prepare: async (_page, ui) => { await ui.openBot("quill"); await ui.openPanel(); },
    act: async (page, _ui, info) => {
      await writeScene(info, streamedScene("Done: the guide now opens with the three steps people ask about most.", 3200));
      await page.locator("[data-composer] textarea, textarea").last().click();
      await page.keyboard.type("Put the three most asked questions at the top of the guide.");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.body.innerText.includes("the three steps people ask about most"), null, { timeout: 60_000 });
    },
    tailMs: 2200,
  },
  // a routine run from its page, and the run it leaves
  "routine-run": {
    region: { x: 840, y: 0, width: 600, height: 900 },
    prepare: async (page, ui) => { await ui.openBot("ledger"); await ui.openPanel(); await page.getByText("Invoice reminders").first().click(); await sleep(1500); },
    act: async (page, _ui, info) => {
      await writeScene(info, streamedScene("Three invoices are unpaid, for $4,820 in all. I drafted a short, friendly reminder for each one; they wait for you in the Library.", 2400));
      await page.getByRole("button", { name: /^Run now/ }).first().click();
      await page.waitForFunction(() => document.body.innerText.includes("they wait for you in the Library."), null, { timeout: 60_000 });
      await sleep(1500);
    },
    tailMs: 1500,
  },
  // the pinned approval card, answered
  "card-answer": {
    region: { x: 280, y: 420, width: 1160, height: 480 },
    prepare: async (_page, ui) => { await ui.openBot("pixel"); await ui.toLatest(); },
    act: async (page) => {
      await page.getByRole("button", { name: "Allow once" }).first().hover(); await sleep(700);
      await page.getByRole("button", { name: "Allow once" }).first().click();
      await sleep(2500);
    },
    tailMs: 1200,
  },
};

async function captureApp(chromium, info, names) {
  const browser = await chromium.launch(launchOptions);
  try {
    {
      // first visit: Vite optimizes dependencies and reloads the page; a throwaway load keeps the first shot from being blank
      const warm = await browser.newPage();
      await warm.goto(info.appUrl, { waitUntil: "load" });
      await warm.waitForSelector("[data-sidebar-bot-row]", { timeout: 120_000 }); await sleep(3000);
      await warm.waitForSelector("[data-sidebar-bot-row]", { timeout: 120_000 });
      await warm.close();
    }
    for (const name of names) {
      const shot = SHOTS.find((s) => s.name === name);
      if (shot.kind === "app") await captureAppStill(browser, info, name);
      else {
        const clip = CLIPS[name];
        await captureClip(browser, info, name, { ...clip, act: (page, ui) => clip.act(page, ui, info) });
      }
    }
  } finally {
    await browser.close();
  }
}

async function captureGallery(chromium, names) {
  const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(galleryPort), "--strictPort"], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
  });
  let log = "";
  vite.stdout?.on("data", (chunk) => { log += chunk; });
  vite.stderr?.on("data", (chunk) => { log += chunk; });
  const base = `http://127.0.0.1:${galleryPort}/src/gallery`;
  let browser;
  try {
    await waitForServer(`${base}/vault-card.html`);
    browser = await chromium.launch(launchOptions);
    // the galleries' fixtures are partly French; the README reads English,
    // so the few words on a card are swapped before the shot
    const WORDS = [
      ["Osprey", "Nova"], ["Portail Exemple", "Example portal"], ["Exemple travail", "Example work"], ["Exemple admin", "Example admin"], ["Travail", "Work"], ["Perso", "Personal"],
      ["Boutique Exemple", "Example Store"], ["Câble USB-C", "USB-C cable"], ["Chargeur 65 W", "65 W charger"], ["Boutique Audio", "Audio Shop"],
      ["Casque sans fil, réduction de bruit", "Wireless headphones, noise cancelling"], ["Postes Canada", "Canada Post"], ["Retenu au dépôt, adresse à confirmer", "Held at the depot, address to confirm"],
      ["Rapport mensuel", "Monthly report"], ["Dispatch email preview in French", "Welcome email preview"],
    ];
    // swapped now and on every later render (a gallery may draw its card again)
    const english = (page) => page.evaluate((words) => {
      const swap = () => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) for (const [from, to] of words) if (node.nodeValue?.includes(from)) node.nodeValue = node.nodeValue.replaceAll(from, to);
      };
      swap();
      new MutationObserver(swap).observe(document.body, { subtree: true, childList: true, characterData: true });
    }, WORDS);
    const shoot = async (name, url, selector, viewport, ready, index = 0) => {
      if (!names.includes(name)) return;
      // a selector names the element to shoot; a region ({x, y, width, height}) a part of the page
      const context = await readmeContext(browser, { viewport });
      const page = await context.newPage();
      // the galleries draw fake data; nothing answers /api here
      await page.route("**/api/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not in this gallery" }) }));
      await page.goto(url, { waitUntil: "load" });
      await page.waitForSelector(ready ?? selector, { timeout: 60_000 });
      await sleep(1500);
      await english(page);
      await sleep(300);
      if (typeof selector === "object") await page.screenshot({ path: join(outDir, `${name}.png`), clip: selector, animations: "disabled" });
      else await page.locator(selector).nth(index).screenshot({ path: join(outDir, `${name}.png`), animations: "disabled" });
      console.log(`shot ${name}`);
      await context.close();
    };
    const skin = "skin=midnight&lang=en";
    await shoot("page", `${base}/page-viewer.html?${skin}`, "body", { width: 1440, height: 900 });
    await shoot("library", `${base}/library-tab.html?${skin}`, { x: 0, y: 0, width: 370, height: 790 }, { width: 1440, height: 900 }, "body");
    await shoot("vault-card", `${base}/vault-card.html?${skin}&state=pending`, "[data-gallery-card] > *", { width: 820, height: 900 }, "[data-gallery-card]");
    await shoot("purchase-card", `${base}/outbound-cards.html?${skin}&only=purchase`, "[data-outbound-card]", { width: 820, height: 1400 });
  } finally {
    await browser?.close();
    try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
    if (process.exitCode) console.error(log.slice(-2000));
  }
}

/**
 * The phone apps, paired with the same fixture: the iPhone in portrait
 * (ios/parity/capture.sh), the iPad in landscape (ios/parity/desktop/
 * capture-ipad.sh, whose UI test turns the device). Both reuse the parity
 * build (ios/parity/build) and their own simulators, deleted at the end.
 */
async function captureIos(info, names) {
  if (!info.phone) throw new Error("the fixture printed no paired phone session");
  const work = await mkdtemp(join(tmpdir(), "readme-ios-"));
  const session = join(work, "session.json");
  await writeFile(session, JSON.stringify(info.phone));
  const run = (script, args, env) => {
    const result = spawnSync("bash", [join(root, script), ...args], { cwd: root, stdio: "inherit", env: { ...process.env, PARITY_SESSION: session, PARITY_OUT: work, PARITY_WAIT: "12", ...env } });
    if (result.status !== 0) throw new Error(`${script} failed (${result.status})`);
  };
  const built = existsSync(join(root, "ios", "parity", "build", "Build", "Products", "Debug-iphonesimulator", "Sagax.app"));
  try {
    const iphone = [["ios-iphone-home", "01-home"], ["ios-iphone-chat", "02-chat"]].filter(([name]) => names.includes(name));
    // screens that draw the fixture as it is (chat-approval and chat-markdown add rows of their own)
    const ipad = [["ios-ipad-chat", "chat-top", "Pixel"], ["ios-ipad-panel", "panel-details", "Ledger"]].filter(([name]) => names.includes(name));
    // the iPad script builds for testing (its rotation is a UI test); the iPhone one then reuses that build
    for (const [name, screen, chat] of ipad) {
      run("ios/parity/desktop/capture-ipad.sh", [...(built || name !== ipad[0][0] ? ["--skip-build"] : []), "--viewport", "1366x1024", screen], { PARITY_SIM_PREFIX: "readme", PARITY_EXTRA_ARGS: `-paritySkin midnight -parityChat ${chat}` });
      const shot = readdirSync(work).find((file) => file.startsWith("ipad-1366x1024-") && file.endsWith(`-${screen}.png`));
      await copyFile(join(work, shot), join(outDir, `${name}.png`));
      console.log(`shot ${name}`);
    }
    if (iphone.length) {
      run("ios/parity/capture.sh", ["--skip-build", ...iphone.map(([, screen]) => screen)], { PARITY_DEVICE: "readme-iphone", PARITY_SKIN: "midnight", PARITY_EXTRA_ARGS: "-parityChat Pixel" });
      for (const [name, screen] of iphone) { await copyFile(join(work, `${screen}.png`), join(outDir, `${name}.png`)); console.log(`shot ${name}`); }
      // capture.sh keeps its simulator; this one was made for the README only
      const list = JSON.parse(spawnSync("xcrun", ["simctl", "list", "devices", "-j"], { encoding: "utf8" }).stdout);
      for (const device of Object.values(list.devices).flat()) {
        if (device.name !== "readme-iphone") continue;
        spawnSync("xcrun", ["simctl", "shutdown", device.udid]);
        spawnSync("xcrun", ["simctl", "delete", device.udid]);
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

await mkdir(outDir, { recursive: true });
const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
const selected = SHOTS.filter((shot) => wants(shot.name) && (shot.kind !== "ios" || withIos));
const galleryNames = selected.filter((s) => s.kind === "gallery").map((s) => s.name);
if (galleryNames.length) await captureGallery(chromium, galleryNames);
const fixtureNames = selected.filter((s) => s.kind !== "gallery");
if (fixtureNames.length) {
  const { info, stop } = await fixtureInfo();
  try {
    const appFirst = fixtureNames.filter((s) => s.kind === "app" && !s.late).map((s) => s.name);
    if (appFirst.length) await captureApp(chromium, info, appFirst);
    const ios = fixtureNames.filter((s) => s.kind === "ios").map((s) => s.name);
    if (ios.length) await captureIos(info, ios);
    const rest = fixtureNames.filter((s) => s.kind === "clip" || s.late).map((s) => s.name);
    if (rest.length) await captureApp(chromium, info, rest);
  } finally {
    await stop();
  }
}
