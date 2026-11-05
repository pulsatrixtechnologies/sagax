// Real-Electron check of voice mode in server mode: the desktop draws its
// own bundled UI on an organization server's origin, signs in, opens the
// voice bar on a bot, hears a turn through the microphone (Chromium's fake
// capture device, fed a recorded sentence then silence, looped), streams it
// to "xAI" speech to text through the server (a loopback fake), and the words
// reach the bot's thread as the signed-in person. Then the live call: the
// turn (no punctuation) ends on the recording's falling end, the answer is
// spoken clause by clause over one streaming voice socket (time to first
// audio measured), the next sentence on the microphone barges in while the
// bot talks (duck and cut measured, the clause cleared at xAI), hold and
// resume, the POST fallback once xAI's speech socket drops for good, and
// xAI is never asked to answer. The settings panel's
// Voice, Speed and Language go to xAI's speech request and to the person's
// server preferences. First without any xAI key: the call button shows the
// speaker's access card (never the legacy "This computer" gate); then the
// admin adds the organization's key (Settings > Connections) and the same
// button opens the bar. The key (a fake) must never reach the page.
// Isolated: temporary home and Electron profile, free ports.
//
//   pnpm exec vite build
//   node --experimental-strip-types scripts/verify/dev/verify-voice-mode.ts
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startFakeOidcProvider } from "../../../server/testing/fake-oidc-provider.ts";
import { startFakeXaiVoice } from "../../../server/testing/fake-xai-voice.ts";
import { freePortBlock } from "../../../server/testing/ports.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const electron = createRequire(import.meta.url)("electron") as unknown as string;
const RESERVED = [18790, 5199, 8799];
// fake: long and distinct so any fragment of it would be caught
const FAKE_KEY = "xai-VERIFYfakeKq7Zp2Lw9Rt4Mn6Bv";

const idp = await startFakeOidcProvider({ user: { sub: "01J9VERIFYVOICEMODE0000000", email: "ada@example.test", name: "Ada", preferred_username: "ada", role: "admin" } });
// each streamed sentence of the answer lasts 4 s, made in real time: long
// enough to talk over while it is still being made
const xai = await startFakeXaiVoice({ transcript: "Hello Quasar from voice mode", ttsSeconds: 4, ttsChunkMs: 100 });
const port = await freePortBlock([0, 1]);
if (RESERVED.includes(port) || RESERVED.includes(port + 1)) throw new Error("reserved port, run again");
const origin = `http://127.0.0.1:${port}`;
const home = mkdtempSync(join(tmpdir(), "omb-verify-voice-"));
mkdirSync(join(home, ".openmausbot"), { recursive: true });
writeFileSync(join(home, ".openmausbot", "config.json"), "{}");
const decoy = mkdtempSync(join(tmpdir(), "omb-verify-voice-decoy-"));
writeFileSync(join(decoy, "index.html"), "<!doctype html><title>SERVER IMAGE UI</title>");

// What the microphone hears: a recorded sentence (2.3 s), then 3.5 s of
// silence, looped by Chromium: the person speaks every 5.8 s.
const speech = readFileSync(join(ROOT, "src", "lib", "voice-mode", "fixtures", "speaker-a-1.wav"));
const dataAt = speech.indexOf("data") + 8;
const voiced = new Int16Array(speech.buffer.slice(speech.byteOffset + dataAt, speech.byteOffset + speech.length));
const rate = 16_000;
const samples = new Int16Array(voiced.length + Math.round(rate * 3.5));
samples.set(voiced, 0);
const wav = Buffer.alloc(44 + samples.length * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(36 + samples.length * 2, 4); wav.write("WAVE", 8); wav.write("fmt ", 12);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(samples.length * 2, 40);
for (let i = 0; i < samples.length; i++) wav.writeInt16LE(samples[i]!, 44 + i * 2);
const micFile = join(home, "mic.wav");
writeFileSync(micFile, wav);

let serverLog = "";
const server: ChildProcess = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server", "index.ts")], {
  cwd: ROOT,
  env: {
    PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1),
    SAGAX_STATIC_DIR: decoy, SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: idp.issuer, SAGAX_PUBLIC_URL: origin,
    // the fake xAI; the organization's key is added in Settings > Connections during the run
    SAGAX_XAI_TTS_API: `${xai.url}/v1`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout!.on("data", (c) => (serverLog += c));
server.stderr!.on("data", (c) => (serverLog += c));
const deadline = Date.now() + 30_000;
for (;;) {
  try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch { /* not yet */ }
  if (Date.now() > deadline) throw new Error(`server never came up:\n${serverLog}`);
  await new Promise((r) => setTimeout(r, 200));
}
console.log(`[verify] organization server ${origin}, fake xAI ${xai.url}`);

const userData = mkdtempSync(join(tmpdir(), "omb-verify-voice-ud-"));
const code = await new Promise<number>((resolve) => {
  const child = spawn(electron, [join(ROOT, "scripts", "verify", "dev", "verify-voice-mode.electron.mjs"), `--user-data-dir=${userData}`], {
    env: { ...process.env, VERIFY_ORIGIN: origin, VERIFY_BUNDLE: join(ROOT, "dist"), VERIFY_XAI: xai.url, VERIFY_FAKE_KEY: FAKE_KEY, VERIFY_MIC_FILE: micFile },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (status) => resolve(status ?? 1));
});
server.kill("SIGTERM");
await idp.close();
await xai.close();
if (serverLog.includes(FAKE_KEY.slice(8, 20))) {
  console.log("[verify] FAIL: the xAI key reached the server log");
  process.exit(1);
}
process.exit(code);
