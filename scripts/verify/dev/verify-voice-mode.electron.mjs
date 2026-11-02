// Electron side of scripts/verify/dev/verify-voice-mode.ts. Wired like electron/main.mjs
// in server mode: the bundled-UI handler for the organization server's
// origin, the preload, and main's permission policy (app-permissions.mjs)
// with the server's origin allowed the microphone only. Chromium's fake
// capture device plays the launcher's WAV (a recorded sentence, then
// silence, looped) as the microphone.
import { app, BrowserWindow, ipcMain, net, session } from "electron";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { appPermissionAllowed } from "../../../electron/app-permissions.mjs";
import { jsLiteral } from "../../testing/js-literal.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const signIn = require("../../../electron/oidc-system-sign-in.cjs");
const environments = require("../../../electron/environments.cjs");
const bundledUi = require("../../../electron/bundled-ui.cjs");
const localOrigin = require("../../../electron/local-origin.cjs");

const origin = process.env.VERIFY_ORIGIN;
const bundle = process.env.VERIFY_BUNDLE;
const xaiUrl = process.env.VERIFY_XAI;
const fakeKey = process.env.VERIFY_FAKE_KEY;
const FAKE_LOCAL = "http://127.0.0.1:1";

app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-file-for-fake-audio-capture", process.env.VERIFY_MIC_FILE);
// the audio service's sandbox cannot read the WAV file the fake device plays
app.commandLine.appendSwitch("disable-features", "AudioServiceSandbox");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("lang", "en-US");

const log = (line) => console.log(`[voice-mode] ${line}`);
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push(ok);
  log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, predicate, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await predicate();
    if (value) return value;
    await wait(150);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const xaiRequests = async () => (await fetch(`${xaiUrl}/__requests`)).json();

let state = environments.withEnvironment({ environments: [], activeId: "local" }, { origin, name: "Example" }, () => "org");
state = environments.withActive(state, "org");
state = environments.withOrganizationUpgrade(state, { orgOrigins: new Set([origin]), serverModeChosen: true });
const handoff = signIn.createSignInHandoff();

app.whenReady().then(async () => {
  localOrigin.setLocalOrigin(FAKE_LOCAL);
  const bundled = environments.bundledOrigin(state);
  localOrigin.setBundledOrigin(bundled);
  check("server mode on an organization server", bundled === origin && environments.serverModeEnvironment(state)?.origin === origin);
  const scheme = new URL(origin).protocol.slice(0, -1);
  session.defaultSession.protocol.handle(scheme, bundledUi.createBundledUiHandler({
    origin: () => bundled, staticDir: () => bundle, devOrigin: () => null,
    fetch: (i, init) => net.fetch(i, init), readFile: (f) => readFile(f),
  }));
  // main.mjs's policy: the bundled UI's origin may open the microphone only
  const asked = [];
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const requesting = details?.requestingUrl ?? contents?.getURL?.() ?? "";
    const granted = appPermissionAllowed(permission, requesting, FAKE_LOCAL, details, { microphoneOrigins: [bundled] });
    asked.push({ permission, mediaTypes: details?.mediaTypes, granted });
    callback(granted);
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin, details) =>
    appPermissionAllowed(permission, requestingOrigin || contents?.getURL?.() || "", FAKE_LOCAL, details, { microphoneOrigins: [bundled] }));

  const win = new BrowserWindow({
    show: false, width: 1200, height: 800,
    webPreferences: {
      preload: path.join(ROOT, "electron", "preload.cjs"),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      additionalArguments: [`--omb-local-origin=${FAKE_LOCAL}`],
    },
  });
  win.webContents.on("console-message", (details) => {
    if (details.level === "error") log(`page error: ${String(details.message).slice(0, 200)}`);
  });
  ipcMain.on("workspace:bundled-ui", (event) => {
    event.returnValue = event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && new URL(event.senderFrame.url).origin === bundled;
  });
  ipcMain.handle("server-mode:state", localOrigin.desktopUiOnly("server-mode:state", () => ({ active: true, name: "Example", origin })));
  ipcMain.handle("workspaces:state", () => environments.workspaceSummary(state));
  ipcMain.handle("auth-return:take", (event, code) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return false;
    return handoff.redeem(new URL(event.senderFrame.url).origin, code);
  });
  ipcMain.handle("pulsatrix-sign-in:state", () => ({ status: "waiting", origin }));
  // Windows-like capabilities: no macOS dictation at all
  ipcMain.handle("desktop:capabilities", () => ({
    host: { platform: "win32", label: "Fixture", session: "unknown", packaged: false }, windowChrome: "native",
    screenPreview: { available: false, interaction: "none" }, dictation: { available: false, engine: "none", onDevice: false, reasonCode: "remote-server" },
    localComputer: { available: false, support: "unsupported", enabled: false, status: "unavailable" },
  }));
  ipcMain.handle("desktop:skin", () => true);
  ipcMain.handle("window:state", () => ({ maximized: false }));
  ipcMain.handle("update:get-state", () => ({ status: "idle" }));
  ipcMain.handle("org-join:staged", () => null);
  ipcMain.handle("org-join:take-preferences", () => null);
  ipcMain.on("desktop:unread-count", () => {});
  ipcMain.on("floating-bots:update", () => {});
  ipcMain.handle("floating-bots:state", () => ({ bots: [] }));

  // Sign in with Pulsatrix through the loopback return.
  await win.loadURL(`${origin}/pair`);
  await wait(1500);
  const loopback = await signIn.startLoopbackReturn({ log: () => {} });
  const start = await fetch(signIn.desktopStartUrl(origin, loopback.returnTo), { redirect: "manual" });
  const binding = start.headers.getSetCookie().find((c) => c.includes("_oidc=")).split(";")[0];
  const authorize = await fetch(start.headers.get("location"), { redirect: "manual" });
  const callback = await fetch(authorize.headers.get("location"), { redirect: "manual", headers: { cookie: binding } });
  const landing = new URL(callback.headers.get("location"));
  await fetch(`${landing.origin}${landing.pathname}`);
  await fetch(`${landing.origin}${landing.pathname}`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: landing.origin },
    body: new URLSearchParams(landing.hash.slice(1)).toString(),
  });
  const outcome = await loopback.result;
  const parsed = { origin, code: outcome.code };
  handoff.accept(parsed);
  await win.loadURL(signIn.authReturnTarget(parsed)).catch(() => {});
  const signed = await until("the session", async () => {
    const answer = await win.webContents.executeJavaScript("fetch('/api/auth/session').then(r => r.json()).catch(() => null)");
    return answer?.identity === "perspicax" ? answer : null;
  });
  check("signed in to the organization server", true, `role ${signed.role}`);
  await until("the app home", async () => new URL(win.webContents.getURL()).pathname === "/");

  // A bot named Quasar, opened in the app.
  const created = await win.webContents.executeJavaScript(`fetch("/api/bots", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Quasar" }) }).then(async r => ({ status: r.status, body: await r.json() }))`);
  const bot = created.body?.bot ?? created.body;
  check("a bot is created on the server", created.status < 300 && typeof bot?.id === "string", `HTTP ${created.status}`);
  await win.webContents.executeJavaScript(`location.href = ${jsLiteral(`/#thread=${bot.threadId}&bot=${bot.id}`)}; location.reload(); true`);
  win.show();
  // the welcome tour of a first sign-in covers the app: skip it
  await until("the welcome tour", async () => win.webContents.executeJavaScript(`(() => {
    const skip = [...document.querySelectorAll("button")].find((b) => /skip tour/i.test(b.textContent ?? ""));
    if (skip) skip.click();
    return Boolean(skip) || Boolean(document.querySelector('[data-call-target]'));
  })()`), 15_000).catch(() => null);
  const callButton = () => win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector(${jsLiteral(`[data-call-target="${bot.id}"]`)});
    return el ? { voiceMode: el.dataset.voiceMode ?? null, label: el.getAttribute("aria-label") } : null;
  })()`);

  // 1. No xAI key anywhere: the server says so, and the button shows the speaker's access card.
  const refused = await win.webContents.executeJavaScript(`fetch(${jsLiteral(`/api/bots/${bot.id}/voice/status`)}).then(r => r.json())`);
  check("without any xAI key the server answers: organization, unavailable, no credentials, admin", refused.organization === true && refused.available === false && refused.refusal?.cause === "no_credentials" && refused.refusal?.admin === true, JSON.stringify(refused));
  await until("the call button", async () => (await callButton())?.voiceMode === "unavailable", 20_000).catch(() => null);
  await win.webContents.executeJavaScript(`document.querySelector(${jsLiteral(`[data-call-target="${bot.id}"]`)}).click(); true`);
  const card = await until("the access card popover", async () => win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector("[data-voice-unavailable]");
    return el ? { cause: el.dataset.voiceUnavailable, text: el.innerText, actions: [...el.querySelectorAll("[data-voice-action]")].map((b) => b.dataset.voiceAction) } : null;
  })()`), 10_000).catch(() => null);
  check("the popover is the speaker's access card, never the legacy This computer gate", card?.cause === "no_credentials" && /xAI key/.test(card.text) && !/This computer|on-device|your Mac/i.test(card.text), JSON.stringify(card));
  check("an admin also reads the organization's key hint and gets Open Settings > Connections", /As an admin/.test(card?.text ?? "") && (card?.actions ?? []).includes("open-connections"), JSON.stringify(card?.actions));
  const noBar = await win.webContents.executeJavaScript(`!document.querySelector("[data-voice-bar]")`);
  check("no voice bar opens without a key", noBar);
  await win.webContents.executeJavaScript(`document.querySelector('[data-voice-action="open-connections"]').click(); true`);
  const settingsOpen = await until("Settings > Connections", async () => win.webContents.executeJavaScript(`/Models|Modèles/.test(document.body.innerText) && Boolean(document.querySelector('[role=dialog]'))`), 5_000).catch(() => false);
  check("Open Settings > Connections opens the settings", settingsOpen);
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await wait(500);

  // 2. The admin adds the xAI key (Settings > Models). Grok voice uses it (2026-10-14).
  const put = await win.webContents.executeJavaScript(`fetch("/api/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ xai: { key: ${jsLiteral(fakeKey)} } }) }).then(r => r.status)`);
  check("the admin saves the xAI key", put < 300, `HTTP ${put}`);
  const status = await win.webContents.executeJavaScript(`fetch(${jsLiteral(`/api/bots/${bot.id}/voice/status`)}).then(r => r.text())`);
  check("voice mode is available with the xAI key, and the status carries no key", status.includes('"available":true') && status.includes('"via":"org-key"') && !status.includes(fakeKey.slice(8, 20)), status);
  const button = await callButton();
  check("the call button asks the server again on click (it still shows the old answer)", button?.voiceMode === "unavailable", JSON.stringify(button));

  await win.webContents.executeJavaScript(`localStorage.setItem("omb.voiceCall.debug", "1"); true`);
  // Open the bar, muted first, then choose Voice, Speed and Language in its panel.
  await win.webContents.executeJavaScript(`document.querySelector(${jsLiteral(`[data-call-target="${bot.id}"]`)}).click(); true`);
  await until("the voice bar", async () => win.webContents.executeJavaScript(`Boolean(document.querySelector("[data-voice-bar]"))`));
  await win.webContents.executeJavaScript(`document.querySelector("[data-voice-mute]").click(); true`);
  check("the same button, asking the server again, opens the voice bar above the composer", true);
  const micGranted = await until("the microphone permission", async () => asked.find((entry) => entry.permission === "media") ?? null, 10_000).catch(() => null);
  check("the page asked for the microphone and main's policy granted audio only", Boolean(micGranted?.granted) && (micGranted.mediaTypes ?? ["audio"]).every((type) => type === "audio"), JSON.stringify(micGranted));
  const click = (selector) => win.webContents.executeJavaScript(`(() => { const el = document.querySelector(${jsLiteral(selector)}); if (!el) return false; el.click(); return true; })()`);
  const pickOption = (list, value) => win.webContents.executeJavaScript(`(() => {
    const row = document.querySelector(${jsLiteral(`[data-voice-settings] [role=listbox] [data-value="${value}"]`)});
    const button = row && [...row.querySelectorAll("button")].find((b) => !b.dataset.preview);
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await click("[data-voice-gear]");
  await click('[data-voice-list="voice"]');
  const listed = await until("xAI's voices in the panel", async () => win.webContents.executeJavaScript(`[...document.querySelectorAll('[data-voice-settings] [data-preview]')].map((el) => el.dataset.preview)`).then((ids) => (ids.length ? ids : null)), 10_000).catch(() => []);
  check("the Voice list shows xAI's voices, each with a preview button, and Not set", JSON.stringify(listed) === JSON.stringify(["altair", "ara", "atlas", "eve"]), JSON.stringify(listed));
  await pickOption("voice", "ara");
  await click('[data-voice-list="speed"]');
  await pickOption("speed", "1.25");
  await click('[data-voice-list="language"]');
  await pickOption("language", "fr");
  const saved = await win.webContents.executeJavaScript(`localStorage.getItem("omb.voiceMode.v1")`);
  check("the choices are saved on this device", saved === JSON.stringify({ voice: "ara", speed: 1.25, language: "fr" }), saved);
  const onServer = await until("the choices on the server", async () => {
    const record = await win.webContents.executeJavaScript(`fetch("/api/me/preferences").then(r => r.json())`);
    return record.preferences?.["omb.voiceMode.v1"] === saved ? record : null;
  }, 15_000).catch(() => null);
  check("and saved for the person on the server (they follow them to Windows or the Mac)", Boolean(onServer));

  // Preview Ara: xAI speech with the chosen voice, speed and language, on the organization's key.
  await click('[data-voice-list="voice"]');
  await until("the preview button", async () => click('[data-preview="ara"]'), 5_000);
  const tts = await until("xAI's speech request", async () => (await xaiRequests()).find((r) => r.path === "/v1/tts" && !r.websocket) ?? null, 10_000).catch(() => null);
  check("a preview asks xAI for speech with voice ara, speed 1.25, language fr", tts?.json?.voice_id === "ara" && tts.json.speed === 1.25 && tts.json.language === "fr", JSON.stringify(tts?.json));
  check("xAI received the organization's key from the server", tts?.authorization === `Bearer ${fakeKey}`);

  // Unmute: the microphone hears a turn, its audio streams to xAI's streaming
  // speech to text through the server, and the words reach the bot as the person.
  // In the page, "the bot" answers the moment the words are sent (an instant
  // engine), so the time to first audio is the voice pipeline's own.
  await win.webContents.executeJavaScript(`(() => {
    const call = window.__sagaxVoiceCall;
    window.__voiceTurns = [];
    window.__voiceMetrics = [];
    call.on("metrics", (turn) => { if (turn) window.__voiceMetrics.push({ ...turn }); });
    call.on("utterance", (text) => {
      window.__voiceTurns.push({ text, at: performance.now() });
      if (window.__voiceTurns.length === 1) {
        // a long answer: three sentences of about four seconds each
        void call.replyDone("Here is the first part of a long answer. Here is the second part of it. And here is the third part.");
      }
    });
    return true;
  })()`);
  await click("[data-voice-gear]");
  await click("[data-voice-mute]");
  const firstTurn = await until("the first spoken turn", async () => win.webContents.executeJavaScript(`window.__voiceTurns[0] ?? null`), 30_000).catch(() => null);
  check("the person's first turn is heard (Silero VAD on this computer, streaming speech to text)", firstTurn?.text === "Hello Quasar from voice mode", JSON.stringify(firstTurn));
  const models = await win.webContents.executeJavaScript(`document.querySelector("[data-voice-bar]")?.dataset.voiceModels ?? null`);
  check("the on-device models loaded from the app's bundle (no CDN)", models === "on-device", String(models));
  const socket = await until("xAI's streaming socket", async () => (await xaiRequests()).find((r) => r.websocket && r.path === "/v1/stt" && r.query?.language === "fr" && r.finalizes > 0) ?? null, 10_000).catch(() => null);
  check("the turn streamed to xAI speech to text (wss /v1/stt) with the language hint fr, on the server's key", Boolean(socket) && socket.query?.language === "fr" && socket.audioBytes > 16_000 && socket.authorization === `Bearer ${fakeKey}`, JSON.stringify(socket && { query: socket.query, audioBytes: socket.audioBytes, finalizes: socket.finalizes }));
  const sent = await until("the spoken message on the thread", async () => {
    const page = await win.webContents.executeJavaScript(`fetch(${jsLiteral(`/api/threads/${bot.threadId}/messages`)}).then(r => r.json()).catch(() => null)`);
    const list = Array.isArray(page) ? page : page?.messages ?? [];
    return list.find((message) => message.role === "user" && String(message.text ?? "").includes("Hello Quasar from voice mode")) ?? null;
  }, 20_000).catch(() => null);
  check("what was said reaches the bot's thread as the signed-in person (the normal send route)", Boolean(sent) && Boolean(sent.sender?.id), sent ? `sender ${sent.sender?.name ?? sent.sender?.id}` : "none");
  const latency = await until("the first audio of the answer", async () => win.webContents.executeJavaScript(`(() => {
    const bar = document.querySelector("[data-voice-bar]");
    return bar?.dataset.voiceFirstAudioMs ? { firstAudio: Number(bar.dataset.voiceFirstAudioMs), sent: Number(bar.dataset.voiceSentMs), endpoint: Number(bar.dataset.voiceEndpointMs) } : null;
  })()`), 15_000).catch(() => null);
  check("first audio of the answer under 1.5 s after the person stopped talking (instant engine)", Boolean(latency) && latency.firstAudio < 1500, JSON.stringify(latency));
  // Faster end of turn: "Hello Quasar from voice mode" carries no
  // punctuation; the recording's falling, fading end ends the turn on the
  // short confident window (352 ms) instead of the 560 to 1100 ms endpoint
  const firstMetrics = await win.webContents.executeJavaScript(`(() => { const m = window.__voiceMetrics.find((t) => t.sentAt !== undefined); return m ? { endpoint: Math.round(m.endedAt - m.stoppedAt), contour: m.contour ?? null, contourEnd: m.contourEnd ?? false, earlyEnd: m.earlyEnd ?? false } : null; })()`);
  check("no punctuation: the voice's falling end ends the turn on the short window (Faster end of turn)", firstMetrics?.contourEnd === true && firstMetrics.endpoint > 0 && firstMetrics.endpoint < 450, JSON.stringify(firstMetrics));
  // Streaming voice: one xAI text to speech socket for the call, clause by clause
  const ttsSockets = () => xaiRequests().then((all) => all.filter((r) => r.websocket && r.path === "/v1/tts"));
  // the call opened its socket with the settings of the call's start; the
  // panel's Ara, 1.25x, fr opened one for them before the first answer
  const speechSockets = (await ttsSockets()).filter((r) => (r.utterances ?? []).length);
  const spoken = speechSockets.flatMap((r) => r.utterances ?? []);
  check("the answer is spoken over one xAI streaming text to speech socket (wss /v1/tts), PCM, lowest latency, Ara, 1.25x, fr",
    speechSockets.length === 1 && spoken.length >= 1 && speechSockets.every((r) => r.query?.voice === "ara" && r.query?.speed === "1.25" && r.query?.language === "fr" && r.query?.codec === "pcm" && r.query?.optimize_streaming_latency === "2" && r.authorization === `Bearer ${fakeKey}`),
    JSON.stringify((await ttsSockets()).map((r) => ({ query: r.query, utterances: r.utterances }))));
  const posted = (await xaiRequests()).filter((r) => r.path === "/v1/tts" && !r.websocket && r.json?.output_format?.codec === "pcm");
  check("no sentence of the answer went over POST while the socket held", posted.length === 0, `${posted.length} POST sentence(s)`);
  const speaking = await until("the bot speaking", async () => win.webContents.executeJavaScript(`document.querySelector("[data-voice-bar]")?.dataset.voicePhase === "speaking"`), 10_000).catch(() => false);
  check("the bar says the bot is speaking", speaking);

  // Barge-in: the microphone's next sentence comes while the bot is still talking.
  const barge = await until("the barge-in", async () => win.webContents.executeJavaScript(`(() => {
    const bar = document.querySelector("[data-voice-bar]");
    return bar?.dataset.voiceBargeinMs ? { duck: Number(bar.dataset.voiceDuckMs), cancel: Number(bar.dataset.voiceBargeinMs), phase: bar.dataset.voicePhase } : null;
  })()`), 30_000).catch(() => null);
  check("talking over the bot ducks it at once and cuts it within 250 ms of the first voiced frame", Boolean(barge) && barge.duck <= 50 && barge.cancel <= 250, JSON.stringify(barge));
  const secondTurn = await until("the turn after the barge-in", async () => win.webContents.executeJavaScript(`window.__voiceTurns[1] ?? null`), 20_000).catch(() => null);
  check("the words said over the bot become the next turn", secondTurn?.text === "Hello Quasar from voice mode", JSON.stringify(secondTurn));
  const afterCut = (await ttsSockets()).filter((r) => (r.utterances ?? []).length);
  const ttsAfter = afterCut.flatMap((r) => r.utterances ?? []).length + (await xaiRequests()).filter((r) => r.path === "/v1/tts" && !r.websocket && r.json?.output_format?.codec === "pcm").length;
  check("the rest of the cut answer was not synthesized again", ttsAfter <= 3, `${ttsAfter} sentence request(s)`);
  check("the barge-in cleared the clause speaking at xAI (text.clear), on the same socket", afterCut.length === 1 && (afterCut[0].clears ?? 0) >= 1, JSON.stringify(afterCut.map((r) => ({ clears: r.clears, utterances: r.utterances?.length }))));

  // Hold (in the pill's settings card): silence both ways, then resume.
  await click("[data-voice-gear]");
  await click("[data-voice-hold]");
  const held = await until("on hold", async () => win.webContents.executeJavaScript(`document.querySelector("[data-voice-bar]")?.dataset.voicePhase === "held"`), 5_000).catch(() => false);
  check("hold puts the call on hold", held);
  await click("[data-voice-hold]");
  const resumed = await until("resumed", async () => win.webContents.executeJavaScript(`document.querySelector("[data-voice-bar]")?.dataset.voicePhase !== "held"`), 5_000).catch(() => false);
  check("resume takes it off hold", resumed);
  // Escape closes the expanded card.
  await win.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true`);
  const closed = await until("the card to close", async () => win.webContents.executeJavaScript(`document.querySelector("[data-voice-bar]")?.dataset.voicePanel === "none"`), 3_000).catch(() => false);
  check("Escape folds the card back into the pill", closed);

  // The pill: centered at the top of the chat, under the name chip, never clipped.
  const pillBox = () => win.webContents.executeJavaScript(`(() => {
    const pill = document.querySelector("[data-voice-pill]")?.getBoundingClientRect();
    const column = document.querySelector("[data-voice-call-dock]")?.parentElement?.getBoundingClientRect();
    const chip = document.querySelector(".content-topbar button")?.getBoundingClientRect();
    if (!pill || !column || !chip) return null;
    return { left: pill.left - column.left, right: column.right - pill.right, top: pill.top, chipBottom: chip.bottom, center: Math.abs((pill.left + pill.right) / 2 - (column.left + column.right) / 2), height: pill.height };
  })()`);
  const checkPill = async (label) => {
    const box = await pillBox();
    check(`${label}: the pill is centered under the name chip, compact, with at least 12px each side`, Boolean(box) && box.center <= 2 && box.left >= 11.5 && box.right >= 11.5 && box.top >= box.chipBottom && box.height >= 62 && box.height <= 70, JSON.stringify(box));
  };
  await wait(400); // the card's fold back (200 ms) is over
  await checkPill("wide");

  // Streaming voice fallback: xAI's socket drops and will not come back. The
  // server tries 3 reconnects with a backoff, then tells the page, which
  // speaks over POST /voice/stream for the rest of the call.
  const socketsBefore = (await ttsSockets()).length;
  await fetch(`${xaiUrl}/__speech`, { method: "POST", body: JSON.stringify({ refuse: true, dropAfter: 1 }) });
  await win.webContents.executeJavaScript(`void window.__sagaxVoiceCall.say("This sentence makes the socket drop."); true`);
  const tries = await until("the reconnect attempts", async () => ((await ttsSockets()).length - socketsBefore >= 3 ? (await ttsSockets()).length - socketsBefore : null), 15_000).catch(async () => (await ttsSockets()).length - socketsBefore);
  await wait(500);
  await win.webContents.executeJavaScript(`void window.__sagaxVoiceCall.say("And this one is spoken after it."); true`);
  const fellBack = await until("the POST fallback", async () => {
    const posts = (await xaiRequests()).filter((r) => r.path === "/v1/tts" && !r.websocket && r.json?.output_format?.codec === "pcm");
    return posts.some((r) => /spoken after it/.test(String(r.json.text))) ? posts : null;
  }, 10_000).catch(() => null);
  const triesAfter = (await ttsSockets()).length - socketsBefore;
  check("when xAI's speech socket drops for good, the call speaks over POST (3 reconnects, then fallback)", Boolean(fellBack) && tries === 3 && triesAfter === 3 && fellBack.every((r) => r.json.voice_id === "ara" && r.json.speed === 1.25 && r.json.language === "fr"), `${triesAfter} reconnect attempt(s), ${fellBack?.length ?? 0} POST sentence(s)`);
  await fetch(`${xaiUrl}/__speech`, { method: "POST", body: JSON.stringify({ refuse: false, dropAfter: 0 }) });
  const stillOn = await win.webContents.executeJavaScript(`document.querySelector("[data-voice-bar]")?.dataset.voicePhase ?? null`);
  check("the call itself carries on after the fallback", Boolean(stillOn) && stillOn !== "ended", String(stillOn));

  const other = (await xaiRequests()).filter((r) => !["/v1/tts", "/v1/tts/voices", "/v1/stt"].includes(r.path));
  check("xAI was never asked to answer (only speech to text and text to speech)", other.length === 0, JSON.stringify(other.map((r) => r.path)));
  console.log(`[voice-mode] metrics ${JSON.stringify({ latency, barge })}`);

  // The key never reaches the page.
  const page = await win.webContents.executeJavaScript(`JSON.stringify({ html: document.documentElement.outerHTML, local: { ...localStorage }, session: { ...sessionStorage } })`);
  check("the xAI key is nowhere in the page", !page.includes(fakeKey.slice(8, 20)));

  // Narrow window (about 530px): the pill still fits, waveform first to give.
  const [width, height] = win.getContentSize();
  const shotDir = process.env.VERIFY_SHOT_DIR;
  const { mkdirSync, writeFileSync } = await import("node:fs");
  if (shotDir) mkdirSync(shotDir, { recursive: true });
  const shoot = async (name) => {
    if (!shotDir) return;
    await wait(500);
    writeFileSync(path.join(shotDir, name), (await win.webContents.capturePage()).toPNG());
  };
  // The card's motion, frame by frame: `action` runs in the page, then each
  // animation frame for 450 ms records the pill row, the card's clip
  // (height, opacity) and how far the transcript is from its last line.
  // With VERIFY_SHOT_DIR, screenshots are taken while it plays.
  const sampleCard = async (action, frames = "") => {
    const sampling = win.webContents.executeJavaScript(`new Promise((resolve) => {
      const samples = [];
      const start = performance.now();
      const tick = () => {
        const row = document.querySelector("[data-voice-pill-row]")?.getBoundingClientRect();
        const shell = document.querySelector("[data-voice-card-motion]");
        const scroller = document.querySelector("[data-voice-callbar-panels]");
        samples.push({
          t: Math.round(performance.now() - start), rowTop: row?.top, rowHeight: row?.height,
          h: shell ? Math.round(shell.getBoundingClientRect().height * 10) / 10 : 0,
          opacity: shell ? Number(getComputedStyle(shell).opacity) : 0,
          adv: Math.round((document.querySelector("[data-voice-advanced-body]")?.getBoundingClientRect().height ?? 0) * 10) / 10,
          fromEnd: scroller && document.querySelector("[data-voice-card-body=transcript]") ? Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop) : null,
        });
        if (performance.now() - start < 450) requestAnimationFrame(tick); else resolve(samples);
      };
      ${action};
      requestAnimationFrame(tick);
    })`);
    if (shotDir && frames) {
      const started = Date.now();
      for (let i = 0; i < 8; i++) {
        const png = (await win.webContents.capturePage()).toPNG();
        writeFileSync(path.join(shotDir, `${frames}-${String(i).padStart(2, "0")}-${Date.now() - started}ms.png`), png);
      }
    }
    return sampling;
  };
  const rowStill = (samples) => samples.every((s) => s.rowTop === samples[0].rowTop && s.rowHeight === samples[0].rowHeight);
  const brief = (samples) => samples.map((s) => `${s.t}:${s.h}/${s.opacity.toFixed(2)}${s.fromEnd === null ? "" : `/${s.fromEnd}`}`).join(" ");
  for (const [size, w] of [["wide", width], ["narrow", 530]]) {
    win.setContentSize(w, height);
    await wait(600);
    if (size === "narrow") await checkPill("narrow (530px)");
    await shoot(`voice-pill-${size}-collapsed.png`);
    if (size === "wide") {
      const open = await sampleCard(`document.querySelector("[data-voice-transcript-toggle]").click()`, "open-transcript");
      const final = open.at(-1).h;
      const grows = open.every((s, i) => i === 0 || s.h >= open[i - 1].h - 0.5);
      check("the transcript card grows from the row's bottom edge to its measured height, the row never moving", rowStill(open) && grows && open[0].h < final * 0.5 && final > 40 && open.at(-1).opacity === 1, brief(open));
      check("the transcript is on its last line before it shows (no visible scroll jump)", open.filter((s) => s.h > 0).every((s) => s.fromEnd !== null && s.fromEnd <= 1), brief(open));
      await wait(200);
      const swap = await sampleCard(`document.querySelector("[data-voice-gear]").click()`, "swap-to-settings");
      const floor = Math.min(final, swap.at(-1).h) - 1;
      check("Transcript to Settings cross-fades in place, never folding to zero", rowStill(swap) && swap.every((s) => s.h >= floor), brief(swap));
      const fold = await sampleCard(`document.querySelector("[data-voice-gear]").click()`, "close-settings");
      const shrinks = fold.every((s, i) => i === 0 || s.h <= fold[i - 1].h + 0.5);
      check("closing folds the card back into the row, the row never moving", rowStill(fold) && shrinks && fold.at(-1).h === 0, brief(fold));
      await wait(200);
    }
    await click("[data-voice-transcript-toggle]");
    const lines = await win.webContents.executeJavaScript(`[...document.querySelectorAll("[data-voice-line]")].map((el) => el.dataset.voiceLine)`);
    check(`${size}: the transcript opens as bubbles, the person on the right, the bot on the left`, lines.includes("you") && lines.includes("bot"), JSON.stringify(lines));
    await shoot(`voice-pill-${size}-transcript.png`);
    await click("[data-voice-gear]");
    const panel = await win.webContents.executeJavaScript(`document.querySelector("[data-voice-bar]")?.dataset.voicePanel`);
    check(`${size}: Settings swaps the card to Voice, Speed and Language`, panel === "settings", String(panel));
    await shoot(`voice-pill-${size}-settings.png`);
    if (size === "wide") {
      // Advanced (closed by default) opens inside the card: the card follows
      // its height smoothly, the row never moving.
      const before = await win.webContents.executeJavaScript(`document.querySelector("[data-voice-advanced]")?.dataset.voiceAdvanced`);
      const grow = await sampleCard(`document.querySelector("[data-voice-advanced-toggle]").click()`, "advanced-open");
      const opened = await win.webContents.executeJavaScript(`document.querySelector("[data-voice-advanced]")?.dataset.voiceAdvanced`);
      // the zone itself grows over several frames; the card follows it up to its own cap (then scrolls)
      const steady = grow.every((s, i) => i === 0 || (s.h >= grow[i - 1].h - 0.5 && s.adv >= grow[i - 1].adv - 0.5));
      const switches = await win.webContents.executeJavaScript(`["only-my-voice", "earcons", "thinking-cue"].every((d) => document.querySelector('[data-voice-advanced-body] [data-voice-toggle="' + d + '"] [role=switch]')) && !document.querySelector('[data-voice-settings] input[type=checkbox]')`);
      check("Advanced is closed by default and opens smoothly inside the card, its on/off rows as switches", before === "closed" && opened === "open" && switches && rowStill(grow) && steady && grow[0].adv < 1 && grow.at(-1).adv > 80 && grow.filter((s, i) => i > 0 && s.adv > grow[i - 1].adv + 0.5).length >= 4, grow.map((s) => `${s.t}:${s.h}/${s.adv}`).join(" "));
      await shoot("voice-pill-wide-settings-advanced.png");
      await click("[data-voice-advanced-toggle]");
      await wait(300);
    }
    await win.webContents.executeJavaScript(`document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); true`);
    const outside = await until("a click outside to close the card", async () => win.webContents.executeJavaScript(`document.querySelector("[data-voice-bar]")?.dataset.voicePanel === "none"`), 3_000).catch(() => false);
    check(`${size}: a click outside folds the card back`, outside);
  }
  win.setContentSize(width, height);
  await wait(300);

  // End: the bar goes away.
  await click("[data-voice-end]");
  const ended = await until("the bar to close", async () => win.webContents.executeJavaScript(`!document.querySelector("[data-voice-bar]")`), 5_000).catch(() => false);
  check("the red X ends voice mode", ended);

  const ok = checks.every(Boolean);
  console.log(`[verify] ${ok ? "PASS" : "FAIL"} (${checks.filter(Boolean).length}/${checks.length})`);
  app.exit(ok ? 0 : 1);
}).catch((error) => {
  console.log(`[verify] FAIL ${error?.stack ?? error}`);
  app.exit(1);
});
