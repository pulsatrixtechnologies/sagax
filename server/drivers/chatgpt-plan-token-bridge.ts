// upstream #4063: a ChatGPT plan's sign-in, renewed while Codex works. Codex asks its `auth.command` for a token
// whenever it needs one, and that command reads the current token from this local bridge, which only the Codex
// processes of this account hold the secret for. No OAuth credential crosses the command line.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ChatGptTokenBridge {
  env: Record<string, string>;
  close(): void;
}

export async function startChatGptTokenBridge(accessToken: () => Promise<string>): Promise<ChatGptTokenBridge> {
  const secret = randomBytes(32).toString("hex");
  const directory = process.platform === "win32" ? undefined : mkdtempSync(join(tmpdir(), "sagax-auth-"));
  const path = directory ? join(directory, "s") : `\\\\.\\pipe\\sagax-auth-${randomBytes(16).toString("hex")}`;
  const connections = new Set<Socket>();
  let closed = false;
  const server = createServer((socket) => {
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
    socket.on("error", () => {});
    let input = "";
    socket.setTimeout(60_000, () => socket.destroy());
    socket.on("data", (chunk) => {
      input += chunk.toString();
      if (input.length > 128) return socket.destroy();
      if (!input.endsWith("\n")) return;
      socket.removeAllListeners("data");
      const actual = Buffer.from(input.trim());
      const expected = Buffer.from(secret);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return socket.destroy();
      void accessToken().then((token) => {
        if (!closed) socket.end(token);
      }, () => socket.destroy());
    });
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(path, resolve); });
  } catch (error) {
    if (directory) rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    env: { SAGAX_CODEX_AUTH_SOCKET: path, SAGAX_CODEX_AUTH_SECRET: secret },
    close() {
      if (closed) return;
      closed = true;
      for (const socket of connections) socket.destroy();
      server.close();
      if (directory) rmSync(directory, { recursive: true, force: true });
    },
  };
}
