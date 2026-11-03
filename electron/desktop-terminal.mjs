// The desktop's side of the in-chat terminal (organization server; the
// server side is server/desktop/desktop-terminal.ts). The person opened a terminal
// on this computer, or on its Local VM, from their own conversation; the
// server sends a one-time ticket through the bridge, and this app connects
// OUT with a WebSocket signed in as the person (their session cookie and the
// bridge secret), then runs the shell here in a terminal (electron/script-pty.mjs).
//
// Frames: binary = terminal bytes both ways; text from the server = a resize.
import os from "node:os";

import { spawnScriptPty } from "./script-pty.mjs";

const TICKET = /^[a-f0-9]{48}$/;
const OPEN_TIMEOUT_MS = 15_000;

const size = (value, low, high, fallback) => (Number.isInteger(value) && value >= low && value <= high ? value : fallback);

/** The person's login shell on this computer, as argv. */
export function loginShellArgv({ platform = process.platform, env = process.env } = {}) {
  if (platform === "win32") return ["powershell.exe", "-NoLogo"];
  const shell = typeof env.SHELL === "string" && /^\/[\w./-]+$/.test(env.SHELL) ? env.SHELL : platform === "darwin" ? "/bin/zsh" : "/bin/bash";
  return [shell, "-l"];
}

/** A resize the server sent, or null. */
export function parseResize(text) {
  try {
    const value = JSON.parse(text);
    if (value?.type !== "resize") return null;
    const cols = size(value.cols, 2, 1000, 0);
    const rows = size(value.rows, 1, 500, 0);
    return cols && rows ? { cols, rows } : null;
  } catch { return null; }
}

/** Open one terminal for a ticket. `command()` gives the argv and env to run
 * (the login shell here, or `docker exec -it` into the Local VM). Resolves
 * once the socket is open and the shell started; `onClose` runs once when
 * it ends, whichever side ended it. */
export async function openBridgeTerminal({ url, headers, ticket, cols, rows, command, WebSocketImpl = globalThis.WebSocket, spawnPty = spawnScriptPty, platform = process.platform, home = os.homedir(), onClose = () => {} }) {
  if (!TICKET.test(String(ticket ?? ""))) throw new Error("Invalid terminal request");
  if (!WebSocketImpl) throw new Error("This app cannot open a terminal connection");
  const program = await command();
  if (!Array.isArray(program?.argv) || !program.argv.length) throw new Error("Nothing to run");
  const socket = new WebSocketImpl(`${url}/${ticket}`, { headers });
  socket.binaryType = "arraybuffer";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { socket.close(); } catch { /* gone */ } reject(new Error("The server did not accept the terminal")); }, OPEN_TIMEOUT_MS);
    socket.onopen = () => { clearTimeout(timer); resolve(); };
    socket.onerror = () => { clearTimeout(timer); reject(new Error("The server refused the terminal")); };
  });
  const pty = spawnPty(program.argv, {
    platform, cols: size(cols, 2, 1000, 100), rows: size(rows, 1, 500, 28), env: program.env ?? process.env, cwd: program.cwd ?? home,
  });
  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    pty.close();
    try { socket.close(); } catch { /* gone */ }
    try { onClose(); } catch { /* bookkeeping only */ }
  };
  pty.output.on("data", (chunk) => { try { socket.send(chunk); } catch { finish(); } });
  pty.output.on("end", finish);
  socket.onmessage = (event) => {
    if (typeof event.data === "string") {
      const resize = parseResize(event.data);
      if (resize) pty.resize(resize.cols, resize.rows);
      return;
    }
    pty.input.write(Buffer.from(event.data));
  };
  socket.onclose = finish;
  socket.onerror = finish;
  return { close: finish };
}
