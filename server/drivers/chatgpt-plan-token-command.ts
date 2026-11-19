// upstream #4063: Codex's `auth.command` for a ChatGPT plan. It reads the current token from the bridge
// (chatgpt-plan-token-bridge.ts). stdout holds only the token; a failure discloses no credential.
// Spawned as its own process (proxy-paths.ts chatgptPlanToken): it imports nothing local.
import { createConnection } from "node:net";

const path = process.env.SAGAX_CODEX_AUTH_SOCKET;
const secret = process.env.SAGAX_CODEX_AUTH_SECRET;
if (!path || !secret) process.exit(1);
const socket = createConnection(path);
socket.setTimeout(55_000, () => socket.destroy());
socket.on("connect", () => socket.write(`${secret}\n`));
socket.on("error", () => { process.exitCode = 1; });
let response = "";
socket.on("data", (data) => { response += data.toString(); if (response.length > 16384) socket.destroy(); });
socket.on("close", () => {
  if (!response || response.length > 16384) { process.exitCode = 1; return; }
  process.stdout.write(response);
});
