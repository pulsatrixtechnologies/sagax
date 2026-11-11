// Let Codex resolve its effective account, including keyring credentials.
// Reading auth.json directly can label an API-key or keyring login with an
// old file's email. Only the protocol's display email leaves this helper.
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { userHome } from "../env-path.ts";
import { killCliTree, spawnCli } from "../procs.ts";
import { reportBackgroundError } from "../background-error.ts";

const MAX_OUTPUT = 16_384;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Where this environment's Codex keeps its credentials, or null when the
 * configured home is not absolute (the login controller refuses those too). */
export function codexHome(env: Record<string, string | undefined>): string | null {
  if (env.CODEX_HOME) return isAbsolute(env.CODEX_HOME) ? resolve(env.CODEX_HOME) : null;
  const home = userHome(env);
  return isAbsolute(home) ? join(home, ".codex") : null;
}

/** Read-only account metadata. Unsupported CLIs and uncertain responses stay
 * unnamed; never fall back to a potentially inactive credential file. */
export async function codexAccountEmail(
  cli: string,
  env: Record<string, string | undefined>,
  timeoutMs = 3_000,
): Promise<string | null> {
  const cwd = env.HOME || env.USERPROFILE || homedir();
  if (!isAbsolute(cwd) || !codexHome(env)) return null;
  return new Promise((resolveEmail) => {
    let child: ReturnType<typeof spawnCli>;
    try {
      child = spawnCli(cli, ["app-server"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      resolveEmail(null);
      return;
    }
    let finishing = false;
    let buffer = "";
    let outputBytes = 0;
    let initialized = false;
    const finish = async (email: string | null) => {
      if (finishing) return;
      finishing = true;
      clearTimeout(timer);
      // killCliTree waits for a child the spawn helper is still starting, so
      // a timeout in its first milliseconds still stops the whole group
      // (#3709); a second call goes straight to SIGKILL.
      let stopped = await killCliTree(child, 1_000);
      if (!stopped) stopped = await killCliTree(child, 0);
      resolveEmail(stopped ? email : null);
    };
    const timer = setTimeout(() => { void finish(null).catch(reportBackgroundError); }, timeoutMs);
    timer.unref();
    const send = (message: unknown) => {
      try { child.stdin.write(`${JSON.stringify(message)}\n`); } catch { void finish(null).catch(reportBackgroundError); }
    };
    child.stdin.on("error", () => { void finish(null).catch(reportBackgroundError); });
    child.stderr.resume(); // Do not retain or log raw CLI errors or credentials.
    child.on("error", () => { void finish(null).catch(reportBackgroundError); });
    child.on("close", () => { void finish(null).catch(reportBackgroundError); });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (finishing) return;
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_OUTPUT) { void finish(null).catch(reportBackgroundError); return; }
      buffer += chunk;
      let newline: number;
      while (!finishing && (newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let message: any;
        try { message = JSON.parse(line); } catch { void finish(null).catch(reportBackgroundError); return; }
        if (!initialized && message?.id === 1) {
          if (message.error || !message.result) { void finish(null).catch(reportBackgroundError); return; }
          initialized = true;
          send({ method: "initialized", params: {} });
          send({ id: 2, method: "account/read", params: { refreshToken: false } });
        } else if (initialized && message?.id === 2) {
          const account = message.error ? null : message.result?.account;
          const email = account?.type === "chatgpt" ? account.email : null;
          void finish(typeof email === "string" && email.length <= 254 && EMAIL.test(email) && !/[\p{Cc}\p{Cf}]/u.test(email) ? email : null).catch(reportBackgroundError);
        }
      }
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "openmausbot", version: "1" } } });
  });
}
