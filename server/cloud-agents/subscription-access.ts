// A person's engine subscription, as a cloud agent run needs it (Perspicax
// #384, lot P1.9, spec section 4.4): the SHORT access token of their own
// Claude or ChatGPT sign-in on this server, read from their login directory
// (principal-engine-logins.ts), never the refresh token. Perspicax keeps it
// in memory for the run's model proxy; Sagax hands it over and renews it
// (subscription-depositor.ts).
//
//   claude-code -> ${DATA_DIR}/principals/<id>/claude/.credentials.json
//                  claudeAiOauth.accessToken, expiresAt (ms)    provider anthropic
//   codex       -> ${DATA_DIR}/principals/<id>/codex/auth.json
//                  tokens.access_token (a JWT: exp), account_id provider openai
//
// Renewing is the engine CLI's own job, run on the person's directory, so a
// rotating refresh token is only ever used by the CLI that owns it: Codex
// through its app-server (`account/read` with `refreshToken: true`), Claude
// Code through `claude auth status`, which loads (and renews) the sign-in.
// Nothing here logs or returns a token outside the value it reads.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { CLAUDE_KEYCHAIN_SERVICE, decodeKeychainSecret, readDarwinClaudeKeychain } from "../plan-usage.ts";
import { killCliTree, spawnCli } from "../procs.ts";

/** The engines a run may use, with the subscription each one needs. */
export type RunEngine = "claude-code" | "codex";
export type SubscriptionDriver = "claudeAgent" | "codex";

export const ENGINE_DRIVER: Readonly<Record<RunEngine, SubscriptionDriver>> = { "claude-code": "claudeAgent", codex: "codex" };
export const ENGINE_PROVIDER: Readonly<Record<RunEngine, "anthropic" | "openai">> = { "claude-code": "anthropic", codex: "openai" };

export function runEngine(value: string): RunEngine | null {
  return value === "claude-code" || value === "codex" ? value : null;
}

export interface SubscriptionAccess {
  provider: "anthropic" | "openai";
  /** The short access token. Never a refresh token. */
  accessToken: string;
  /** Epoch ms; null when the file does not say (Perspicax needs one: the
   * depositor then declares a short life). */
  expiresAt: number | null;
  /** The ChatGPT account of a Codex sign-in. */
  accountId?: string;
}

const MAX_BYTES = 1_000_000;
const TOKEN = /^[\x21-\x7e]{20,8192}$/;

function readText(path: string): string | null {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_BYTES) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parse(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    return record(JSON.parse(text));
  } catch {
    return null;
  }
}

const token = (value: unknown): string | null => (typeof value === "string" && TOKEN.test(value) ? value : null);

/** Epoch ms from ms, seconds or an ISO date. */
function epochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value < 1e12 ? value * 1000 : value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** A JWT's `exp`, read without verifying (it only bounds what we declare). */
export function jwtExpiry(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  try {
    const body = record(JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")));
    return epochMs(body?.exp);
  } catch {
    return null;
  }
}

/** Claude Code's file (`.credentials.json`): the sign-in's access token. */
export function claudeAccessFrom(text: string | null): SubscriptionAccess | null {
  const oauth = record(parse(text)?.claudeAiOauth);
  const access = token(oauth?.accessToken);
  if (!access) return null;
  return { provider: "anthropic", accessToken: access, expiresAt: epochMs(oauth?.expiresAt) };
}

/** Codex's `auth.json`: a ChatGPT sign-in's access token (an API key in
 * that file is not a subscription and is never handed over). */
export function codexAccessFrom(text: string | null): SubscriptionAccess | null {
  const root = parse(text);
  const tokens = record(root?.tokens);
  const access = token(tokens?.access_token);
  if (!access) return null;
  const accountId = typeof tokens?.account_id === "string" && /^[\x21-\x7e]{1,200}$/.test(tokens.account_id) ? tokens.account_id : undefined;
  return { provider: "openai", accessToken: access, expiresAt: jwtExpiry(access), ...(accountId ? { accountId } : {}) };
}

/** The macOS keychain item Claude Code uses for a CLAUDE_CONFIG_DIR (the
 * same naming plan-usage.ts reads). */
export function claudeKeychainService(loginDir: string): string {
  return `${CLAUDE_KEYCHAIN_SERVICE}-${createHash("sha256").update(resolve(loginDir)).digest("hex").slice(0, 8)}`;
}

/** The person's current access token for a run engine, from their login
 * directory (on macOS, Claude Code keeps it in the keychain item of that
 * directory instead), or null when they have none there. */
export async function readSubscriptionAccess(
  engine: RunEngine,
  loginDir: string,
  keychain: ((service: string) => Promise<string | null>) | null = process.platform === "darwin" ? readDarwinClaudeKeychain : null,
): Promise<SubscriptionAccess | null> {
  if (engine === "codex") return codexAccessFrom(readText(join(loginDir, "auth.json")));
  const file = claudeAccessFrom(readText(join(loginDir, ".credentials.json")));
  if (file || !keychain) return file;
  try {
    return claudeAccessFrom(decodeKeychainSecret(await keychain(claudeKeychainService(loginDir))));
  } catch {
    return null;
  }
}

export interface RenewInput {
  engine: RunEngine;
  cli: string;
  loginDir: string;
  /** The instance's environment (Settings), merged over the process's. */
  environment: Record<string, string | undefined>;
  timeoutMs?: number;
}

/** Ask the engine's CLI to renew the person's sign-in in its own directory.
 * Resolves when the CLI is done (or gave up); the caller reads the file
 * again. Never throws, never keeps the CLI's output. */
export async function renewWithCli(input: RenewInput): Promise<void> {
  const env: Record<string, string | undefined> = { ...process.env, ...input.environment };
  // As the sign-in flow does: a server key must never win over the person's
  // OAuth sign-in, or the CLI would never renew it.
  if (input.engine === "claude-code") {
    env.CLAUDE_CONFIG_DIR = input.loginDir;
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
  } else {
    env.CODEX_HOME = input.loginDir;
    delete env.OPENAI_API_KEY;
  }
  const args = input.engine === "claude-code" ? ["auth", "status", "--json"] : ["app-server"];
  const timeoutMs = input.timeoutMs ?? 20_000;
  await new Promise<void>((resolve) => {
    let child: ReturnType<typeof spawnCli>;
    try {
      child = spawnCli(input.cli, args, { cwd: input.loginDir, env, stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void killCliTree(child, 1_000).finally(() => resolve());
    };
    const timer = setTimeout(finish, timeoutMs);
    timer.unref?.();
    child.stderr.resume();
    child.on("error", finish);
    child.on("close", finish);
    if (input.engine === "claude-code") {
      child.stdout.resume();
      try { child.stdin.end(); } catch { /* gone */ }
      return;
    }
    // Codex app-server: initialize, then account/read with a refresh.
    let buffer = "";
    let size = 0;
    const send = (message: unknown) => {
      try { child.stdin.write(`${JSON.stringify(message)}\n`); } catch { finish(); }
    };
    child.stdin.on("error", finish);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      size += chunk.length;
      if (size > 65_536) { finish(); return; }
      buffer += chunk;
      let cut: number;
      while (!done && (cut = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 1);
        let message: { id?: unknown; result?: unknown; error?: unknown };
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 1) {
          if (message.error) { finish(); return; }
          send({ method: "initialized", params: {} });
          send({ id: 2, method: "account/read", params: { refreshToken: true } });
        } else if (message.id === 2) {
          finish();
        }
      }
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "sagax", version: "1" } } });
  });
}
