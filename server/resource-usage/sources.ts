// How samples reach the server: a process whose stdout carries the blocks of
// scripts.ts. This computer runs the loop in a local shell; an SSH host and a
// Tailcat session run it through the transport that already exists for the
// in-chat terminal, without a terminal (no -t) and with nothing installed.
// The address and key of a tunnel are argv elements only: never logged,
// never returned.
import { spawn } from "node:child_process";
import { cpus } from "node:os";

import { localArgv, posixLoop, remoteCommand, type ScriptFamily } from "./scripts.ts";
import type { SampleSource, SampleStream } from "./sampler.ts";

/** stderr is read and dropped (it may hold a host name or a banner). */
export function spawnSource(build: (iterations: number) => { argv: string[]; env?: NodeJS.ProcessEnv }, extra: Partial<SampleSource> = {}): SampleSource {
  return {
    ...extra,
    start(iterations, onText, onExit): SampleStream {
      const { argv, env } = build(iterations);
      let ended = false;
      const finish = (error?: string) => {
        if (ended) return;
        ended = true;
        onExit(error);
      };
      const child = spawn(argv[0]!, argv.slice(1), { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, ...(env ? { env } : {}) });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => onText(chunk));
      child.stderr.on("data", () => {});
      child.on("error", () => finish("spawn"));
      child.on("close", (code) => finish(code === 0 ? undefined : "exit"));
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      return {
        stop() {
          ended = true;
          if (child.exitCode !== null || child.signalCode !== null) return;
          child.kill("SIGTERM");
          killTimer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
          }, 2_000);
          killTimer.unref?.();
        },
      };
    },
  };
}

export function familyOf(platform: NodeJS.Platform): ScriptFamily {
  return platform === "win32" ? "windows" : "posix";
}

/** Per-core CPU from Node between two calls (this computer only). */
export function nodeCpuOverlay(read: () => Array<{ times: { user: number; nice: number; sys: number; idle: number; irq: number } }> = cpus) {
  let before: Array<{ busy: number; total: number }> | null = null;
  return () => {
    const now = read().map(({ times }) => {
      const busy = times.user + times.nice + times.sys + times.irq;
      return { busy, total: busy + times.idle };
    });
    const prev = before;
    before = now;
    if (!prev || prev.length !== now.length || !now.length) return null;
    const cores = now.map((core, index) => {
      const total = core.total - prev[index]!.total;
      const busy = core.busy - prev[index]!.busy;
      return total > 0 && busy >= 0 ? Math.min(100, (busy / total) * 100) : 0;
    });
    const sum = (list: Array<{ busy: number; total: number }>, key: "busy" | "total") => list.reduce((total, row) => total + row[key], 0);
    const total = sum(now, "total") - sum(prev, "total");
    const busy = sum(now, "busy") - sum(prev, "busy");
    return { total: total > 0 ? Math.min(100, Math.max(0, (busy / total) * 100)) : 0, cores };
  };
}

/** The computer this server runs on. macOS: Node gives the per-core CPU top lacks. */
export function localSource(platform: NodeJS.Platform = process.platform): SampleSource {
  const family = familyOf(platform);
  const overlay = platform === "darwin" ? nodeCpuOverlay() : null;
  if (overlay) overlay();
  return spawnSource((iterations) => ({ argv: localArgv(family, iterations) }), overlay ? { cpuOverlay: overlay } : {});
}

/** argv for an SSH alias, without a terminal: the in-chat terminal's ssh minus -tt. */
export function sshResourceArgv(alias: string, iterations: number, configPath: string | null): string[] {
  return [
    "ssh",
    ...(configPath ? ["-F", configPath] : []),
    "-T",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    alias,
    remoteCommand("posix", iterations),
  ];
}

export function sshSource(alias: string, ssh: () => { configPath: string | null; path: string }): SampleSource {
  return spawnSource((iterations) => {
    const setup = ssh();
    return { argv: sshResourceArgv(alias, iterations, setup.configPath), env: { ...process.env, PATH: setup.path } };
  });
}

/** argv for a Tailcat session: `tailcat ssh --key <key> <address> <command>`. */
export function tailcatResourceArgv(bin: string, keyPath: string, address: string, family: ScriptFamily, iterations: number): string[] {
  return [bin, "ssh", "--key", keyPath, address, remoteCommand(family, iterations)];
}

export function tailcatSource(tunnel: () => { bin: string; keyPath: string; address: string } | null, family: ScriptFamily): SampleSource {
  return spawnSource((iterations) => {
    const found = tunnel();
    // the tunnel left between the check and the start: the run ends at once
    if (!found) return { argv: ["false"] };
    return { argv: tailcatResourceArgv(found.bin, found.keyPath, found.address, family, iterations) };
  });
}

/** The bot's Local VM (a container on this computer): the same Linux loop inside it. */
export function containerSource(runtime: string, container: string): SampleSource {
  return spawnSource((iterations) => ({ argv: [runtime, "exec", container, "sh", "-c", posixLoop(iterations)] }));
}
