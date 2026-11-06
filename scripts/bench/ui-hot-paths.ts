#!/usr/bin/env -S node --experimental-strip-types
// Desktop UI hot-path bench (Refs #1971): headless Chromium + fake engine.
// Measures cold start to first chat paint, bot switch, Settings open and each
// Settings page, bot panel open, and scroll of a 2000-message chat.
//
//   pnpm bench:ui-hot-paths [--rounds N] [--out file.json] [--port N] [--keep]
//   pnpm bench:ui-hot-paths --quick   # one round
//
// Serves the production UI from dist/ (runs `pnpm exec vite build` when
// missing). Never binds 5173. Stops every process it starts. No visible window.
import { DatabaseSync } from "node:sqlite";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

import {
  launchVerificationServer,
  verificationServerArgs,
  verificationServerEnvironment,
  type VerificationServer,
} from "../control-omb.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { freePortBlock } from "../../server/testing/ports.ts";
import { ensureUiBrowser } from "../testing/control-omb-ui.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FORBIDDEN_PORT = 5173;
const SCROLL_MESSAGES = 2000;
const DIST = join(ROOT, "dist");

type Stats = { p50: number; p95: number; min: number; max: number; n: number };
type Sample = Record<string, number | boolean | string | null | undefined>;

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return Number(sorted[rank]!.toFixed(1));
}

function statsOf(values: number[]): Stats {
  if (!values.length) return { p50: 0, p95: 0, min: 0, max: 0, n: 0 };
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    min: Number(Math.min(...values).toFixed(1)),
    max: Number(Math.max(...values).toFixed(1)),
    n: values.length,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCli(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      rounds: { type: "string", default: "3" },
      out: { type: "string" },
      port: { type: "string" },
      keep: { type: "boolean", default: false },
      quick: { type: "boolean", default: false },
      rebuild: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  // --quick means one round unless --rounds is also given explicitly.
  const roundsFlag = process.argv.slice(2).includes("--rounds");
  const rounds = Math.max(1, Number(roundsFlag ? values.rounds : (values.quick ? "1" : (values.rounds ?? "3"))));
  const port = values.port ? Number(values.port) : 0;
  if (port === FORBIDDEN_PORT) throw new Error(`port ${FORBIDDEN_PORT} is forbidden for this bench`);
  return {
    rounds,
    out: values.out ? join(process.cwd(), values.out) : join(tmpdir(), `sagax-ui-hot-paths-${Date.now()}.json`),
    port,
    keep: Boolean(values.keep),
    rebuild: Boolean(values.rebuild),
  };
}

/** Relaunch the fake-engine server on an existing dataDir with production UI.
 * Used after offline SQLite seed so the store cache starts empty and sees the rows. */
async function relaunchWithStatic(
  dataDir: string,
  parentEnv: NodeJS.ProcessEnv,
  staticDir: string,
): Promise<{ url: string; child: ChildProcess; close: () => Promise<void> }> {
  const port = await freePortBlock([0, 1]);
  if (port === FORBIDDEN_PORT) throw new Error(`relaunch picked forbidden port ${FORBIDDEN_PORT}`);
  const url = `http://127.0.0.1:${port}`;
  const logPath = join(dataDir, `ui-hot-relaunch-${Date.now()}.log`);
  const log = openSync(logPath, "a", 0o600);
  const childEnv = verificationServerEnvironment(
    { ...parentEnv, SAGAX_CONTENT_ENCRYPTION: "0", FAKE_CLAUDE_MODE: parentEnv.FAKE_CLAUDE_MODE || "happy" },
    dataDir,
    port,
  );
  childEnv.SAGAX_STATIC_DIR = staticDir;
  const child = spawn(process.execPath, verificationServerArgs(childEnv), {
    cwd: ROOT,
    env: childEnv,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`relaunch exited early; see ${logPath}`);
    try {
      const response = await fetch(`${url}/api/health`, { headers: { origin: url } });
      if (response.ok) {
        const body = await response.json() as { app?: string };
        if (body.app === "openmausbot") break;
      }
    } catch { /* not ready */ }
    if (Date.now() >= deadline) throw new Error(`relaunch not ready; see ${logPath}`);
    await sleep(150);
  }
  let closed = false;
  return {
    url,
    child,
    async close() {
      if (closed) return;
      closed = true;
      await waitForExit(child, { signal: "SIGTERM" });
    },
  };
}

/** Ensure dist/ has a production UI build. */
function ensureProductionUi(rebuild: boolean): void {
  const index = join(DIST, "index.html");
  const assets = join(DIST, "assets");
  const fresh = existsSync(index) && existsSync(assets);
  if (fresh && !rebuild) {
    console.error(`[ui-hot-paths] using existing ${DIST}`);
    return;
  }
  console.error("[ui-hot-paths] building production UI (vite build)…");
  const result = spawnSync("pnpm", ["exec", "vite", "build"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env },
  });
  if (result.status !== 0) throw new Error(`vite build failed with status ${result.status}`);
  if (!existsSync(index)) throw new Error(`vite build left no ${index}`);
}

/**
 * Seed N messages into a never-cached thread via SQLite (same pattern as
 * bench-turn-latency). Caller must create the task with `hidden: true` so
 * createTask does not projectBotTranscript the empty thread into the store
 * cache before these rows exist.
 */
function seedHistory(dataDir: string, threadId: string, history: number): void {
  if (history <= 0) return;
  const dbPath = join(dataDir, "messages.db");
  const deadline = Date.now() + 15_000;
  while (!existsSync(dbPath) && Date.now() < deadline) {
    // server opens the DB on first write
  }
  if (!existsSync(dbPath)) throw new Error(`messages.db missing under ${dataDir}`);
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const upsert = db.prepare(
      "INSERT INTO messages (thread_id, id, at, role, kind, text, json, sealed, key_id) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL) " +
      "ON CONFLICT(thread_id, id) DO UPDATE SET at = excluded.at, role = excluded.role, kind = excluded.kind, " +
      "text = excluded.text, json = excluded.json, sealed = NULL, key_id = NULL",
    );
    const now = Date.now() - history * 30_000;
    let lastId = "";
    const tx = db.prepare("BEGIN");
    const commit = db.prepare("COMMIT");
    tx.run();
    for (let i = 0; i < history; i++) {
      const role = i % 2 === 0 ? "user" : "bot";
      const id = `ui-hot-${threadId.slice(0, 8)}-${i}`;
      const at = now + i * 30_000;
      const text = role === "user"
        ? `Hot-path question ${i / 2 + 1}: status of synthetic ticket #${1000 + i}?`
        : [
          `## Lot ${Math.floor(i / 2) + 1}`,
          "",
          `Ticket #${1000 + i} is clear on the bench ledger.`,
          "",
          "| Item | Status |",
          "|---|---|",
          "| Backup | ok |",
          "| Patch | pending |",
          "",
          "```ts",
          "export const ok = true;",
          "```",
          "",
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(1 + (i % 3)),
        ].join("\n");
      const message = {
        id,
        at,
        role,
        kind: "text",
        text,
        ...(lastId ? { parentId: lastId } : {}),
      };
      upsert.run(threadId, id, at, role, "text", text, JSON.stringify(message));
      lastId = id;
    }
    db.prepare(
      "INSERT INTO thread_state (thread_id, active_leaf_id) VALUES (?, ?) " +
      "ON CONFLICT(thread_id) DO UPDATE SET active_leaf_id = excluded.active_leaf_id",
    ).run(threadId, lastId);
    commit.run();
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* readers may hold WAL */ }
  } finally {
    db.close();
  }
}

const PAGE_HELPER = `(() => {
  if (window.__uiHot) return true;
  const longTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push({ at: entry.startTime, duration: entry.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch {}
  const text = (el) => (el ? el.innerText || el.textContent || "" : "");
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  window.__uiHot = {
    text, visible, longTasks,
    q: (sel, root = document) => root.querySelector(sel),
    qa: (sel, root = document) => [...root.querySelectorAll(sel)],
    arm(condSource, timeoutMs = 15000) {
      const cond = new Function("b", "return (" + condSource + ");");
      let t0 = null;
      const kinds = ["pointerdown", "mousedown", "keydown", "wheel"];
      const onInput = (e) => { if (t0 === null) t0 = e.timeStamp; };
      for (const k of kinds) window.addEventListener(k, onInput, { capture: true, passive: true });
      const startedAt = performance.now();
      const p = new Promise((resolve) => {
        let done = false;
        const finish = (result) => {
          if (done) return;
          done = true;
          mo.disconnect();
          for (const k of kinds) window.removeEventListener(k, onInput, { capture: true });
          resolve(result);
        };
        const check = () => {
          if (done || t0 === null) return;
          let ok = false;
          try { ok = !!cond(window.__uiHot); } catch { ok = false; }
          if (!ok) return;
          const seen = performance.now();
          requestAnimationFrame(() => {
            const ch = new MessageChannel();
            ch.port1.onmessage = () => {
              const painted = performance.now();
              const lt = longTasks.filter((e) => e.at + e.duration >= t0);
              finish({
                ok: true,
                latency: painted - t0,
                toDom: seen - t0,
                longTaskTotal: lt.reduce((s, e) => s + e.duration, 0),
                longTaskMax: lt.reduce((m, e) => Math.max(m, e.duration), 0),
                longTaskCount: lt.length,
              });
            };
            ch.port2.postMessage(0);
          });
        };
        const mo = new MutationObserver(check);
        mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
        const tick = () => {
          if (done) return;
          check();
          if (performance.now() - startedAt > timeoutMs) finish({ ok: false, timeout: true, sawInput: t0 !== null });
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      window.__uiHotPending = p;
      return true;
    },
    frames(durationMs) {
      return new Promise((resolve) => {
        const gaps = [];
        let last = performance.now();
        let longTaskTotal = 0;
        const start = last;
        const tick = (now) => {
          gaps.push(now - last);
          last = now;
          if (now - start < durationMs) requestAnimationFrame(tick);
          else {
            const sorted = [...gaps].sort((a, b) => a - b);
            const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)] || 0;
            const dropped = gaps.filter((g) => g > 50).length;
            for (const e of longTasks) {
              if (e.at >= start && e.at <= now) longTaskTotal += e.duration;
            }
            resolve({
              frames: gaps.length,
              p50Gap: sorted[Math.floor(sorted.length / 2)] || 0,
              p95Gap: p95,
              maxGap: sorted[sorted.length - 1] || 0,
              droppedPct: gaps.length ? (100 * dropped) / gaps.length : 0,
              longTaskTotal,
            });
          }
        };
        requestAnimationFrame(tick);
      });
    },
    snapshot() {
      const bubbles = document.querySelectorAll("[data-retro-role], [data-message-row]").length;
      const sidebarRows = document.querySelectorAll("[data-sidebar-bot-row]").length;
      const lt = longTasks.slice(-20);
      return {
        nodes: document.querySelectorAll("*").length,
        bubbles,
        sidebarRows,
        scripts: document.scripts.length,
        longTaskMax: lt.reduce((m, e) => Math.max(m, e.duration), 0),
        longTaskCount: lt.length,
      };
    },
    resources() {
      return performance.getEntriesByType("resource").map((e) => ({
        name: e.name.split("/").pop(),
        url: e.name,
        duration: e.duration,
        transferSize: e.transferSize || 0,
        initiatorType: e.initiatorType,
      }));
    },
  };
  return true;
})()`;

async function main() {
  const opts = parseCli(process.argv.slice(2));
  const work = mkdtempSync(join(tmpdir(), "sagax-ui-hot-"));
  let fixture: VerificationServer | undefined;
  let relaunch: { url: string; child: ChildProcess; close: () => Promise<void> } | undefined;
  let browser: import("playwright").Browser | undefined;
  const samples: Record<string, Sample[]> = {
    coldStart: [],
    botSwitch: [],
    settingsOpen: [],
    settingsPage: [],
    botPanel: [],
    scroll: [],
  };
  const hotspots: Array<{ id: string; detail: string; evidence: unknown }> = [];

  const cleanup = async () => {
    try { await browser?.close(); } catch {}
    try { await relaunch?.close(); } catch {}
    // Prefer waitForExit on the child: VerificationServer.close() also rm's dataDir.
    try {
      if (fixture?.child) await waitForExit(fixture.child, { signal: "SIGTERM" });
    } catch {}
    if (!opts.keep) {
      rmSync(work, { recursive: true, force: true });
      if (keptDataDir) rmSync(keptDataDir, { recursive: true, force: true });
    }
  };
  let keptDataDir: string | undefined;
  process.on("SIGINT", () => { void cleanup().then(() => process.exit(130)); });
  process.on("SIGTERM", () => { void cleanup().then(() => process.exit(143)); });

  try {
    ensureProductionUi(opts.rebuild);

    const parentEnv = {
      ...process.env,
      FAKE_CLAUDE_REPLIES: JSON.stringify([
        "Fixture reply for the UI hot-path bench. Ticket is clear.",
        "Second fixture reply with a short table.\n\n| A | B |\n|---|---|\n| 1 | 2 |",
      ]),
      SAGAX_CONTENT_ENCRYPTION: "0",
    };

    // Bootstrap without static UI: create bots/tasks, then stop so the empty
    // thread cache dies. Seed SQLite offline, relaunch with production UI.
    console.error("[ui-hot-paths] launching bootstrap fixture…");
    fixture = await launchVerificationServer(parentEnv);
    const dataDir = fixture.info.dataDir;
    keptDataDir = dataDir;
    let url = fixture.info.url;
    if (new URL(url).port === String(FORBIDDEN_PORT)) {
      throw new Error(`fixture bound forbidden port ${FORBIDDEN_PORT}`);
    }
    const apiAt = (base: string) => async (method: string, path: string, body?: unknown) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { "content-type": "application/json", origin: base },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      const parsed = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text.slice(0, 300)}`);
      return parsed;
    };
    let api = apiAt(url);

    // Onboarding + terms done so the shell paints chat with no gate dialog.
    await api("PUT", "/api/config", {
      onboarding: {
        launchMode: "solo",
        completedAt: "2026-10-01T00:00:00.000Z",
        version: 1,
        reelSeen: true,
        hintsSeen: [
          "tour.composer", "tour.model", "tour.computer", "tour.computer-browser",
          "tour.tools", "tour.apps", "tour.apps-panel", "tour.automations", "tour.automations-page", "tour.done",
        ],
      },
    });
    const terms = await api("GET", "/api/me/terms") as { current?: string };
    if (terms.current) await api("POST", "/api/me/terms", { version: terms.current });

    const alpha = (await api("POST", "/api/bots", { name: "Alpha", title: "Hot path A", section: "My Team" })).bot;
    const beta = (await api("POST", "/api/bots", { name: "Beta", title: "Hot path B", section: "My Team" })).bot;
    await api("POST", `/api/bots/${beta.id}/messages`, { text: "Hello Beta, what is on your plate today?", threadId: beta.threadId });
    for (let i = 0; i < 200; i++) {
      const { bots } = await api("GET", "/api/bots?messages=0");
      const row = bots.find((b: { id: string }) => b.id === beta.id);
      if (row && !row.busy && row.status !== "working" && !row.working) break;
      await sleep(50);
    }

    const longTask = (await api("POST", `/api/bots/${alpha.id}/tasks`, {
      title: "Long hot-path thread",
      hidden: true,
    })).task;
    const longThreadId: string = longTask.threadId;
    // Select the long thread as Alpha's active conversation before shutdown.
    await api("POST", `/api/bots/${alpha.id}/tasks/${encodeURIComponent(longThreadId)}?messages=0`);

    console.error("[ui-hot-paths] stopping bootstrap to clear thread cache…");
    await waitForExit(fixture.child, { signal: "SIGTERM" });
    fixture = undefined;

    console.error(`[ui-hot-paths] seeding ${SCROLL_MESSAGES} messages into ${longThreadId}…`);
    seedHistory(dataDir, longThreadId, SCROLL_MESSAGES);

    console.error("[ui-hot-paths] relaunching with production static UI…");
    relaunch = await relaunchWithStatic(dataDir, parentEnv, DIST);
    url = relaunch.url;
    api = apiAt(url);

    const page = await api("GET", `/api/threads/${encodeURIComponent(longThreadId)}/messages?limit=120`) as {
      messages?: unknown[];
      hasMore?: boolean;
    };
    const seeded = page.messages?.length ?? 0;
    if (seeded < 50) {
      throw new Error(`long-thread seed failed: GET returned ${seeded} messages (expected ~120 with hasMore)`);
    }
    console.error(`[ui-hot-paths] seed ok: ${seeded} messages in page, hasMore=${page.hasMore}`);

    const tools = await ensureUiBrowser(process.env, (line) => console.error(`[ui-hot-paths] ${line}`));
    const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
    browser = await chromium.launch({
      headless: true,
      args: ["--enable-precise-memory-info", "--disable-dev-shm-usage"],
      ...(tools.chrome || process.env.SAGAX_VERIFY_BROWSER_CHROME
        ? { executablePath: tools.chrome || process.env.SAGAX_VERIFY_BROWSER_CHROME }
        : {}),
    });

    const readyCond = `b.qa("[data-sidebar-bot-row]").length >= 2 && !!b.q("textarea, [contenteditable=true]") && !b.q("[aria-busy=true][data-chat-loading]")`;
    const botShown = (name: string) =>
      `(() => { const main = b.q("main") || document.body; return /${name}/.test(b.text(main)) && !!b.q("textarea, [contenteditable=true]"); })()`;
    const settingsOpen = `(() => { const d = b.qa("[role=dialog]").find(b.visible); return !!d && /Settings/.test(b.text(d)) && b.qa("button[aria-current=page]", d).length > 0; })()`;
    const settingsPageActive = (label: string) =>
      `(() => { const d = b.qa("[role=dialog]").find(b.visible); if (!d) return false; const e = b.qa("button", d).find((x) => (x.innerText || "").trim() === ${JSON.stringify(label)}); return !!e && e.getAttribute("aria-current") === "page"; })()`;

    for (let round = 0; round < opts.rounds; round++) {
      console.error(`[ui-hot-paths] round ${round + 1}/${opts.rounds}`);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      page.on("pageerror", (error) => console.error("page error:", error.message));

      await page.addInitScript(() => {
        localStorage.setItem("omb-analytics-opt-out", "1");
        localStorage.setItem("omb-email-gate", "skipped");
        localStorage.setItem("sagax.interfaceMode.v1", "advanced");
        localStorage.setItem("omb-show-threads", "0");
        localStorage.setItem("omb-language", "en");
      });

      // ---- cold start (production static UI) ----
      const coldT0 = performance.now();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.evaluate(PAGE_HELPER);
      await page.waitForFunction((cond) => {
        const fn = new Function("b", `return !!(${cond});`);
        // @ts-expect-error page bridge
        return fn(window.__uiHot);
      }, readyCond, { timeout: 60_000 });
      for (let i = 0; i < 3; i++) {
        const blocked = await page.locator("[data-dialog-layer]").count();
        if (!blocked) break;
        const accept = page.locator("[data-terms-accept]");
        if (await accept.count()) await accept.click();
        else await page.keyboard.press("Escape");
        await sleep(200);
      }
      const coldPainted = performance.now();
      await page.evaluate(PAGE_HELPER);
      const snap = await page.evaluate(() => (window as any).__uiHot.snapshot());
      const resources = await page.evaluate(() => (window as any).__uiHot.resources()) as Array<{
        name: string; url: string; duration: number; transferSize: number; initiatorType: string;
      }>;
      const scriptResources = resources
        .filter((r) => r.initiatorType === "script" || (r.name || "").endsWith(".js"))
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 12);
      samples.coldStart.push({
        round,
        toFirstChatPaintMs: Number((coldPainted - coldT0).toFixed(1)),
        nodes: snap.nodes,
        bubbles: snap.bubbles,
        sidebarRows: snap.sidebarRows,
        scripts: snap.scripts,
        longTaskMax: snap.longTaskMax,
        longTaskCount: snap.longTaskCount,
        topScriptMs: scriptResources[0]?.duration ?? 0,
        topScript: scriptResources[0]?.name ?? null,
      });
      if (round === 0) {
        hotspots.push({
          id: "startup-scripts",
          detail: "Largest script resources on cold start (parse/eval cost proxy)",
          evidence: scriptResources,
        });
        hotspots.push({
          id: "startup-dom",
          detail: "DOM size at first chat paint",
          evidence: snap,
        });
      }

      const click = async (selector: string) => {
        const el = page.locator(selector).first();
        await el.waitFor({ state: "visible", timeout: 15_000 });
        await el.click({ timeout: 10_000 });
      };
      const measureClick = async (cond: string, act: () => Promise<void>, timeoutMs = 15_000) => {
        await page.evaluate(PAGE_HELPER);
        const already = await page.evaluate((c) => {
          const fn = new Function("b", `try { return !!(${c}); } catch { return false; }`);
          return fn((window as any).__uiHot);
        }, cond);
        if (already) return null;
        await page.evaluate(({ c, t }) => (window as any).__uiHot.arm(c, t), { c: cond, t: timeoutMs });
        await act();
        return await page.evaluate(() => (window as any).__uiHotPending) as Sample | null;
      };

      // Ensure Alpha is selected with its long thread.
      await click(`[data-sidebar-bot-row="${alpha.id}"]`);
      await sleep(400);
      await page.waitForFunction((cond) => {
        const fn = new Function("b", `return !!(${cond});`);
        return fn((window as any).__uiHot);
      }, botShown("Alpha"), { timeout: 20_000 }).catch(() => {});

      // ---- bot switch ----
      const botResult = await measureClick(botShown("Beta"), async () => {
        await click(`[data-sidebar-bot-row="${beta.id}"]`);
      });
      if (botResult?.ok) samples.botSwitch.push({ round, ...botResult });
      await sleep(300);

      await click(`[data-sidebar-bot-row="${alpha.id}"]`);
      await sleep(500);

      // ---- bot panel ----
      const panelResult = await measureClick(
        `!!document.querySelector("[data-panel-bot], [data-bot-header-pill][aria-expanded=true]")`,
        async () => { await click("[data-bot-header-pill]"); },
      );
      if (panelResult?.ok) samples.botPanel.push({ round, ...panelResult });
      if (await page.locator("[data-panel-bot]").count()) await click("[data-bot-header-pill]");
      await sleep(200);

      // ---- settings open (measure before idle preload finishes when possible) ----
      // Fresh context each round, so Settings chunk is cold on round 0 and often later.
      await click('button[aria-label="You"], button[aria-label*="You"]');
      await page.waitForSelector("[role=menu]", { timeout: 10_000 });
      await sleep(150);
      const settingsResult = await measureClick(settingsOpen, async () => {
        await page.locator("[role=menuitem]", { hasText: /^Settings$/ }).first().click();
      }, 20_000);
      if (settingsResult?.ok) samples.settingsOpen.push({ round, ...settingsResult });
      await page.waitForFunction((cond) => {
        const fn = new Function("b", `return !!(${cond});`);
        return fn((window as any).__uiHot);
      }, settingsOpen, { timeout: 20_000 });

      const navLabels = await page.evaluate(() => {
        const d = [...document.querySelectorAll("[role=dialog]")].find((el) => el.getBoundingClientRect().width > 0);
        if (!d) return [] as string[];
        return [...d.querySelectorAll("[data-settings-nav-group] button")]
          .map((b) => (b.innerText || "").trim())
          .filter(Boolean);
      });
      for (const label of navLabels) {
        const active = settingsPageActive(label);
        const already = await page.evaluate((c) => {
          const fn = new Function("b", `try { return !!(${c}); } catch { return false; }`);
          return fn((window as any).__uiHot);
        }, active);
        if (already) continue;
        const pageResult = await measureClick(active, async () => {
          await page.locator("[data-settings-nav-group] button", { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).first().click();
        }, 15_000);
        if (pageResult?.ok) {
          samples.settingsPage.push({ round, page: label, ...pageResult });
        }
        await sleep(80);
      }

      await page.keyboard.press("Escape");
      await sleep(300);

      // ---- scroll long chat ----
      await click(`[data-sidebar-bot-row="${alpha.id}"]`);
      await sleep(600);
      for (let i = 0; i < 4; i++) {
        const earlier = page.locator("button", { hasText: /earlier|précédent|Show earlier|Messages plus anciens/i }).first();
        if (await earlier.count()) {
          try { await earlier.click({ timeout: 1000 }); await sleep(200); } catch { break; }
        } else break;
      }
      const scrollHost = page.locator("[data-chat-column] .overflow-y-auto, main .overflow-y-auto, [data-chat-column]").first();
      await scrollHost.waitFor({ state: "visible", timeout: 10_000 });
      const beforeScroll = await page.evaluate(() => (window as any).__uiHot.snapshot());
      const framePromise = page.evaluate(() => (window as any).__uiHot.frames(2600));
      const box = await scrollHost.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        for (let i = 0; i < 26; i++) {
          await page.mouse.wheel(0, -120);
          await sleep(100);
        }
      }
      const frameStats = await framePromise as Sample;
      const afterScroll = await page.evaluate(() => (window as any).__uiHot.snapshot());
      samples.scroll.push({
        round,
        ...frameStats,
        nodesBefore: beforeScroll.nodes,
        nodesAfter: afterScroll.nodes,
        bubblesBefore: beforeScroll.bubbles,
        bubblesAfter: afterScroll.bubbles,
      });
      if (round === 0) {
        hotspots.push({
          id: "scroll-dom",
          detail: "DOM growth while scrolling a 2000-message chat (windowed list should stay bounded)",
          evidence: { before: beforeScroll, after: afterScroll, frames: frameStats },
        });
      }

      await context.close();
    }

    const numeric = (key: string, field: string) =>
      samples[key]!.map((s) => Number(s[field])).filter((n) => Number.isFinite(n));
    const summary = {
      coldStart_toFirstChatPaintMs: statsOf(numeric("coldStart", "toFirstChatPaintMs")),
      botSwitch_latencyMs: statsOf(numeric("botSwitch", "latency")),
      settingsOpen_latencyMs: statsOf(numeric("settingsOpen", "latency")),
      settingsPage_latencyMs: statsOf(numeric("settingsPage", "latency")),
      botPanel_latencyMs: statsOf(numeric("botPanel", "latency")),
      scroll_p95GapMs: statsOf(numeric("scroll", "p95Gap")),
      scroll_droppedPct: statsOf(numeric("scroll", "droppedPct")),
      scroll_longTaskTotalMs: statsOf(numeric("scroll", "longTaskTotal")),
      coldStart_nodes: statsOf(numeric("coldStart", "nodes")),
      scroll_bubblesAfter: statsOf(numeric("scroll", "bubblesAfter")),
    };

    const cold = summary.coldStart_toFirstChatPaintMs.p50;
    const switchMs = summary.botSwitch_latencyMs.p50;
    const settingsMs = summary.settingsOpen_latencyMs.p50;
    const pageMs = summary.settingsPage_latencyMs.p50;
    const panelMs = summary.botPanel_latencyMs.p50;
    const scrollGap = summary.scroll_p95GapMs.p50;
    const bubbles = summary.scroll_bubblesAfter.p50;
    const candidates = [
      { id: "cold-start-imports", score: cold, why: `Cold start to first chat paint p50=${cold}ms (script/chunk cost on startup path)` },
      { id: "settings-open-chunk", score: settingsMs, why: `Settings open p50=${settingsMs}ms (lazy chunk + sync work on main thread)` },
      { id: "settings-page-switch", score: pageMs, why: `Settings page switch p50=${pageMs}ms` },
      { id: "bot-switch-fetch-render", score: switchMs, why: `Bot switch p50=${switchMs}ms (fetch + React render)` },
      { id: "bot-panel-open", score: panelMs, why: `Bot panel open p50=${panelMs}ms` },
      { id: "scroll-main-thread", score: scrollGap * 2 + (bubbles > 200 ? 500 : 0), why: `Scroll p95 frame gap p50=${scrollGap}ms, bubblesAfter p50=${bubbles}` },
    ].sort((a, b) => b.score - a.score);
    const ranked: Array<{ rank: number; id: string; why: string; metric: unknown }> = [];
    for (let i = 0; i < Math.min(3, candidates.length); i++) {
      ranked.push({ rank: i + 1, id: candidates[i]!.id, why: candidates[i]!.why, metric: candidates[i]!.score });
    }

    const report = {
      benchmark: "ui-hot-paths",
      refs: 1971,
      at: new Date().toISOString(),
      headless: true,
      fakeEngine: true,
      productionUi: true,
      staticDir: DIST,
      distMtime: existsSync(join(DIST, "index.html")) ? statSync(join(DIST, "index.html")).mtime.toISOString() : null,
      rounds: opts.rounds,
      scrollMessages: SCROLL_MESSAGES,
      seededPageMessages: seeded,
      url,
      summary,
      topHotspots: ranked,
      hotspotEvidence: hotspots,
      samples,
    };
    mkdirSync(dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ out: opts.out, summary, topHotspots: ranked }, null, 2));
  } finally {
    await cleanup();
  }
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
