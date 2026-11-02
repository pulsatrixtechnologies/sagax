// Electron side of scripts/verify/dev/verify-mascot-chat.mjs. Runs the real floating bot
// controller with a stand-in for the app page (the brain), opens one mascot
// and measures, in its real window:
//  - open: from the snapshot with a balloon to the balloon drawn, and to the
//    window's last resize for it (median of several close and reopen);
//  - stream: a reply streamed in 30 ms steps under three earlier exchanges;
//  - drag: the mascot dragged with the balloon open (synthetic pointer);
//  - resize: the balloon's grip dragged;
//  - near: the balloon dragged by its header onto the mascot (from above,
//    then from its left): the gap left to the character's box (at most 4 px,
//    never over its face), and the clicks the window takes over transparent
//    parts (none: they reach the apps behind);
//  - call: a voice call on the mascot (the app runs it; here a stand-in
//    state): the pill under its feet without growing the window, the bounce
//    with the bot's level, the lean while the person talks, the controls'
//    events, the transcript and settings cards;
// counting window setBounds calls, position writes, dropped frames (rAF gaps)
// and long tasks; then the balloon's background under two skins and Trombi.
import { app, BrowserWindow, ipcMain, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFloatingBotWindows } from "../../../electron/floating-bot-window.mjs";
import { jsLiteral } from "../../testing/js-literal.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const origin = process.env.VERIFY_ORIGIN;
const out = process.env.VERIFY_OUT;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const BOT = "bot-verify";

const counters = { setBounds: 0, setPosition: 0, writes: 0, lastBoundsAt: 0, ignoring: true };
class CountedWindow extends BrowserWindow {
  setIgnoreMouseEvents(ignore, ...rest) {
    counters.ignoring = ignore;
    return super.setIgnoreMouseEvents(ignore, ...rest);
  }
  setBounds(...args) {
    counters.setBounds += 1;
    counters.lastBoundsAt = Date.now();
    return super.setBounds(...args);
  }
  setPosition(...args) {
    counters.setPosition += 1;
    counters.lastBoundsAt = Date.now();
    return super.setPosition(...args);
  }
}

// the brain: a stand-in main window whose page "sends" through ipcMain directly
const brainEvents = [];
const menuPops = [];
const brain = { isDestroyed: () => false, send: (channel, payload) => brainEvents.push({ channel, payload }) };
const mainWindow = { isDestroyed: () => false, webContents: brain };

const PARAGRAPH = "The **mascot** answers here, with `code`, a [link](https://example.com) and a list:\n\n- one point\n- another point that runs a little longer than the first\n\n";
const history = Array.from({ length: 3 }, (_, i) => ({ asked: `Earlier question ${i + 1}?`, text: PARAGRAPH.repeat(4) }));

// a premium skin with live effects: the heaviest look to chat over
const LOOK = { character: "shape", shape: "star", skins: { shape: "holo" } };

const CALL = {
  phase: "speaking", muted: false, botAudible: true, push: false, startedAt: Date.now() - 42_000, line: "Sure, here is what I found.",
  transcript: [{ id: "m1", who: "you", text: "What is on my calendar today?" }, { id: "m2", who: "bot", text: "Two meetings, the first at ten." }],
  note: null, notice: null, settings: { voice: "", speed: 1, language: "auto" }, callSettings: { input: "auto", onlyMyVoice: false, earcons: true },
  voices: [{ id: "eve", label: "Eve" }, { id: "ara", label: "Ara" }], voicesError: null, enrollment: { state: "none" }, previewing: null,
};

function snapshot({ balloon = null, text = "", streaming = false, theme, mascot = LOOK, task = "idle", flyAway = false, call = null } = {}) {
  return {
    v: 1, id: BOT, name: "Sagax", label: "Sagax", color: "green", skin: "none", avatar: null, pose: streaming ? "speak" : "idle",
    reduced: false, retro: false, sparkle: 0, locale: "en", menu: [{ id: "open", label: "Open in the app" }],
    task, mood: 0.8, flyAway, hints: { mood: "", working: "", pin: "Put back", call: "Call Sagax" }, liveliness: "normal",
    mascot,
    ...(call ? { call } : {}),
    ...(theme ? { theme } : {}),
    balloon: balloon
      ? { kind: "chat", title: "Sagax", asked: "Tell me something long", text, history, streaming, truncated: false, open: "Open in Sagax", close: "Close",
          input: { label: "Message", placeholder: "Ask Sagax", send: "Send" } }
      : null,
  };
}
const update = (snap) => ipcMain.emit("floating-bots:update", { sender: brain }, { botId: BOT, snapshot: snap });

const MONITOR = `(() => {
  if (window.__fm) return true;
  const fm = window.__fm = { last: 0, gaps: [], long: 0, longMs: 0, on: false, shownAt: 0, clipped: 0, jumps: 0, anchor: null, still: true, hidden: 0 };
  const loop = (t) => {
    if (fm.on && fm.last) {
      fm.gaps.push(t - fm.last);
      // a frame drawn with the content cut by a window that has not caught up
      const root = document.querySelector(".fb-root");
      if (!document.querySelector(".fb-balloon")) fm.hidden += 1;
      if (root && (root.scrollWidth > innerWidth + 1 || root.scrollHeight > innerHeight + 1)) fm.clipped += 1;
      // the character's corner on the screen: it must not move unless dragged
      const stage = document.querySelector(".fb-stage")?.getBoundingClientRect();
      if (stage && fm.still) {
        const at = Math.round(screenX + stage.right) + "," + Math.round(screenY + stage.bottom);
        if (fm.anchor && fm.anchor !== at) fm.jumps += 1;
        fm.anchor = at;
      }
    }
    fm.last = t;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  try {
    new PerformanceObserver((list) => { if (!fm.on) return; for (const e of list.getEntries()) { fm.long += 1; fm.longMs += e.duration; } }).observe({ entryTypes: ["longtask"] });
  } catch {}
  const shown = () => { const b = document.querySelector(".fb-balloon"); return Boolean(b && !b.closest("[hidden]") && b.getBoundingClientRect().height > 0); };
  new MutationObserver(() => {
    if (shown()) { if (!fm.shownAt) requestAnimationFrame(() => { fm.shownAt = fm.shownAt || Date.now(); }); }
    else fm.shownAt = 0;
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  return true;
})()`;

const js = (win, code) => win.webContents.executeJavaScript(code);
const startFrames = (win, still = true) => js(win, `(() => { const fm = window.__fm; fm.gaps = []; fm.long = 0; fm.longMs = 0; fm.last = 0; fm.clipped = 0; fm.jumps = 0; fm.hidden = 0; fm.anchor = null; fm.still = ${jsLiteral(still)}; fm.on = true; return true; })()`);
async function stopFrames(win) {
  const r = await js(win, "(() => { const fm = window.__fm; fm.on = false; return { gaps: fm.gaps, long: fm.long, longMs: fm.longMs, clipped: fm.clipped, jumps: fm.jumps, hidden: fm.hidden }; })()");
  const gaps = r.gaps.slice().sort((a, b) => a - b);
  const frame = 1000 / 60;
  const dropped = r.gaps.reduce((sum, gap) => sum + Math.max(0, Math.round(gap / frame) - 1), 0);
  const expected = r.gaps.reduce((sum, gap) => sum + gap, 0) / frame;
  return {
    frames: r.gaps.length,
    dropped,
    droppedPct: expected ? Math.round((dropped / expected) * 1000) / 10 : 0,
    worstMs: Math.round(gaps.at(-1) ?? 0),
    // when the worst frame came, ms from the start of the measure
    worstAtMs: Math.round(r.gaps.slice(0, r.gaps.indexOf(gaps.at(-1))).reduce((sum, gap) => sum + gap, 0)),
    p95Ms: Math.round(gaps[Math.floor(gaps.length * 0.95)] ?? 0),
    clippedFrames: r.clipped,
    ...(r.hidden ? { balloonHiddenFrames: r.hidden } : {}),
    ...(r.jumps ? { anchorJumps: r.jumps } : {}),
    longTasks: r.long,
    longTaskMs: Math.round(r.longMs),
  };
}
/** CPU use since the last call, %, of the floating window's renderer, the main process and the GPU process. */
function cpu(win) {
  const pid = win.webContents.getOSProcessId();
  const metrics = app.getAppMetrics();
  const of = (match) => Math.round(metrics.filter(match).reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0));
  return { rendererCpu: of((m) => m.pid === pid), mainCpu: of((m) => m.type === "Browser"), gpuCpu: of((m) => m.type === "GPU") };
}
const resetCounters = () => Object.assign(counters, { setBounds: 0, setPosition: 0, writes: 0 });
const moves = () => counters.setBounds + counters.setPosition;

async function waitFor(win, code, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if (await js(win, code)) return true;
    } catch {
      /* page reloading */
    }
    await wait(50);
  }
  return false;
}

async function measureOpen(win) {
  update(snapshot());
  await wait(400);
  resetCounters();
  await js(win, "window.__fm.shownAt = 0, true");
  const sent = Date.now();
  update(snapshot({ balloon: true, text: PARAGRAPH }));
  await waitFor(win, "Boolean(window.__fm.shownAt)", 4000);
  await wait(600);
  const shownAt = await js(win, "window.__fm.shownAt");
  return { shownMs: shownAt - sent, settledMs: Math.max(shownAt, counters.lastBoundsAt) - sent, windowMoves: moves() };
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** A pointer drag on an element of the page, in screen space, over `steps` frames. */
async function drag(win, selector, dx, dy, steps, perFrame = 1) {
  const rect = await js(win, `(() => { const r = document.querySelector(${jsLiteral(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const start = win.getBounds();
  const sx = start.x + rect.x;
  const sy = start.y + rect.y;
  const at = (gx, gy) => {
    const b = win.getBounds();
    return { x: Math.round(gx - b.x), y: Math.round(gy - b.y), globalX: Math.round(gx), globalY: Math.round(gy) };
  };
  win.webContents.sendInputEvent({ type: "mouseMove", ...at(sx, sy) });
  win.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...at(sx, sy) });
  let lag = 0;
  for (let i = 1; i <= steps; i += 1) {
    await wait(16);
    const gx = sx + (dx * i) / steps;
    const gy = sy + (dy * i) / steps;
    // a 120 Hz pointer reports two moves a frame
    for (let k = perFrame - 1; k >= 0; k -= 1) {
      win.webContents.sendInputEvent({ type: "mouseMove", button: "left", ...at(gx - (dx * k) / steps / perFrame, gy - (dy * k) / steps / perFrame) });
    }
    // where the dragged thing is drawn now, on the screen, against the pointer
    const now = await js(win, `(() => { const r = document.querySelector(${jsLiteral(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const b = win.getBounds();
    lag += Math.hypot(b.x + now.x - gx, b.y + now.y - gy);
  }
  await wait(50);
  const end = at(sx + dx, sy + dy);
  win.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...end });
  await wait(300);
  return { meanLagPx: Math.round(lag / steps), moved: { x: win.getBounds().x - start.x, y: win.getBounds().y - start.y } };
}

/** The balloon's box and the character's, in the page. */
const boxes = (win) => js(win, `(() => {
  const r = (q) => { const b = document.querySelector(q)?.getBoundingClientRect(); return b && { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; };
  return { balloon: r(".fb-balloon"), owl: r(".fb-body") };
})()`);
/** Does the window take a click here (page coordinates)? The page decides on the pointer's moves. */
async function takesPointer(win, x, y) {
  const b = win.getBounds();
  win.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(x), y: Math.round(y), globalX: b.x + Math.round(x), globalY: b.y + Math.round(y) });
  // main hears of a change over IPC: give it a moment, then a second move to settle a late enter
  await wait(150);
  win.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(x) + 1, y: Math.round(y), globalX: b.x + Math.round(x) + 1, globalY: b.y + Math.round(y) });
  await wait(250);
  return !counters.ignoring;
}

async function measureNear(win) {
  // docked first (the pin), then down onto the head
  await js(win, `(() => { localStorage.removeItem("omb.floatingBots.balloon.v1"); return true; })()`);
  update(snapshot());
  await wait(500);
  update(snapshot({ balloon: true, text: PARAGRAPH }));
  await wait(900);
  const docked = await boxes(win);
  resetCounters();
  await drag(win, ".fb-name", 0, 420, 40);
  const above = await boxes(win);
  const aboveMoves = moves();
  // to its left, down beside it, then right up to its side
  await drag(win, ".fb-name", -420, 0, 30);
  await drag(win, ".fb-name", 0, 200, 30);
  await drag(win, ".fb-name", 420, 0, 40);
  const left = await boxes(win);
  const face = (o) => ({ left: o.left + 12, top: o.top + 12, right: o.right - 12, bottom: o.bottom - 12 });
  const covers = (a, f) => a.left < f.right && a.right > f.left && a.top < f.bottom && a.bottom > f.top;
  // the transparent parts: the stage's empty corner, the room the balloon left above
  const shot = path.join(path.dirname(out), "mascot-near.png");
  fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
  const size = await js(win, "({ w: innerWidth, h: innerHeight })");
  const transparent = [
    { x: size.w - 3, y: size.h - 3 },
    { x: size.w - 3, y: 3 },
    { x: Math.max(3, left.owl.right + 8), y: Math.max(3, left.owl.top - 30) },
  ];
  const through = [];
  for (const point of transparent) through.push({ ...point, takes: await takesPointer(win, point.x, point.y) });
  // over the balloon it takes the pointer (a synthetic move can land before the page has laid out: try a few spots)
  let overBalloon = false;
  for (let i = 0; i < 3 && !overBalloon; i += 1) overBalloon = await takesPointer(win, (left.balloon.left + left.balloon.right) / 2 + i * 12, (left.balloon.top + left.balloon.bottom) / 2 + i * 12);
  const result = {
    dockedGapPx: Math.round(docked.owl.top - docked.balloon.bottom),
    fromAboveGapPx: Math.round(above.owl.top - above.balloon.bottom),
    fromLeftGapPx: Math.round(left.owl.left - left.balloon.right),
    coversFace: covers(above.balloon, face(above.owl)) || covers(left.balloon, face(left.owl)),
    windowMovesDraggingBalloon: aboveMoves,
    transparentTakesClicks: through.filter((p) => p.takes).length,
    balloonTakesClicks: overBalloon,
    screenshot: shot,
  };
  const ok = result.fromAboveGapPx <= 4 && result.fromLeftGapPx <= 4 && !result.coversFace && result.transparentTakesClicks === 0 && result.balloonTakesClicks;
  if (!ok) throw new Error(`balloon near the mascot: ${JSON.stringify(result)}`);
  // back to its docked spot for what follows
  await js(win, `(() => { localStorage.removeItem("omb.floatingBots.balloon.v1"); return true; })()`);
  update(snapshot());
  await wait(400);
  return result;
}

const levels = (bot, mic = 0) => ipcMain.emit("floating-bots:level", { sender: brain }, { botId: BOT, levels: { bot, mic } });
const click = async (win, selector) => {
  const at = await js(win, `(() => { const r = document.querySelector(${jsLiteral(selector)})?.getBoundingClientRect(); return r && { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  if (!at) throw new Error(`nothing to click at ${selector}: ${await js(win, "(document.querySelector('.fb-head')?.outerHTML ?? document.body.innerHTML).slice(0, 400)")}`);
  win.webContents.sendInputEvent({ type: "mouseMove", ...at });
  await wait(60);
  win.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...at });
  win.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...at });
  await wait(250);
};

async function measureCall(win) {
  const dir = path.dirname(out);
  const callEvents = () => brainEvents.filter((e) => e.channel === "floating-bots:event" && e.payload.event.type === "call").map((e) => e.payload.event.action);
  // the balloon offers the call
  update(snapshot({ balloon: true, text: PARAGRAPH }));
  await wait(700);
  await click(win, "[data-call-start]");
  const started = callEvents().includes("start");
  update(snapshot({ call: CALL }));
  await wait(900);
  const before = win.getBounds();
  resetCounters();
  const geometry = await js(win, `(() => {
    const r = (q) => { const b = document.querySelector(q)?.getBoundingClientRect(); return b && { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; };
    return { pill: r(".fb-call-pill"), owl: r(".fb-body"), stage: r(".fb-stage"), call: document.querySelector(".fb-stage")?.dataset.call ?? null };
  })()`);
  // the bounce follows the bot's level
  const scaleAt = async (level) => {
    levels(level);
    await wait(200);
    return js(win, "getComputedStyle(document.querySelector('.fb-body')).scale");
  };
  const quiet = await scaleAt(0);
  const loud = await scaleAt(0.9);
  fs.writeFileSync(path.join(dir, "mascot-call-pill.png"), (await win.webContents.capturePage()).toPNG());
  for (let i = 0; i < 30; i += 1) {
    levels(Math.abs(Math.sin(i / 3)), 0);
    await wait(30);
  }
  update(snapshot({ call: { ...CALL, phase: "hearing", botAudible: false, line: "Move my ten o'clock" } }));
  for (let i = 0; i < 20; i += 1) {
    levels(0, Math.abs(Math.sin(i / 2)) * 0.8);
    await wait(30);
  }
  await wait(300);
  const lean = await js(win, "({ call: document.querySelector('.fb-stage')?.dataset.call, rotate: getComputedStyle(document.querySelector('.fb-body')).rotate })");
  fs.writeFileSync(path.join(dir, "mascot-call-hearing.png"), (await win.webContents.capturePage()).toPNG());
  const pillMoves = moves();
  // the controls report to the brain
  await click(win, "[data-voice-mute]");
  await click(win, "[data-voice-transcript-toggle]");
  await wait(400);
  const transcript = await js(win, "document.querySelectorAll('[data-voice-card] [data-voice-line]').length");
  fs.writeFileSync(path.join(dir, "mascot-call-transcript.png"), (await win.webContents.capturePage()).toPNG());
  await click(win, "[data-voice-gear]");
  await wait(400);
  const settings = await js(win, "Boolean(document.querySelector('[data-voice-card] [data-voice-call-settings]'))");
  fs.writeFileSync(path.join(dir, "mascot-call-settings.png"), (await win.webContents.capturePage()).toPNG());
  await click(win, "[data-voice-gear]");
  await click(win, "[data-voice-end]");
  // a transparent spot beside the pill still lets clicks through
  const size = await js(win, "({ w: innerWidth, h: innerHeight })");
  const through = await takesPointer(win, size.w - 2, size.h - 2);
  update(snapshot());
  await wait(400);
  const result = {
    started,
    stageCall: geometry.call,
    pillUnderFeetPx: Math.round(geometry.pill.top - geometry.owl.bottom),
    pillInsideStage: geometry.pill.bottom <= geometry.stage.bottom + 0.5 && geometry.pill.left >= geometry.stage.left - 0.5,
    windowGrewForPill: win.getBounds().height !== before.height && moves() > 0 ? true : false,
    windowMovesDuringCall: pillMoves,
    bounce: { quiet, loud },
    lean,
    events: callEvents(),
    transcriptLines: transcript,
    settingsCard: settings,
    transparentTakesClicks: through,
  };
  const ok = result.started && result.pillInsideStage && quiet !== loud && lean.call === "hearing" && result.events.includes("mute") && result.events.includes("voices") && result.events.includes("end") && transcript >= 2 && settings && !through;
  if (!ok) throw new Error(`mascot call: ${JSON.stringify(result)}`);
  return result;
}

/** A right click on the mascot: the menu opens exactly at the pointer. */
async function measureMenu(win) {
  update(snapshot());
  await wait(400);
  const at = await js(win, "(() => { const r = document.querySelector('.fb-body').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2 + 7), y: Math.round(r.top + r.height / 2 + 5) }; })()");
  menuPops.length = 0;
  win.webContents.sendInputEvent({ type: "mouseMove", ...at });
  await wait(60);
  win.webContents.sendInputEvent({ type: "mouseDown", button: "right", clickCount: 1, ...at });
  win.webContents.sendInputEvent({ type: "mouseUp", button: "right", clickCount: 1, ...at });
  await wait(400);
  const pop = menuPops.at(-1) ?? null;
  const result = { click: at, popup: pop, drawnMenu: await js(win, "Boolean(document.querySelector('.fb-menu'))") };
  if (!pop || Math.abs(pop.x - at.x) > 1 || Math.abs(pop.y - at.y) > 1 || result.drawnMenu) throw new Error(`menu at the pointer: ${JSON.stringify(result)}`);
  return result;
}

async function faceColors(win) {
  return js(win, `(() => {
    const face = document.querySelector(".fb-balloon-face");
    const s = face ? getComputedStyle(face) : null;
    return { skin: document.documentElement.dataset.skin ?? null, background: s?.backgroundColor ?? null, color: s?.color ?? null, retro: Boolean(document.querySelector(".r98-balloon")) };
  })()`);
}

app.on("window-all-closed", () => undefined);

app.whenReady().then(async () => {
  const report = { electron: process.versions.electron, platform: process.platform };
  try {
    const floats = createFloatingBotWindows({
      BrowserWindow: CountedWindow,
      screen,
      ipcMain,
      getMainWindow: () => mainWindow,
      pageUrl: () => `${origin}/?omb-floating-bot=1`,
      preload: path.join(here, "..", "..", "..", "electron", "floating-bot-preload.cjs"),
      readPositions: () => ({}),
      writePositions: () => {
        counters.writes += 1;
      },
      focusMain: () => undefined,
      // main's native menu, recorded (a real one would block the run): where it opens and with what
      Menu: { buildFromTemplate: (items) => ({ popup: (options) => menuPops.push({ x: options.x, y: options.y, labels: items.map((item) => item.label) }) }) },
      log: (line) => console.log(`[mascot-chat] ${line}`),
    });
    const t0 = Date.now();
    const win = floats.open(BOT);
    update(snapshot());
    // Vite optimizes dependencies on a first visit and may reload the page
    if (!(await waitFor(win, "Boolean(document.querySelector('.fb-art'))", 60000))) throw new Error("the mascot never drew");
    report.firstDrawMs = Date.now() - t0;
    await wait(1500);
    await js(win, MONITOR);

    // open latency: close and reopen a few times
    const opens = [];
    for (let i = 0; i < 5; i += 1) opens.push(await measureOpen(win));
    report.open = {
      shownMs: median(opens.map((o) => o.shownMs)),
      settledMs: median(opens.map((o) => o.settledMs)),
      windowMoves: median(opens.map((o) => o.windowMoves)),
      all: opens,
    };

    // the balloon open, nothing happening: what the mascot costs behind the chat
    update(snapshot({ balloon: true, text: PARAGRAPH }));
    await wait(500);
    cpu(win);
    await startFrames(win);
    await wait(3000);
    report.idleOpen = { ...cpu(win), ...(await stopFrames(win)) };

    // a reply streams in
    update(snapshot({ balloon: true, text: "", streaming: true }));
    await wait(500);
    resetCounters();
    cpu(win);
    await startFrames(win);
    let text = "";
    const stream = PARAGRAPH.repeat(6);
    const started = Date.now();
    for (let i = 0; i < 160; i += 1) {
      text = stream.slice(0, Math.round(((i + 1) / 160) * stream.length));
      update(snapshot({ balloon: true, text, streaming: true }));
      await wait(30);
    }
    update(snapshot({ balloon: true, text, streaming: false }));
    await wait(300);
    report.stream = { updates: 161, ms: Date.now() - started, windowMoves: moves(), ...cpu(win), ...(await stopFrames(win)) };

    // a message sent from the balloon: the bot works ("Fly away during tasks" on, the default) and replies
    const home = win.getBounds();
    resetCounters();
    await startFrames(win, false);
    for (let i = 0; i < 100; i += 1) {
      update(snapshot({ balloon: true, text: stream.slice(0, i * 20), streaming: i > 0, task: "working", flyAway: true }));
      await wait(40);
    }
    update(snapshot({ balloon: true, text: stream.slice(0, 2000), task: "idle", flyAway: true }));
    await wait(2500);
    const after = win.getBounds();
    report.replyWhileWorking = { windowMoves: moves(), leftHomePx: Math.round(Math.hypot(after.x + after.width - home.x - home.width, after.y + after.height - home.y - home.height)), ...(await stopFrames(win)) };
    update(snapshot({ balloon: true, text: PARAGRAPH }));
    await wait(2500);

    // drag the mascot with the balloon open
    resetCounters();
    cpu(win);
    await startFrames(win, false);
    const dragged = await drag(win, ".fb-body", -220, -120, 90, 2);
    report.drag = { steps: 90, pointerMoves: 180, windowMoves: moves(), positionWrites: counters.writes, ...dragged, ...cpu(win), ...(await stopFrames(win)) };

    // resize the balloon from its grip
    resetCounters();
    cpu(win);
    await startFrames(win);
    const resized = await drag(win, ".fb-grip", -140, -90, 60);
    report.resize = { steps: 60, windowMoves: moves(), positionWrites: counters.writes, ...resized, ...cpu(win), ...(await stopFrames(win)) };
    report.near = await measureNear(win);
    report.call = await measureCall(win);
    report.menu = await measureMenu(win);
    report.events = brainEvents.filter((e) => e.channel === "floating-bots:event").map((e) => e.payload.event.type);

    // theme: the app's skin, live, and Trombi's own look
    update(snapshot({ balloon: true, text: PARAGRAPH, theme: { skin: "pulsatrix-light" } }));
    await wait(400);
    const light = await faceColors(win);
    update(snapshot({ balloon: true, text: PARAGRAPH, theme: { skin: "midnight" } }));
    await wait(400);
    const dark = await faceColors(win);
    update(snapshot({ balloon: true, text: PARAGRAPH, theme: { skin: "pulsatrix-light" }, mascot: { character: "trombi" } }));
    await wait(600);
    const trombi = await faceColors(win);
    report.theme = { light, dark, trombi };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(out), "mascot-chat.png"), (await win.webContents.capturePage()).toPNG());
    floats.dispose();
    fs.writeFileSync(out, JSON.stringify(report, null, 1));
    app.exit(0);
  } catch (error) {
    console.error(`[mascot-chat] ${error?.stack ?? error}`);
    fs.writeFileSync(out, JSON.stringify({ ...report, error: String(error?.message ?? error) }, null, 1));
    app.exit(1);
  }
});
