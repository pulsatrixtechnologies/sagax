// The speech helper's owner lifeline (port of upstream #3840): the helper is
// started through LaunchServices, so it outlives a crashed app unless it can
// tell the app died. The app holds the only writer of a FIFO the helper
// reads; EOF there stops the helper. These tests drive electron/speech.mjs in
// a child process with `electron` and `spawn` replaced, and a real mkfifo.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { closeSync, constants, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const speechUrl = new URL("./speech.mjs", import.meta.url).href;

const ownerSource = `
import { registerHooks } from "node:module";
const moduleURL = (source) => "data:text/javascript," + encodeURIComponent(source);
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith("/speech.mjs")) {
    if (specifier === "electron") return { shortCircuit: true, url: moduleURL(
      "export const app = { isPackaged: true, getPath: () => process.argv[2] };") };
    if (specifier === "node:child_process") return { shortCircuit: true, url: moduleURL(\`
      import { EventEmitter } from "node:events";
      export { execFile } from "node:child_process";
      export function spawn(file, args) {
        globalThis.speechProc = new EventEmitter();
        process.send({ type: "launch", file, args });
        return globalThis.speechProc;
      }
    \`) };
  }
  return next(specifier, context);
} });
Object.defineProperty(process, "platform", { value: "darwin" });
process.resourcesPath = "/synthetic-speech-resources";
const speech = await import(${JSON.stringify(speechUrl)});
const win = { isDestroyed: () => false, webContents: { send: (channel, info) => process.send({ type: "send", channel, info }) } };
process.on("message", (command) => {
  if (command === "start") speech.startSpeech(win);
  if (command === "start-stop") { speech.startSpeech(win); speech.stopSpeech(); setTimeout(() => process.send({ type: "settled" }), 300); }
  if (command === "close") globalThis.speechProc.emit("close", 0);
  if (command === "exit") process.exit(0);
});
process.send({ type: "ready" });
`;

async function owner(t) {
  const root = mkdtempSync(path.join(tmpdir(), "sagax-speech-owner-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, "owner.mjs");
  writeFileSync(script, ownerSource);
  const temp = path.join(root, "temp");
  mkdirSync(temp);
  const child = fork(script, [temp], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const messages = [];
  child.on("message", (message) => messages.push(message));
  const next = async (type) => {
    for (;;) {
      const found = messages.findIndex((message) => message.type === type);
      if (found >= 0) return messages.splice(found, 1)[0];
      await once(child, "message");
    }
  };
  await next("ready");
  return { child, next, temp, messages };
}

test("the helper gets a lifeline whose only writer is the app, and the session is cleaned on close", { skip: process.platform === "win32" }, async (t) => {
  const { child, next } = await owner(t);
  child.send("start");
  const launch = await next("launch");
  const at = launch.args.indexOf("--lifeline-file");
  assert.ok(at > 0, "the helper is told where its lifeline is");
  const fifo = launch.args[at + 1];
  assert.ok(statSync(fifo).isFIFO(), "the lifeline is a FIFO");
  const reader = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    // With the app's writer open, a read finds nothing yet (EAGAIN), not EOF.
    assert.throws(() => readSync(reader, Buffer.alloc(1)), { code: "EAGAIN" });
  } finally {
    closeSync(reader);
  }
  child.send("close");
  const ended = await next("send");
  assert.equal(ended.channel, "speech:end");
  assert.equal(existsSync(path.dirname(fifo)), false, "the session folder is removed");
});

test("a reader sees EOF once the app is gone", { skip: process.platform === "win32" }, async (t) => {
  const { child, next } = await owner(t);
  child.send("start");
  const launch = await next("launch");
  const fifo = launch.args[launch.args.indexOf("--lifeline-file") + 1];
  const reader = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    child.kill("SIGKILL");
    await once(child, "exit");
    assert.equal(readSync(reader, Buffer.alloc(1)), 0, "EOF: the helper stops");
  } finally {
    closeSync(reader);
  }
});

test("stopping before the helper launched starts nothing and leaves no session behind", { skip: process.platform === "win32" }, async (t) => {
  const { child, next, temp, messages } = await owner(t);
  child.send("start-stop");
  await next("settled");
  assert.equal(messages.some((message) => message.type === "launch"), false);
  assert.deepEqual(readdirSync(temp), []);
});
