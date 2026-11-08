// Navigation smoothness, measured headless on the real app (#motion-polish,
// 2026-11-07): the verification server (fake engine) with a few bots and a
// long conversation, the real renderer in a headless Chromium, and the
// frequent journeys played by script: switch bots in the sidebar, open a
// thread, scroll a long chat, open and close Settings, open the bot panel
// and go through its tabs, open menus. During each journey the page records
// every animation frame (a frame over 25 ms counts as dropped), every long
// task over 50 ms (PerformanceObserver) and the cumulative layout shift.
//
//   node --experimental-strip-types scripts/capture/motion-perf.ts <out.json> [--scheme light|dark] [--rounds N] [--shots DIR] [--video DIR]
//
// Needs Playwright's Chromium (or SAGAX_CAPTURE_CHROME). No window opens.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium, type Page } from "playwright";

import { launchVerificationServer, runControlOmb } from "../control-omb.ts";
import { fixtureApi, mountPreview } from "../testing/preview-fixture.ts";

const args = process.argv.slice(2);
const flag = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args.splice(index, 2)[1] : undefined; };
const rounds = Number(flag("--rounds") ?? 3);
const shots = flag("--shots");
const video = flag("--video");
const only = flag("--only");
const scheme = (flag("--scheme") ?? "light") as "light" | "dark";
const turns = Number(flag("--turns") ?? 45);
const out = resolve(args[0] ?? "motion-perf.json");

interface Sample { frames: number; dropped: number; worstFrame: number; p95Frame: number; longTasks: number; longTaskMs: number; worstLongTask: number; cls: number }

const fixture = await launchVerificationServer();
// A run that fails midway still stops the fixture server it started.
process.once("exit", () => { try { fixture.child.kill("SIGTERM"); } catch { /* already gone */ } });
const url = fixture.info.url;
const api = fixtureApi(url, { headers: { origin: url } });
const cli = (...rest: string[]) => runControlOmb([...rest, "--url", url]) as Promise<any>;
const names = ["Pepper", "Basil", "Sage", "Thyme", "Clove", "Mint"];
const bots: Array<{ id: string; activeTaskId: string }> = [];
for (const name of names) bots.push((await cli("new-bot", "--name", name)).bot);
const say = async (botId: string, threadId: string, text: string) => {
  await api("POST", `/api/bots/${botId}/messages`, { threadId, text, singleStream: true });
  await cli("wait", "--bot", botId, "--task", threadId, "--timeout", "30");
};
const body = [
  "Here is where the quarter stands, ticket by ticket.",
  "",
  "| Client | Open | Closed |",
  "|---|---|---|",
  "| North | 4 | 12 |",
  "| South | 2 | 9 |",
  "",
  "- backups checked on every host",
  "- two warnings on the file server",
  "",
  "```bash\nrsync -a /srv/data /mnt/backup\n```",
].join("\n");
const long = bots[0]!;
for (let turn = 0; turn < turns; turn++) await say(long.id, long.activeTaskId, `turn ${turn}: ${body}`);
for (const bot of bots.slice(1)) for (let turn = 0; turn < 6; turn++) await say(bot.id, bot.activeTaskId, `hello ${turn}: ${body}`);
// a few threads on the first bot for the thread journey
for (let thread = 0; thread < 4; thread++) {
  const id = (await api("POST", `/api/bots/${long.id}/tasks`, { stream: true })).task.threadId as string;
  for (let turn = 0; turn < 6; turn++) await say(long.id, id, `thread ${thread} turn ${turn}: ${body}`);
}
const terms = await api("GET", "/api/me/terms");
if (terms?.current) await api("POST", "/api/me/terms", { version: terms.current });

const ui = await mountPreview(fixture, { entry: "/scripts/testing/threads-preview.tsx", route: "/__motion-perf.html", title: "Motion perf", logLevel: "error" });
const executablePath = process.env.SAGAX_CAPTURE_CHROME;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, ...(video ? { recordVideo: { dir: video, size: { width: 1440, height: 900 } } } : {}) });
const page = await context.newPage();
await page.addInitScript(() => {
  localStorage.setItem("omb-show-threads", "1");
  localStorage.setItem("omb-threads-location", "sidebar");
  localStorage.setItem("omb-language", "en");
  // Auto: the skin follows the emulated scheme (--scheme), light or dark.
  localStorage.setItem("omb-skin-mode", "auto");
});

const results: Record<string, Sample[]> = {};
const noted = new Set<string>();
const note = (what: string, value: number | string) => { if (!noted.has(what)) { noted.add(what); console.log(`${what}: ${value}`); } };
try {
  await page.goto(ui.previewUrl, { waitUntil: "load" });
  await page.waitForSelector("textarea", { timeout: 60_000 });
  await page.waitForTimeout(2_000);
  await dismissToasts(page);
  await installProbe(page);

  const journeys: Array<[string, () => Promise<void>]> = [
    ["switch-bot", async () => {
      for (const bot of [...bots.slice(1), bots[0]!]) {
        await page.locator(`[data-sidebar-bot-row="${bot.id}"]`).first().click();
        await page.waitForTimeout(450);
      }
    }],
    ["open-thread", async () => {
      await page.locator(`[data-sidebar-bot-row="${long.id}"]`).first().click();
      await page.waitForTimeout(400);
      const rows = page.locator("[data-sidebar-thread-row]");
      const count = Math.min(await rows.count(), 5);
      note("open-thread rows", count);
      for (let index = 0; index < count; index++) {
        await rows.nth(index).click({ timeout: 2_000 }).catch(() => {});
        await page.waitForTimeout(450);
      }
    }],
    ["scroll-chat", async () => {
      await page.locator(`[data-sidebar-bot-row="${long.id}"]`).first().click();
      await page.waitForTimeout(600);
      const log = page.locator('[role="log"]').first();
      const box = await log.boundingBox();
      if (box) await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height, 700) / 2);
      for (let step = 0; step < 30; step++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(16); }
      await page.waitForTimeout(250);
      for (let step = 0; step < 30; step++) { await page.mouse.wheel(0, 240); await page.waitForTimeout(16); }
      await page.waitForTimeout(250);
    }],
    ["settings", async () => {
      for (let time = 0; time < 2; time++) {
        await page.locator("[data-sidebar-account], [data-sidebar-account-pill]").first().click({ timeout: 2_000 }).catch((error) => note("account click", String(error).split("\n").slice(0, 6).join(" / ")));
        await page.waitForTimeout(300);
        note("account menu items", (await page.getByRole("menuitem").allInnerTexts()).join(" | "));
        await page.getByRole("menuitem", { name: "Settings", exact: true }).first().click({ timeout: 2_000 }).catch(() => {});
        await page.locator('[role="dialog"][aria-modal="true"]').first().waitFor({ timeout: 4_000 }).catch(() => {});
        await page.waitForTimeout(400);
        note("settings dialogs", await page.locator('[role="dialog"][aria-modal="true"]').count());
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
      }
    }],
    ["right-panel", async () => {
      const pill = page.locator("[data-chat-pill][aria-expanded]").first();
      note("right-panel pill", await pill.count());
      for (let time = 0; time < 2; time++) {
        await pill.click({ timeout: 2_000 }).catch(() => {});
        await page.waitForTimeout(500);
        await pill.click({ timeout: 2_000 }).catch(() => {});
        await page.waitForTimeout(500);
      }
    }],
    ["bot-profile-tabs", async () => {
      await page.locator(`[data-sidebar-bot-row="${long.id}"]`).first().click({ button: "right" });
      await page.waitForTimeout(300);
      await page.getByRole("menuitem", { name: "Edit bot" }).first().click({ timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(500);
      const tabs = page.locator("[data-bot-profile-tab]");
      const count = Math.min(await tabs.count(), 6);
      note("bot-profile tabs", count);
      for (let index = 0; index < count; index++) { await tabs.nth(index).click({ timeout: 2_000 }).catch(() => {}); await page.waitForTimeout(350); }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }],
    ["menus", async () => {
      const triggers = page.locator('[aria-haspopup="menu"]:visible');
      const count = Math.min(await triggers.count(), 5);
      note("menus triggers", count);
      for (let index = 0; index < count; index++) {
        await triggers.nth(index).click({ timeout: 2_000 }).catch(() => {});
        await page.waitForTimeout(300);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(250);
      }
    }],
  ];

  // Stills of the open surfaces, for the side by side review (--shots):
  // the bot panel on its second tab, Settings, the right panel.
  if (shots) {
    mkdirSync(shots, { recursive: true });
    const still = async (name: string, open: () => Promise<void>, close: () => Promise<void>) => {
      await open();
      await page.waitForTimeout(700);
      await page.screenshot({ path: resolve(shots, `open-${name}.png`) });
      await close();
      await page.waitForTimeout(400);
    };
    const escape = () => page.keyboard.press("Escape");
    await still("bot-profile", async () => {
      await page.locator(`[data-sidebar-bot-row="${long.id}"]`).first().click({ button: "right" });
      await page.waitForTimeout(300);
      await page.getByRole("menuitem", { name: "Edit bot" }).first().click({ timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(500);
      await page.locator("[data-bot-profile-tab]").nth(1).click({ timeout: 2_000 }).catch(() => {});
    }, escape);
    await still("settings", async () => {
      await page.locator("[data-sidebar-account], [data-sidebar-account-pill]").first().click({ timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(300);
      await page.getByRole("menuitem", { name: "Settings", exact: true }).first().click({ timeout: 2_000 }).catch(() => {});
    }, escape);
    const pill = page.locator("[data-chat-pill][aria-expanded]").first();
    await still("right-panel", () => pill.click({ timeout: 2_000 }).catch(() => {}), () => pill.click({ timeout: 2_000 }).catch(() => {}));
  }

  for (let round = 0; round < rounds; round++) {
    for (const [name, run] of journeys) {
      if (only && !only.split(",").includes(name)) continue;
      await page.waitForTimeout(300);
      await page.evaluate(() => (window as any).__perf.start());
      await run();
      const sample = await page.evaluate(() => (window as any).__perf.stop()) as Sample;
      (results[name] ??= []).push(sample);
      if (shots && round === 0) {
        mkdirSync(shots, { recursive: true });
        await page.screenshot({ path: resolve(shots, `${name}.png`) });
      }
    }
  }
  const summary = Object.fromEntries(Object.entries(results).map(([name, samples]) => [name, median(samples)]));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), rounds, summary, samples: results }, null, 2));
  console.table(summary);
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  await ui.close().catch(() => {});
  await fixture.close().catch(() => {});
}

function median(samples: Sample[]): Sample {
  const pick = (key: keyof Sample) => {
    const sorted = samples.map((sample) => sample[key]).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  };
  return { frames: pick("frames"), dropped: pick("dropped"), worstFrame: pick("worstFrame"), p95Frame: pick("p95Frame"), longTasks: pick("longTasks"), longTaskMs: pick("longTaskMs"), worstLongTask: pick("worstLongTask"), cls: pick("cls") };
}

async function dismissToasts(target: Page) {
  for (let tries = 0; tries < 6; tries++) {
    const closed = await target.evaluate(() => {
      const close = document.querySelector<HTMLButtonElement>(".achievement-toast-close");
      close?.click();
      return Boolean(close);
    });
    if (!closed) break;
    await target.waitForTimeout(300);
  }
}

async function installProbe(target: Page) {
  await target.evaluate(() => {
    const state = { on: false, frames: [] as number[], long: [] as number[], cls: 0, last: 0 };
    new PerformanceObserver((list) => { if (state.on) for (const entry of list.getEntries()) state.long.push(entry.duration); }).observe({ type: "longtask" });
    new PerformanceObserver((list) => {
      if (!state.on) return;
      for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) if (!entry.hadRecentInput) state.cls += entry.value;
    }).observe({ type: "layout-shift" });
    const tick = (now: number) => {
      if (state.on && state.last) state.frames.push(now - state.last);
      state.last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    (window as any).__perf = {
      start() { state.on = true; state.frames = []; state.long = []; state.cls = 0; },
      stop() {
        state.on = false;
        const frames = state.frames.slice().sort((a, b) => a - b);
        const round = (value: number) => Math.round(value * 10) / 10;
        return {
          frames: frames.length,
          dropped: frames.filter((frame) => frame > 25).length,
          worstFrame: round(frames.at(-1) ?? 0),
          p95Frame: round(frames[Math.floor(frames.length * 0.95)] ?? 0),
          longTasks: state.long.length,
          longTaskMs: Math.round(state.long.reduce((sum, value) => sum + value, 0)),
          worstLongTask: Math.round(Math.max(0, ...state.long)),
          cls: Math.round(state.cls * 1000) / 1000,
        };
      },
    };
  });
}
