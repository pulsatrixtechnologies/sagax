// Electron side of scripts/verify/dev/verify-org-computer.ts: signs in to the local
// organization server through its web sign-in, opens a bot, and checks the
// Computer tab (live server environment desktop, Take control opening the
// large window, Release control, close, usage behind Details), the bot's
// Works on under the screen (and gone from More > Access) and the composer's
// place menu. Screenshots go to
// VERIFY_SHOTS.
import { app, BrowserWindow } from "electron";
import { writeFileSync } from "node:fs";
import path from "node:path";

const origin = process.env.VERIFY_ORIGIN;
const shots = process.env.VERIFY_SHOTS;
const log = (line) => console.log(`[org-computer] ${line}`);
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push(ok);
  log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(what, predicate, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await predicate().catch(() => null);
    if (value) return value;
    await wait(200);
  }
  throw new Error(`timed out waiting for ${what}`);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1360, height: 900, webPreferences: { contextIsolation: true, sandbox: true } });
  win.webContents.on("console-message", (details) => {
    if (details.level === "error") log(`page error: ${String(details.message).slice(0, 200)}`);
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => {
    const image = await win.webContents.capturePage();
    writeFileSync(path.join(shots, name), image.toPNG());
    log(`screenshot ${name}`);
  };
  /** Click the first element matching a selector whose text or label matches. */
  const click = (selector, text) => js(`(() => {
    const re = new RegExp(${JSON.stringify(text)});
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => re.test(node.getAttribute("aria-label") ?? "") || re.test(node.textContent ?? ""));
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    el.click();
    return true;
  })()`);
  const text = () => js("document.body.innerText");

  try {
    // Web sign-in with the fake Perspicax: start, authorize, callback, home.
    await win.loadURL(`${origin}/auth/oidc/start`);
    await until("the session", async () => (await js("fetch('/api/auth/session').then(r => r.json())"))?.identity === "perspicax");
    if (new URL(win.webContents.getURL()).pathname !== "/") await win.loadURL(`${origin}/`);
    await js(`localStorage.setItem("omb-language", "en")`);
    // A bot of Ada's, on Auto.
    const bot = await js(`fetch("/api/bots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Luna" }) }).then(r => r.json()).then(b => b.bot)`);
    check("created a bot", Boolean(bot?.id));
    await win.loadURL(`${origin}/`);
    await until("the app", async () => (await js(`(document.getElementById("root")?.childElementCount ?? 0) > 0`)));
    await wait(2500);
    // Skip the welcome tour.
    await click("button", "^Skip tour$");
    await wait(800);
    await shot("1-home.png");

    // The composer's place menu lists the choices again (#54 left only
    // "Follow this bot's setting"), Cloud being the server environment.
    check("the composer chip says Auto (Cloud)", await click("button", "^Where this conversation works: Auto \\(Cloud\\)$"));
    await wait(600);
    const menu = await js(`[...document.querySelectorAll('[role=menu] [role=menuitemradio]')].map((item) => item.innerText.split("\\n")[0])`);
    check("the place menu lists Cloud (server environment) and Local VM", menu.includes("Cloud (server environment)") && menu.includes("Local VM"), menu.join(", "));
    await shot("2-place-menu.png");
    await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
    await wait(400);

    // The Computer tab: no selector, the server environment, its desktop.
    const computerOf = () => js(`fetch("/api/bots").then(r => r.json()).then(b => JSON.stringify(b.bots.find(x => x.name === "Luna")?.computer ?? "auto"))`);
    log(`Luna's Works on before the panel: ${await computerOf()}`);
    check("opened Luna's panel", await click("button", "^Open Luna's profile$"));
    await wait(1000);
    await click("button", "^Skip tour$");
    await wait(500);
    log(`Luna's Works on after the panel: ${await computerOf()}`);
    check("opened the Computer tab", await click("button,[role=tab]", "^Computer$"));
    await until("the server environment screen", () => js(`Boolean(document.querySelector('[data-computer-source="server"]'))`));
    const tab = await text();
    check("the tab shows the screen only: no works-on line, no description", !tab.includes("Luna works on:") && !tab.includes("Your own isolated Linux machine on the organization server"));
    check("the usage is folded behind Details", !(await js(`Boolean(document.querySelector('dl[aria-label="Usage"]'))`)) && await js(`document.querySelector('[data-usage-toggle]')?.getAttribute("aria-expanded") === "false"`));
    const power = await until("the environment's state", () => js(`(() => { const state = document.querySelector('[data-computer-screen]')?.dataset.computerScreen; return state === "off" || state === "running" ? state : null; })()`));
    if (power === "off") {
      await shot("3a-computer-off.png");
      check("pressed Play", await js(`(() => { const b = document.querySelector('[aria-label="Screen controls"] button:not([disabled])'); b?.click(); return Boolean(b); })()`));
    }
    await until("the live desktop", () => js(`Boolean(document.querySelector('[data-sandbox-desktop="connected"]'))`), 120_000);
    await wait(3000);
    await shot("3-computer-view-only.png");
    check("view-only with Take control in the middle", await js(`Boolean(document.querySelector('[data-take-control]')) && document.querySelector('[data-sandbox-desktop]').dataset.control === "0"`));
    check("no Running chip over the live screen", !(await js(`Boolean(document.querySelector('[data-computer-screen="running"] [data-power]'))`)));
    check("the controls wait for hover intent", await js(`document.querySelector('[data-controls]')?.dataset.controls === "hidden"`));
    // Details shows the usage, which follows the start at once.
    await js(`document.querySelector('[data-usage-toggle]').click()`);
    const usage = await until("usage figures", async () => {
      const value = await js(`document.querySelector('dl[aria-label="Usage"]')?.innerText ?? ""`);
      return /%/.test(value) && !/\?/.test(value) ? value : null;
    }, 40_000).catch(() => js(`document.querySelector('dl[aria-label="Usage"]')?.innerText ?? ""`));
    check("Details shows CPU, memory, disk and system (no ?)", /%/.test(usage) && !/\?/.test(usage), usage.replace(/\n/g, " "));
    await shot("3b-computer-details.png");
    await js(`document.querySelector('[data-usage-toggle]').click()`);

    // Take control opens the large window; the square stays view-only.
    await js(`document.querySelector('[data-take-control]').click()`);
    await until("control in the large window", () => js(`document.querySelector('[data-sandbox-takeover] [data-sandbox-desktop]')?.dataset.control === "1" && Boolean(document.querySelector('[data-sandbox-takeover] [data-sandbox-desktop="connected"]'))`), 40_000);
    await wait(2500);
    const box = await js(`(() => { const r = document.querySelector('[data-sandbox-takeover] [role=dialog]').getBoundingClientRect(); return { w: r.width / innerWidth, h: r.height / innerHeight }; })()`);
    check("the window is large (about 92% by 88%)", box.w > 0.9 && box.h > 0.85, JSON.stringify(box));
    check("the square does not stream a second view", await js(`Boolean(document.querySelector('[data-sandbox-takeover-open]'))`));
    check("the header has Release control, Play / Pause / Stop, full screen and close",
      await js(`(() => { const d = document.querySelector('[data-sandbox-takeover]'); return Boolean(d.querySelector('[data-takeover-control="release"]') && d.querySelector('[aria-label="Pause"]') && d.querySelector('[aria-label="Stop"]') && d.querySelector('[aria-label="Full screen"]') && d.querySelector('[data-takeover-close]')); })()`));
    await shot("4-computer-in-control.png");
    await js(`document.querySelector('[data-takeover-control="release"]').click()`);
    await until("view-only in the window", () => js(`document.querySelector('[data-sandbox-takeover] [data-sandbox-desktop]')?.dataset.control === "0"`));
    check("released control in the window", true);
    await js(`document.querySelector('[data-takeover-control="take"]').click()`);
    await until("control again", () => js(`document.querySelector('[data-sandbox-takeover] [data-sandbox-desktop]')?.dataset.control === "1"`));
    // Cmd/Ctrl+Shift+Escape closes the window (and releases control).
    await js(`document.querySelector('[data-sandbox-takeover] canvas')?.focus()`);
    await js(`(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", shiftKey: true, ctrlKey: true, bubbles: true }))`);
    await until("the window closed", () => js(`!document.querySelector('[data-sandbox-takeover]')`));
    await until("the square live again, view-only", () => js(`document.querySelector('[data-sandbox-desktop]')?.dataset.control === "0" && Boolean(document.querySelector('[data-sandbox-desktop="connected"]'))`), 40_000);
    check("closing the window released control", true);

    // Works on: its own item of More (Computer, between Access and Model),
    // not under the screen and not in More > Access.
    check("the Computer tab shows only the screen", !(await js(`Boolean(document.querySelector('[data-works-on-setting]'))`)));
    check("opened More", await click("button,[role=tab]", "^More$"));
    await wait(600);
    const order = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('[data-bot-settings-section]')].map((b) => b.dataset.botSettingsSection))`));
    check("More lists Computer between Access and Model", order.indexOf("worksOn") === order.indexOf("access") + 1 && order.indexOf("model") === order.indexOf("worksOn") + 1, order.join(", "));
    await js(`document.querySelector('[data-bot-settings-section="worksOn"]').click()`);
    await until("the Works on item", () => js(`Boolean(document.querySelector('[data-works-on-setting]'))`));
    const workson = await js(`document.querySelector('[data-works-on-setting]')?.innerText ?? ""`);
    check("Works on has short labels and a one-line hint", ["Auto", "Cloud", "Local VM", "This computer", "Browser", "Off"].every((label) => workson.includes(label)), workson.replace(/\n/g, " | "));
    const chosen = await js(`JSON.stringify({ checked: document.querySelector('[data-works-on-choice][aria-checked="true"]')?.dataset.worksOnChoice, saved: document.querySelector("[data-works-on-setting]")?.dataset.worksOnSetting })`);
    log(`Luna's Works on now: ${await computerOf()}`);
    check("Works on marks Auto, the bot's setting", JSON.parse(chosen).checked === "auto", chosen);
    await shot("5-works-on.png");
    check("More > Access has no Works on", !(await js(`Boolean(document.querySelector('[data-works-on-org]'))`)));
  } catch (error) {
    log(`error: ${error instanceof Error ? error.stack : String(error)}`);
    await shot("error.png").catch(() => {});
    checks.push(false);
  }
  const failed = checks.filter((ok) => !ok).length;
  log(failed ? `${failed} check(s) failed` : "all checks passed");
  app.exit(failed ? 1 : 0);
});
