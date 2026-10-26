// An organization server (SAGAX_IDENTITY=perspicax) on a fake Perspicax, in
// a temp home, for the "never signed out by a deploy" tests and bench
// (2026-10-20). Only the child this harness spawned is ever signalled.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { removeTempDir, waitForExit } from "./cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./fake-oidc-provider.ts";
import { freePortBlock } from "./ports.ts";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAKE_CLI = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const CLI_OWNER = "cli-owner-token-0123456789abcdefghijklmnopq";

export type Auth = { cookie: string };
export interface ApiAnswer { status: number; body: any; headers: Headers }

export interface OrgServer {
  base: string;
  idp: FakeOidcProvider;
  home: string;
  /** Everything the server printed so far. */
  log(): string;
  api(method: string, path: string, auth?: Auth, body?: unknown): Promise<ApiAnswer>;
  signIn(user: FakeOidcUser, options?: { fresh?: boolean; authTimeAgoSeconds?: number; previous?: Auth }): Promise<Auth>;
  /** Stop (SIGTERM: a clean deploy stop; SIGKILL: out of memory, a stop that outran its grace) and start again. */
  restart(signal: "SIGTERM" | "SIGKILL"): Promise<void>;
  kill(signal: "SIGTERM" | "SIGKILL"): Promise<void>;
  start(): Promise<void>;
  close(): Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;

export async function startOrgServer(options: { user: FakeOidcUser; refreshAfterSeconds?: number; prefix?: string; env?: Record<string, string> }): Promise<OrgServer> {
  chmodSync(FAKE_CLI, 0o755);
  const idp = await startFakeOidcProvider({ user: options.user });
  const port = await freePortBlock([0, 1]);
  const base = `http://127.0.0.1:${port}`;
  const home = mkdtempSync(join(tmpdir(), options.prefix ?? "sagax-org-"));
  const data = join(home, ".sagax");
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, "config.json"), JSON.stringify({
    instances: { grok: { driver: "grokAgent", config: { cli: FAKE_CLI, fullAuto: false } } },
  }));
  let child: ChildProcess | null = null;
  let output = "";

  const start = async () => {
    const spawned = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "",
        SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1),
        SAGAX_IDENTITY: "perspicax",
        SAGAX_PERSPICAX_ISSUER: idp.issuer,
        SAGAX_PUBLIC_URL: base,
        SAGAX_CLI_OWNER_STDIN: "1",
        ...(options.refreshAfterSeconds ? { SAGAX_OIDC_REFRESH_AFTER_SECONDS: String(options.refreshAfterSeconds) } : {}),
        ...options.env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child = spawned;
    spawned.stdin!.write(`${CLI_OWNER}\n`);
    spawned.stdout!.on("data", (chunk) => (output += chunk));
    spawned.stderr!.on("data", (chunk) => (output += chunk));
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) return;
      } catch {
        /* not up yet */
      }
      if (spawned.exitCode !== null) throw new Error(`server exited:\n${output.slice(-3000)}`);
      if (Date.now() > deadline) throw new Error(`server never came up:\n${output.slice(-3000)}`);
      await sleep(150);
    }
  };

  const kill = async (signal: "SIGTERM" | "SIGKILL") => {
    const running = child;
    if (!running || running.exitCode !== null) return;
    running.kill(signal);
    await waitForExit(running);
    child = null;
  };

  const api = async (method: string, path: string, auth?: Auth, body?: unknown): Promise<ApiAnswer> => {
    const headers: Record<string, string> = {};
    if (auth?.cookie) headers.cookie = auth.cookie;
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      headers.origin = base;
    }
    const res = await fetch(`${base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
  };

  const signIn = async (user: FakeOidcUser, signInOptions: { fresh?: boolean; authTimeAgoSeconds?: number; previous?: Auth } = {}): Promise<Auth> => {
    idp.user = { ...user };
    if (signInOptions.authTimeAgoSeconds !== undefined) {
      const ago = signInOptions.authTimeAgoSeconds;
      idp.tamper = { claims: (claims) => ({ ...claims, auth_time: Math.floor(Date.now() / 1000) - ago }) };
    }
    try {
      const startUrl = `${base}/auth/oidc/start${signInOptions.fresh ? "?fresh=1" : ""}`;
      const begin = await fetch(startUrl, { redirect: "manual", headers: signInOptions.previous ? { cookie: signInOptions.previous.cookie } : {} });
      const binding = cookiePair(begin.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
      const authorize = await fetch(begin.headers.get("location")!, { redirect: "manual" });
      const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: [binding, signInOptions.previous?.cookie].filter(Boolean).join("; ") } });
      const session = callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="));
      if (!session || callback.headers.get("location") !== "/") throw new Error(`sign-in did not land: ${callback.headers.get("location")}\n${output.slice(-2000)}`);
      return { cookie: cookiePair(session) };
    } finally {
      idp.tamper = {};
    }
  };

  await start();
  return {
    base,
    idp,
    home,
    log: () => output,
    api,
    signIn,
    start,
    kill,
    restart: async (signal) => {
      await kill(signal);
      await start();
    },
    close: async () => {
      await kill("SIGTERM");
      await idp.close();
      await removeTempDir(home);
    },
  };
}
