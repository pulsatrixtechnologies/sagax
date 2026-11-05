/** One app-server per thread, confined to its bot and execution identity (#1969). */
import { createHash } from "node:crypto";
import { readFileSync, watchFile, unwatchFile } from "node:fs";
import { join } from "node:path";
import { codexHome } from "../codex-identity.ts";
import { sessionIdlePolicy } from "../session-idle.ts";
import type { CodexProcess, CodexSession } from "./session-types.ts";
import { MiB, warmResourcePerson, warmResources } from "../../resources/warm-resources.ts";
import { retireClosedWarmProcess } from "../../resources/warm-process.ts";

export type { CodexProcess } from "./session-types.ts";

/** Canonicalize records so insertion order cannot cause a cold start. Never logged. */
export function codexContractKey(value: unknown): string {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function codexAccountFiles(env: Record<string, string | undefined>, cwd: string): string[] {
  const home = codexHome(env);
  return [...(home ? [join(home, "auth.json"), join(home, "config.toml")] : []), join(cwd, ".codex", "config.toml")];
}

export function codexFileContract(paths: string[]): string {
  return codexContractKey(paths.map(path => {
    try { return [path, readFileSync(path, "utf8")]; } catch { return [path, null]; }
  }));
}

export class CodexSessions {
  private readonly sessions = new Map<string, CodexProcess>();
  private readonly idleMs = sessionIdlePolicy("CODEX").idleMs;

  has(threadId: string): boolean { return this.sessions.has(threadId); }

  async isolate(threadId: string, identity: string): Promise<void> {
    const process = this.sessions.get(threadId);
    if (process && process.identity !== identity && !await this.close(threadId)) {
      throw new Error("Codex could not close the previous account's session");
    }
  }

  async take(threadId: string, key: string, reset: boolean): Promise<CodexProcess | undefined> {
    const process = this.sessions.get(threadId);
    if (!process) return;
    if (process.budget && !process.budget.active()) {
      if (!await this.close(threadId)) throw new Error("Codex could not close the previous session");
      return;
    }
    if (process.idle) clearTimeout(process.idle);
    process.unwatch?.();
    process.unwatch = undefined;
    const s = process.session;
    if (!reset && !process.closing && process.key === key && s?.state.settled && !s.stopping &&
        s.child.exitCode === null && s.child.signalCode === null && s.child.stdin?.writable) {
      s.detachStream();
      return process;
    }
    if (!await this.close(threadId)) throw new Error("Codex could not close the previous session");
  }

  put(threadId: string, process: CodexProcess): void {
    this.sessions.set(threadId, process);
    const s = process.session!;
    process.budget ??= warmResources.register({
      person: warmResourcePerson(s.input), kind: "codex", bytes: 192 * MiB,
      pids: () => s.child.pid ? [s.child.pid] : [],
      protected: () => !process.session?.state.settled,
      evict: () => this.sessions.get(threadId) === process ? this.close(threadId) : s.terminate(),
    });
  }

  forget(s: CodexSession, treeStopped = false): void {
    if (this.sessions.get(s.threadId) !== s.process) return;
    if (s.process.idle) clearTimeout(s.process.idle);
    s.process.unwatch?.();
    if (treeStopped) s.process.budget?.forget();
    else retireClosedWarmProcess(s.process.budget, s.child);
    this.sessions.delete(s.threadId);
  }

  park(s: CodexSession): void {
    if (this.sessions.get(s.threadId) !== s.process) return;
    s.process.idle = setTimeout(() => { void this.close(s.threadId); }, this.idleMs);
    s.process.idle.unref();
    // A sign-in performed outside Sagax also retires an idle credential holder.
    // Watch only while idle: Codex may renew its own login during a turn.
    const files = codexAccountFiles(s.env, s.input.cwd ?? s.commandCwd);
    const before = codexFileContract(files);
    const changed = () => {
      if (this.sessions.get(s.threadId) === s.process && codexFileContract(files) !== before) void this.close(s.threadId);
    };
    for (const file of files) watchFile(file, { persistent: false, interval: 1000 }, changed);
    s.process.unwatch = () => { for (const file of files) unwatchFile(file, changed); };
    s.process.budget?.idle();
  }

  async close(threadId: string): Promise<boolean> {
    const process = this.sessions.get(threadId);
    const s = process?.session;
    if (!s) return true;
    process!.closing = true;
    process!.budget?.retiring();
    if (process?.idle) clearTimeout(process.idle);
    process?.unwatch?.();
    const stopped = s.state.settled ? await s.terminate() : await s.stop();
    if (stopped) this.forget(s, true);
    return stopped;
  }

  async closeAll(): Promise<boolean[]> {
    return Promise.all([...this.sessions.keys()].map(thread => this.close(thread)));
  }
}
