// Electron side of scripts/verify/dev/verify-mascot-desktop.mjs. Runs the real floating
// bot controller with a stand-in for the app page (the brain), opens one
// mascot and checks, in its real window, on every display of this machine:
//  - position: dragged into each corner of each display's work area, the
//    character's own box lands exactly in the corner (its window's empty
//    room hangs off the screen); the spot comes back exactly after a close
//    and reopen;
//  - bubble: opened in each corner, it opens on the side with room (below
//    near the top, to the right near the left edge), stays on the display
//    and inside its window (never cut), and never covers the character;
//  - menu: the right click pops main's native menu with the owner's items, and
//    Moves plays the move in the window;
//  - effects: a sign and the thought dots are drawn beside the character,
//    never over it, on the side the screen leaves room on;
//  - slice 2, hover controls: the pointer over the character shows quick
//    chat, voice and activity after 150 ms, beside it and never over it, and
//    they go 400 ms after it leaves; the bell opens the activity tray (where
//    the chat goes) and its Allow reaches the brain;
//  - slice 2, click is chat, not call: a plain click on the idle character
//    asks the brain for the chat balloon and never for a call (a drag asks
//    nothing); the call starts from the hover button or the hotkey. The stand-in brain then plays the
//    fake call of scripts/verify/dev/verify-voice-mode.ts (its transcript, 4 s spoken
//    sentences): the pill stays under the feet, the status chip follows the
//    phase and the captions reveal the bot's words beside the character; a
//    click during the call ends nothing.
// Screenshots of the window (capturePage) go next to the report.
import { app, BrowserWindow, ipcMain, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFloatingBotWindows } from "../../../electron/floating-bot-window.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const origin = process.env.VERIFY_ORIGIN;
const out = process.env.VERIFY_OUT;
const dir = path.dirname(out);
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const BOT = "bot-verify";

/** The spots main saves (writePositions), kept here as a file would. */
let saved = {};
const brainEvents = [];
const menuPops = [];
const brain = { isDestroyed: () => false, send: (channel, payload) => brainEvents.push({ channel, payload }) };
const mainWindow = { isDestroyed: () => false, webContents: brain };

const PARAGRAPH = "The **mascot** answers here, with `code` and a list:\n\n- one point\n- another point that runs a little longer than the first\n\n";
const MENU = [
  { id: "balloon", label: "Talk" },
  { id: "call", label: "Start a voice call" },
  { id: "open", label: "Open in Sagax" },
  { id: "sep-1", label: "", type: "separator" },
  { id: "switch", label: "Switch bot", items: [{ id: `switch:${BOT}`, label: "Sagax", checked: true }, { id: "switch:bot-two", label: "Ada" }] },
  { id: "moves", label: "Moves", items: [{ id: "move:wave", label: "Wave" }, { id: "move:dance", label: "Dance" }, { id: "move:hoot", label: "Hoot" }] },
  { id: "sep-2", label: "", type: "separator" },
  { id: "snooze", label: "Hide for 1 hour" },
  { id: "dock", label: "Hide" },
  { id: "sep-3", label: "", type: "separator" },
  { id: "options", label: "On the desktop", items: [{ id: "top", label: "Always on top", checked: true }, { id: "fly", label: "Fly away during tasks", checked: false }] },
  { id: "settings", label: "Settings…" },
];

function snapshot({ balloon = false, mascot = { character: "owl" }, pose = "idle", theme = { skin: "midnight" }, call = null, tray = null } = {}) {
  return {
    call, tray,
    v: 1, id: BOT, name: "Sagax", label: "Sagax", color: "green", skin: "none", avatar: null, pose,
    reduced: false, retro: false, sparkle: 0, locale: "en", menu: MENU,
    task: "idle", mood: 0.8, flyAway: false, hints: { mood: "", working: "", pin: "Put back", call: "Call Sagax", hoot: "Hoot!" }, liveliness: "calm",
    mascot, theme,
    balloon: balloon
      ? { kind: "chat", title: "Sagax", asked: "What is on my plate today?", text: PARAGRAPH.repeat(3), history: [{ asked: "Earlier question?", text: PARAGRAPH }], streaming: false, truncated: false, open: "Open in Sagax", close: "Close",
          input: { label: "Message", placeholder: "Ask Sagax", send: "Send", attach: "Attach a file", model: "GPT-5 high", modelTitle: "Change the model in the app" } }
      : null,
  };
}
const update = (snap) => ipcMain.emit("floating-bots:update", { sender: brain }, { botId: BOT, snapshot: snap });
const js = (win, code) => win.webContents.executeJavaScript(code);

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

/** Page boxes, in the window's coordinates: the character's own box (layout, not the drawn bounce), the balloon, the effects. */
const boxes = (win) => js(win, `(() => {
  const r = (q) => { const b = document.querySelector(q)?.getBoundingClientRect(); return b && b.width ? { x: b.left, y: b.top, width: b.width, height: b.height } : null; };
  const stage = document.querySelector(".fb-stage")?.getBoundingClientRect();
  const body = document.querySelector(".fb-body");
  const root = document.querySelector(".fb-root");
  return {
    body: stage && body ? { x: stage.left + parseFloat(body.style.left), y: stage.top + parseFloat(body.style.top), width: parseFloat(body.style.width), height: parseFloat(body.style.height) } : null,
    balloon: r(".fb-balloon:not([data-closing])"),
    emote: r(".fb-emote"),
    thought: r(".fb-thought"),
    fx: r(".fb-fx"),
    fxSide: document.querySelector(".fb-fx")?.dataset.side ?? null,
    below: Boolean(root?.classList.contains("fb-below")),
    left: Boolean(root?.classList.contains("fb-left")),
    hidden: root ? getComputedStyle(root).visibility === "hidden" : true,
    view: { width: innerWidth, height: innerHeight },
  };
})()`);
const onScreen = (rect, bounds) => ({ x: Math.round(bounds.x + rect.x), y: Math.round(bounds.y + rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
const inside = (a, area, slack = 1) => a.x >= area.x - slack && a.y >= area.y - slack && a.x + a.width <= area.x + area.width + slack && a.y + a.height <= area.y + area.height + slack;
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** A real pointer drag on the character, by (dx, dy) in screen space, over a few frames. */
async function dragBody(win, dx, dy, steps = 12) {
  const b0 = await boxes(win);
  const start = win.getBounds();
  const sx = start.x + b0.body.x + b0.body.width / 2;
  const sy = start.y + b0.body.y + b0.body.height / 2;
  const at = (gx, gy) => {
    const b = win.getBounds();
    return { x: Math.round(gx - b.x), y: Math.round(gy - b.y), globalX: Math.round(gx), globalY: Math.round(gy) };
  };
  win.webContents.sendInputEvent({ type: "mouseMove", ...at(sx, sy) });
  win.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...at(sx, sy) });
  for (let i = 1; i <= steps; i += 1) {
    await wait(20);
    win.webContents.sendInputEvent({ type: "mouseMove", button: "left", ...at(sx + (dx * i) / steps, sy + (dy * i) / steps) });
  }
  await wait(60);
  win.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...at(sx + dx, sy + dy) });
  // the drop: the move settles, the layout is read again, the window may move to its new corner
  await wait(900);
}

/** Whether another display touches this work area's edge on that side (a drag past it would go onto that display). */
const neighbour = (area, all, dx, dy) => all.some((other) => other !== area && (
  dx < 0 ? other.x + other.width === area.x : dx > 0 ? other.x === area.x + area.width : dy < 0 ? other.y + other.height === area.y : other.y === area.y + area.height
));

/**
 * Puts the character's box at (x, y) on the screen: a jump through main (as a
 * flight would) to 40 px short of it, then a real drag the rest of the way
 * and past it (where no other display is), so the drop is the person's.
 */
async function placeBody(win, x, y, into, area = null, all = []) {
  const b = await boxes(win);
  const bounds = win.getBounds();
  const now = onScreen(b.body, bounds);
  await js(win, `window.floatingBotWindow.moveTo(${bounds.x + x - now.x - into.x * 40}, ${bounds.y + y - now.y - into.y * 40})`);
  await wait(250);
  const jumped = onScreen((await boxes(win)).body, win.getBounds());
  const past = (d, dx, dy) => (d && (!area || !neighbour(area, all, dx, dy)) ? d * 120 : d * 40);
  await dragBody(win, past(into.x, into.x, 0), past(into.y, 0, into.y));
  return jumped;
}

async function corners(win, areas) {
  const results = [];
  for (const [index, area] of areas.entries()) {
    const spots = [
      { name: "top-left", x: area.x, y: area.y, into: { x: -1, y: -1 } },
      { name: "top-right", x: area.x + area.width - 120, y: area.y, into: { x: 1, y: -1 } },
      { name: "bottom-left", x: area.x, y: area.y + area.height - 120, into: { x: -1, y: 1 } },
      { name: "bottom-right", x: area.x + area.width - 120, y: area.y + area.height - 120, into: { x: 1, y: 1 } },
    ];
    for (const spot of spots) {
      update(snapshot());
      await wait(300);
      // from the middle of that display first (as a person drags it there), so the window's room is on the usual side
      await placeBody(win, area.x + Math.round(area.width / 2), area.y + Math.round(area.height / 2), { x: 1, y: 1 });
      const jumped = await placeBody(win, spot.x, spot.y, spot.into, area, areas);
      // next to a seam with another display, macOS keeps the window's room off that display: the drop
      // turns the chat's room away from the seam, and a second drag (as a person would) reaches the corner
      let nudged = false;
      const landed = onScreen((await boxes(win)).body, win.getBounds());
      if (Math.abs(landed.x - spot.x) > 1 || Math.abs(landed.y - spot.y) > 1) {
        nudged = true;
        await dragBody(win, spot.x - landed.x + spot.into.x * (neighbour(area, areas, spot.into.x, 0) ? 0 : 40), spot.y - landed.y + spot.into.y * (neighbour(area, areas, 0, spot.into.y) ? 0 : 40));
      }
      const bounds = win.getBounds();
      const rest = await boxes(win);
      const body = onScreen(rest.body, bounds);
      update(snapshot({ balloon: true }));
      await wait(900);
      const open = await boxes(win);
      const after = win.getBounds();
      const balloon = open.balloon ? onScreen(open.balloon, after) : null;
      const shot = path.join(dir, `corner-${index}-${spot.name}.png`);
      fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
      const result = {
        display: index,
        corner: spot.name,
        jumped,
        nudged,
        body,
        inCorner: Math.abs(body.x - spot.x) <= 1 && Math.abs(body.y - spot.y) <= 1,
        windowHangsOff: !inside(bounds, area, 0),
        chatSide: { below: open.below, right: open.left },
        balloon,
        balloonOnDisplay: Boolean(balloon && inside(balloon, area)),
        balloonInWindow: Boolean(open.balloon && inside(open.balloon, { x: 0, y: 0, width: open.view.width, height: open.view.height })),
        balloonCoversCharacter: Boolean(balloon && overlaps(balloon, onScreen(open.body, after))),
        characterMovedWhenOpened: Math.abs(onScreen(open.body, after).x - body.x) + Math.abs(onScreen(open.body, after).y - body.y),
        screenshot: shot,
      };
      results.push(result);
      update(snapshot());
      await wait(500);
    }
  }
  return results;
}

/**
 * A drag across the seam between two displays, with the pointer (35 steps of
 * 20 px): the character must end on the second display, under the pointer.
 */
async function seam(win, from, to) {
  const y = Math.round(Math.max(from.y, to.y) + Math.min(from.height, to.height) / 2);
  await placeBody(win, from.x + from.width - 400, y, { x: 1, y: 0 });
  const start = onScreen((await boxes(win)).body, win.getBounds());
  const steps = 35;
  await dragBody(win, steps * 20, 0, steps);
  const end = onScreen((await boxes(win)).body, win.getBounds());
  return { start, end, expectedX: start.x + steps * 20, onSecond: end.x >= to.x, followedPx: Math.abs(end.x - (start.x + steps * 20)) + Math.abs(end.y - start.y) };
}

async function restart(floats, area) {
  let win = floats.window(BOT);
  await placeBody(win, area.x + 30, area.y + 20, { x: -1, y: -1 });
  const before = onScreen((await boxes(win)).body, win.getBounds());
  floats.close(BOT);
  await wait(300);
  win = floats.open(BOT);
  const trace = [win.getBounds()];
  update(snapshot());
  await waitFor(win, "Boolean(document.querySelector('.fb-body'))", 30000);
  trace.push(win.getBounds());
  await wait(1200);
  trace.push(win.getBounds());
  console.log(`[mascot-desktop] restart trace ${JSON.stringify(trace)} saved ${JSON.stringify(saved)}`);
  const after = onScreen((await boxes(win)).body, win.getBounds());
  return { before, after, same: before.x === after.x && before.y === after.y, win };
}

async function menu(win) {
  update(snapshot());
  await wait(400);
  const b = await boxes(win);
  const at = { x: Math.round(b.body.x + 60), y: Math.round(b.body.y + 60) };
  menuPops.length = 0;
  win.webContents.sendInputEvent({ type: "mouseMove", ...at });
  await wait(60);
  win.webContents.sendInputEvent({ type: "mouseDown", button: "right", clickCount: 1, ...at });
  win.webContents.sendInputEvent({ type: "mouseUp", button: "right", clickCount: 1, ...at });
  await wait(400);
  const pop = menuPops.at(-1);
  if (!pop) throw new Error("no native menu");
  const labels = pop.template.map((item) => (item.type === "separator" ? "-" : item.submenu ? `${item.label} >` : item.label));
  // Moves > Dance plays in the window
  pop.template.find((item) => item.label === "Moves").submenu.find((item) => item.label === "Dance").click();
  await wait(150);
  const danced = await js(win, "document.querySelector('.fb-stage')?.dataset.activity");
  // Talk and Settings reach the brain
  pop.template.find((item) => item.label === "Talk").click();
  pop.template.find((item) => item.label === "Settings…").click();
  const ids = brainEvents.filter((e) => e.channel === "floating-bots:event" && e.payload.event.type === "menu").map((e) => e.payload.event.id);
  return { at: { x: pop.x, y: pop.y }, labels, switchBots: pop.template.find((item) => item.label === "Switch bot").submenu.map((item) => item.label), danced, brainHeard: ids.slice(-2) };
}

async function effects(win, all) {
  // a display whose right edge is free (no display past it), so the character can stand right at it
  const area = all.find((candidate) => !neighbour(candidate, all, 1, 0)) ?? all[0];
  const out = [];
  for (const spot of [{ name: "middle", x: area.x + Math.round(area.width / 2), y: area.y + Math.round(area.height / 2), into: { x: 1, y: 0 } }, { name: "right-edge", x: area.x + area.width - 120, y: area.y + Math.round(area.height / 2), into: { x: 1, y: 0 } }]) {
    update(snapshot());
    await wait(300);
    await placeBody(win, spot.x, spot.y, spot.into, area, all);
    // a sign (the owl's hoot) and the thought dots (the bot thinking)
    win.webContents.send("floating-bot:move", "hoot");
    update(snapshot({ pose: "think" }));
    await wait(350);
    const b = await boxes(win);
    const bounds = win.getBounds();
    const shot = path.join(dir, `effects-${spot.name}.png`);
    fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
    out.push({
      spot: spot.name,
      body: onScreen(b.body, bounds),
      side: b.fxSide,
      emote: b.emote,
      emoteOverCharacter: Boolean(b.emote && overlaps(b.emote, b.body)),
      thoughtOverCharacter: Boolean(b.thought && overlaps(b.thought, b.body)),
      emoteOnDisplay: Boolean(b.emote && inside(onScreen(b.emote, bounds), area)),
      screenshot: shot,
    });
    await wait(1500);
  }
  update(snapshot());
  return out;
}

/* ------------------------------------------------------------ slice 2 */

/** A page point with its screen point (the mascot drags in screen coordinates). */
const pagePoint = (win, x, y) => {
  const b = win.getBounds();
  return { x: Math.round(x), y: Math.round(y), globalX: Math.round(b.x + x), globalY: Math.round(b.y + y) };
};
const pointerAt = (win, x, y) => win.webContents.sendInputEvent({ type: "mouseMove", ...pagePoint(win, x, y) });
/** A press and release at one spot (a click), or with a few moves in between (a drag of dx px). */
async function press(win, x, y, dx = 0) {
  pointerAt(win, x, y);
  await wait(30);
  const start = win.getBounds();
  const at = (px) => ({ x: Math.round(px - (win.getBounds().x - start.x)), y: Math.round(y - (win.getBounds().y - start.y)), globalX: Math.round(start.x + px), globalY: Math.round(start.y + y) });
  win.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...at(x) });
  for (let i = 1; i <= 4 && dx; i += 1) {
    await wait(20);
    win.webContents.sendInputEvent({ type: "mouseMove", button: "left", ...at(x + (dx * i) / 4) });
  }
  await wait(30);
  win.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...at(x + dx) });
  await wait(dx ? 900 : 120);
}
const controlsState = (win) => js(win, `(() => {
  const bar = document.querySelector(".fb-controls");
  const buttons = [...document.querySelectorAll(".fb-controls button")].map((b) => { const r = b.getBoundingClientRect(); return { control: b.dataset.control, x: r.left, y: r.top, width: r.width, height: r.height }; });
  return { shown: Boolean(bar?.hasAttribute("data-shown")), opacity: bar ? Number(getComputedStyle(bar).opacity) : 0, side: bar?.dataset.side ?? null, buttons };
})()`);
const brainSince = (from) => brainEvents.slice(from).filter((e) => e.channel === "floating-bots:event").map((e) => e.payload.event);

async function hoverControls(win, all) {
  const area = all[0];
  update(snapshot());
  await wait(300);
  await placeBody(win, area.x + Math.round(area.width / 2), area.y + Math.round(area.height / 2), { x: 1, y: 1 });
  const b = await boxes(win);
  const center = { x: b.body.x + b.body.width / 2, y: b.body.y + b.body.height / 2 };
  // far from the character first, then over it
  pointerAt(win, 2, 2);
  await wait(500);
  pointerAt(win, center.x, center.y);
  pointerAt(win, center.x + 2, center.y + 1);
  await wait(60);
  const early = await controlsState(win);
  await wait(300);
  const shown = await controlsState(win);
  const bounds = win.getBounds();
  const shot = path.join(dir, "hover-controls.png");
  fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
  const overCharacter = shown.buttons.some((button) => overlaps(button, b.body));
  const onDisplay = shown.buttons.every((button) => inside(onScreen(button, bounds), area));
  // away from it: they stay a moment, then go
  pointerAt(win, 2, 2);
  await wait(150);
  const lingering = await controlsState(win);
  await wait(500);
  const gone = await controlsState(win);
  // the bell: the tray opens where the chat goes; Allow reaches the brain
  pointerAt(win, center.x, center.y);
  await wait(400);
  const from = brainEvents.length;
  const bell = (await controlsState(win)).buttons.find((button) => button.control === "activity");
  // the pointer rests on the bell first, as a person's would
  pointerAt(win, bell.x + bell.width / 2, bell.y + bell.height / 2);
  await wait(250);
  await press(win, bell.x + bell.width / 2, bell.y + bell.height / 2);
  const asked = brainSince(from);
  update(snapshot({ tray: { loading: false, items: [
    { id: "a0", kind: "approval", title: "Needs you: click", detail: "Click Export in Excel", canStop: true, canOpen: true },
    { id: "r0", kind: "running", title: "Weekly report", detail: "Running · 1 min 12 s · read_file", canStop: true, canOpen: true },
  ] } }));
  await wait(700);
  const tray = await js(win, `(() => { const r = document.querySelector("[data-tray]")?.getBoundingClientRect(); return r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null; })()`);
  const trayShot = path.join(dir, "activity-tray.png");
  fs.writeFileSync(trayShot, (await win.webContents.capturePage()).toPNG());
  const allow = await js(win, `(() => { const r = document.querySelector("[data-tray-allow]")?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
  const before = brainEvents.length;
  if (allow) await press(win, allow.x, allow.y);
  const allowed = brainSince(before);
  update(snapshot());
  await wait(400);
  return {
    side: shown.side,
    before150ms: early.shown,
    shownAfterHover: shown.shown && shown.opacity > 0.9,
    controls: shown.buttons.map((button) => button.control),
    overCharacter,
    onDisplay,
    lingeringAfterLeave: lingering.shown,
    goneAfterLeave: !gone.shown,
    bellAsked: asked.some((event) => event.type === "tray" && event.open === true),
    tray,
    trayCoversCharacter: Boolean(tray && overlaps(tray, (await boxes(win)).body)),
    trayOnDisplay: Boolean(tray && inside(onScreen(tray, bounds), area)),
    allowReached: allowed.some((event) => event.type === "work" && event.action === "allow" && event.id === "a0"),
    screenshots: [shot, trayShot],
  };
}

/** The fake call of scripts/verify/dev/verify-voice-mode.ts, as the brain would show it: the person's sentence, then the bot's answer in 4 s sentences. */
const FAKE_HEARD = "Hello Quasar from voice mode";
const FAKE_ANSWER = ["Hello! I can hear you clearly from the desktop mascot.", "Ask me anything and I will answer out loud."];
function fakeCall(phase, extra = {}) {
  return {
    phase, muted: false, botAudible: phase === "speaking", push: false, startedAt: Date.now() - 8000, line: "", transcript: [], note: null, notice: null,
    settings: { voice: "eve", speed: 1, language: "auto" }, callSettings: { input: "auto", onlyMyVoice: false, earcons: true, pause: "normal" },
    voices: null, voicesError: null, enrollment: { state: "none" }, previewing: null, captions: true, ...extra,
  };
}
const captionsState = (win) => js(win, `(() => {
  const box = document.querySelector("[data-voice-captions]");
  const r = box?.getBoundingClientRect();
  return {
    box: r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null,
    chip: document.querySelector("[data-caption-chip]")?.textContent ?? null,
    lines: [...document.querySelectorAll("[data-caption-line]")].map((line) => line.textContent),
    pill: Boolean(document.querySelector("[data-voice-pill]")),
  };
})()`);

async function clickToCall(win, all) {
  const area = all[0];
  update(snapshot());
  await wait(300);
  await placeBody(win, area.x + Math.round(area.width / 2), area.y + Math.round(area.height / 2), { x: 1, y: 1 });
  const b = await boxes(win);
  const center = { x: b.body.x + b.body.width / 2, y: b.body.y + b.body.height / 2 };
  // a drag is not a click
  let from = brainEvents.length;
  await press(win, center.x, center.y, 30);
  const dragged = brainSince(from);
  const b2 = await boxes(win);
  const c2 = { x: b2.body.x + b2.body.width / 2, y: b2.body.y + b2.body.height / 2 };
  // a plain click on the idle character opens the chat and never asks for the call
  await wait(400);
  from = brainEvents.length;
  await press(win, c2.x, c2.y);
  const clicked = brainSince(from);
  const started = clicked.some((event) => event.type === "call");
  const openedChat = clicked.some((event) => event.type === "click");
  const phases = [];
  // the stand-in brain plays the fake call
  update(snapshot({ call: fakeCall("connecting") }));
  await wait(300);
  update(snapshot({ call: fakeCall("listening") }));
  await wait(300);
  phases.push({ phase: "listening", ...(await captionsState(win)) });
  update(snapshot({ call: fakeCall("hearing", { line: FAKE_HEARD }) }));
  await wait(300);
  phases.push({ phase: "hearing", ...(await captionsState(win)) });
  update(snapshot({ pose: "think", call: fakeCall("thinking", { transcript: [{ id: "m1", who: "you", text: FAKE_HEARD }] }) }));
  await wait(300);
  phases.push({ phase: "thinking", ...(await captionsState(win)) });
  update(snapshot({ pose: "speak", call: fakeCall("speaking", { line: FAKE_ANSWER[0], transcript: [{ id: "m1", who: "you", text: FAKE_HEARD }] }) }));
  await wait(200);
  const first = await captionsState(win);
  await wait(1300);
  const later = await captionsState(win);
  const bounds = win.getBounds();
  const shot = path.join(dir, "call-captions.png");
  fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
  phases.push({ phase: "speaking", ...later });
  // a click on the character while the bot is not speaking ends nothing
  update(snapshot({ call: fakeCall("listening", { transcript: [{ id: "m1", who: "you", text: FAKE_HEARD }, { id: "m2", who: "bot", text: FAKE_ANSWER[0] }] }) }));
  await wait(300);
  from = brainEvents.length;
  await press(win, c2.x, c2.y);
  const duringCall = brainSince(from);
  const end = await captionsState(win);
  update(snapshot({ call: fakeCall("speaking", { line: FAKE_ANSWER[1] }) }));
  await wait(2600);
  const second = await captionsState(win);
  const secondShot = path.join(dir, "call-captions-2.png");
  fs.writeFileSync(secondShot, (await win.webContents.capturePage()).toPNG());
  update(snapshot());
  await wait(400);
  const body = (await boxes(win)).body;
  const wordCount = (lines) => lines.join(" ").split(/\s+/).filter(Boolean).length;
  return {
    dragEvents: dragged,
    dragAskedNothing: !dragged.some((event) => event.type === "call" || event.type === "click"),
    clickStartedCall: started,
    clickOpenedChat: openedChat,
    clickEvents: clicked,
    phases: phases.map((p) => ({ phase: p.phase, chip: p.chip, lines: p.lines })),
    pill: later.pill,
    wordsAtStart: wordCount(first.lines),
    wordsAfter1500ms: wordCount(later.lines),
    revealedWordByWord: wordCount(first.lines) < wordCount(later.lines),
    captionLinesMax: Math.max(...phases.map((p) => p.lines.length), second.lines.length),
    captionsCoverCharacter: Boolean(later.box && overlaps(later.box, body)),
    captionsInWindow: Boolean(later.box && inside(later.box, { x: 0, y: 0, width: bounds.width, height: bounds.height })),
    captionsOnDisplay: Boolean(later.box && inside(onScreen(later.box, bounds), area)),
    clickDuringCall: duringCall,
    clickDuringCallEndedNothing: !duringCall.some((event) => event.type === "call" && (event.action === "end" || event.action === "start")),
    keptLastLine: end.lines.length > 0,
    screenshots: [shot, secondShot],
  };
}

app.on("window-all-closed", () => undefined);

app.whenReady().then(async () => {
  const report = { electron: process.versions.electron, platform: process.platform, displays: screen.getAllDisplays().map((d) => ({ bounds: d.bounds, workArea: d.workArea, scale: d.scaleFactor })) };
  try {
    const floats = createFloatingBotWindows({
      BrowserWindow,
      screen,
      ipcMain,
      getMainWindow: () => mainWindow,
      pageUrl: () => `${origin}/?omb-floating-bot=1`,
      preload: path.join(here, "..", "..", "..", "electron", "floating-bot-preload.cjs"),
      readPositions: () => saved,
      writePositions: (positions) => {
        saved = JSON.parse(JSON.stringify(positions));
      },
      focusMain: () => undefined,
      // main's native menu, recorded (a real one would block the run): where it opens and its template
      Menu: { buildFromTemplate: (template) => ({ popup: (options) => menuPops.push({ x: options.x, y: options.y, template }) }) },
      log: (line) => console.log(`[mascot-desktop] ${line}`),
    });
    let win = floats.open(BOT);
    update(snapshot());
    if (!(await waitFor(win, "Boolean(document.querySelector('.fb-body'))", 60000))) throw new Error("the mascot never drew");
    await wait(1500);
    const areas = screen.getAllDisplays().map((display) => display.workArea);
    if (areas.length > 1) report.seam = await seam(win, areas[0], areas[1]);
    report.corners = await corners(win, areas);
    const restarted = await restart(floats, areas[0]);
    win = restarted.win;
    report.restart = { before: restarted.before, after: restarted.after, same: restarted.same };
    report.menu = await menu(win);
    report.effects = await effects(win, areas);
    report.hoverControls = await hoverControls(win, areas);
    report.clickToCall = await clickToCall(win, areas);
    floats.dispose();
    const failures = [
      ...report.corners.filter((c) => !c.inCorner || !c.balloonOnDisplay || !c.balloonInWindow || c.balloonCoversCharacter || c.characterMovedWhenOpened > 1).map((c) => `corner ${c.display} ${c.corner}`),
      ...(report.restart.same ? [] : ["restart"]),
      ...(!report.seam || (report.seam.onSecond && report.seam.followedPx <= 1) ? [] : ["seam"]),
      ...(report.menu.danced === "dance" ? [] : ["menu move"]),
      ...report.effects.filter((e) => e.emoteOverCharacter || e.thoughtOverCharacter || !e.emoteOnDisplay).map((e) => `effects ${e.spot}`),
      ...(() => {
        const h = report.hoverControls;
        return !h.before150ms && h.shownAfterHover && !h.overCharacter && h.onDisplay && h.lingeringAfterLeave && h.goneAfterLeave && h.bellAsked && h.tray && !h.trayCoversCharacter && h.trayOnDisplay && h.allowReached ? [] : ["hover controls"];
      })(),
      ...(() => {
        const c = report.clickToCall;
        return c.dragAskedNothing && !c.clickStartedCall && c.clickOpenedChat && c.pill && c.revealedWordByWord && c.captionLinesMax <= 3 && !c.captionsCoverCharacter && c.captionsInWindow && c.captionsOnDisplay && c.clickDuringCallEndedNothing ? [] : ["click opens chat, not call"];
      })(),
    ];
    report.ok = failures.length === 0;
    report.failures = failures;
    fs.writeFileSync(out, JSON.stringify(report, null, 1));
    app.exit(report.ok ? 0 : 1);
  } catch (error) {
    console.error(`[mascot-desktop] ${error?.stack ?? error}`);
    fs.writeFileSync(out, JSON.stringify({ ...report, error: String(error?.message ?? error) }, null, 1));
    app.exit(1);
  }
});
