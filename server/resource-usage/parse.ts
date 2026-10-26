// Reads the blocks scripts.ts prints. Pure functions over text, so every
// platform is tested from fixtures (./fixtures). Anything unreadable becomes
// "not known" (null), never an exception and never a made-up number.
import type { ResourceFrame, ResourceHost, ResourceVolume } from "../../shared/resource-usage.ts";

type Family = "linux" | "darwin" | "windows";

interface Ticks {
  busy: number;
  total: number;
}

/** One sample as the computer reported it: counters or rates, before any diff. */
export interface RawSample {
  family: Family;
  hostname?: string;
  os?: string;
  uptimeSec?: number;
  cores?: number;
  cpu?: { kind: "ticks"; total: Ticks; cores: Ticks[] } | { kind: "percent"; total: number; cores?: number[] };
  mem?: { used: number; total: number; swapUsed?: number; swapTotal?: number };
  disk?: { kind: "bytes"; read: number; write: number } | { kind: "rate"; readBps: number; writeBps: number };
  net?: { kind: "bytes"; rx: number; tx: number } | { kind: "rate"; rxBps: number; txBps: number };
  volumes: ResourceVolume[];
}

/** A stream cut into whole blocks; `rest` waits for the next chunk. */
export function splitBlocks(buffer: string): { blocks: string[]; rest: string } {
  const blocks: string[] = [];
  let rest = buffer;
  for (;;) {
    const begin = rest.indexOf("@@begin");
    if (begin < 0) return { blocks, rest: rest.length > 64 ? rest.slice(-64) : rest };
    const end = rest.indexOf("@@end", begin);
    if (end < 0) return { blocks, rest: rest.slice(begin) };
    blocks.push(rest.slice(begin, end + "@@end".length));
    rest = rest.slice(end + "@@end".length);
  }
}

function sections(block: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.replace(/\r$/, "");
    const head = /^@@(\w+)\s*$/.exec(line.trim());
    if (head) {
      current = [];
      out.set(head[1]!, current);
      continue;
    }
    current?.push(line);
  }
  return out;
}

const finite = (value: number) => Number.isFinite(value) ? value : NaN;
const num = (text: string | undefined) => finite(Number(String(text ?? "").trim()));
const lines = (list: string[] | undefined) => (list ?? []).map((line) => line.trim()).filter(Boolean);
const clean = (text: string | undefined) => {
  // oxlint-disable-next-line no-control-regex -- a host label must not keep control characters
  const value = String(text ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return value ? value.slice(0, 120) : undefined;
};

export function parseBlock(block: string): RawSample | null {
  const parts = sections(block);
  const osLine = lines(parts.get("os"))[0]?.toLowerCase() ?? "";
  const family: Family | null = osLine === "linux" ? "linux" : osLine === "darwin" ? "darwin" : osLine === "windows" ? "windows" : null;
  if (!family) return null;
  const host = lines(parts.get("host"));
  const raw: RawSample = { family, volumes: [] };
  const hostname = clean(host[0]);
  const os = clean(host[1]);
  if (hostname) raw.hostname = hostname;
  if (os) raw.os = os;
  if (family === "linux") readLinux(parts, raw);
  else if (family === "darwin") readMac(parts, raw);
  else readWindows(parts, raw);
  return raw;
}

// ── Linux ─────────────────────────────────────────────────────────────

function procTicks(fields: number[]): Ticks | null {
  if (fields.length < 4 || fields.some((value) => !Number.isFinite(value))) return null;
  const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = fields;
  const busy = user + nice + system + irq + softirq + steal;
  return { busy, total: busy + idle + iowait };
}

const WHOLE_DISK = /^(?:sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme\d+n\d+|mmcblk\d+)$/;
const PHYSICAL_NIC = /^(?:eth\d+|en\w+|wl\w+|ww\w+|bond\d+)$/;

function readLinux(parts: Map<string, string[]>, raw: RawSample) {
  const uptime = num(lines(parts.get("uptime"))[0]?.split(/\s+/)[0]);
  if (Number.isFinite(uptime)) raw.uptimeSec = Math.floor(uptime);

  let total: Ticks | null = null;
  const cores: Ticks[] = [];
  for (const line of lines(parts.get("stat"))) {
    const [name, ...rest] = line.split(/\s+/);
    const ticks = procTicks(rest.map(Number));
    if (!ticks) continue;
    if (name === "cpu") total = ticks;
    else if (/^cpu\d+$/.test(name ?? "")) cores.push(ticks);
  }
  if (total) raw.cpu = { kind: "ticks", total, cores };
  if (cores.length) raw.cores = cores.length;

  const mem = new Map<string, number>();
  for (const line of lines(parts.get("meminfo"))) {
    const match = /^(\w+):\s+(\d+)\s*kB$/i.exec(line);
    if (match) mem.set(match[1]!, Number(match[2]) * 1024);
  }
  const memTotal = mem.get("MemTotal");
  const available = mem.get("MemAvailable") ?? (mem.has("MemFree") ? (mem.get("MemFree")! + (mem.get("Buffers") ?? 0) + (mem.get("Cached") ?? 0)) : undefined);
  if (memTotal && available !== undefined) {
    raw.mem = { used: Math.max(0, memTotal - available), total: memTotal };
    const swapTotal = mem.get("SwapTotal");
    const swapFree = mem.get("SwapFree");
    if (swapTotal !== undefined && swapFree !== undefined) {
      raw.mem.swapUsed = Math.max(0, swapTotal - swapFree);
      raw.mem.swapTotal = swapTotal;
    }
  }

  let read = 0;
  let write = 0;
  let disks = 0;
  for (const line of lines(parts.get("diskstats"))) {
    const fields = line.split(/\s+/);
    if (!WHOLE_DISK.test(fields[2] ?? "")) continue;
    const sectorsRead = Number(fields[5]);
    const sectorsWritten = Number(fields[9]);
    if (!Number.isFinite(sectorsRead) || !Number.isFinite(sectorsWritten)) continue;
    // /proc/diskstats counts 512-byte sectors whatever the disk's own size
    read += sectorsRead * 512;
    write += sectorsWritten * 512;
    disks += 1;
  }
  if (disks) raw.disk = { kind: "bytes", read, write };

  const nics: Array<{ name: string; rx: number; tx: number }> = [];
  for (const line of lines(parts.get("netdev"))) {
    const match = /^([^:\s]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const fields = match[2]!.split(/\s+/).map(Number);
    if (fields.length < 9 || !Number.isFinite(fields[0]) || !Number.isFinite(fields[8])) continue;
    nics.push({ name: match[1]!, rx: fields[0]!, tx: fields[8]! });
  }
  const physical = nics.filter((nic) => PHYSICAL_NIC.test(nic.name));
  const counted = physical.length ? physical : nics.filter((nic) => nic.name !== "lo");
  if (counted.length) raw.net = { kind: "bytes", rx: sum(counted.map((nic) => nic.rx)), tx: sum(counted.map((nic) => nic.tx)) };

  raw.volumes = dfVolumes(parts.get("df"), "linux");
}

// ── macOS ─────────────────────────────────────────────────────────────

const MAC_NIC = /^en\d+$/;

function readMac(parts: Map<string, string[]>, raw: RawSample) {
  const ncpu = num(lines(parts.get("ncpu"))[0]);
  if (Number.isFinite(ncpu) && ncpu > 0) raw.cores = ncpu;

  const boot = lines(parts.get("boottime"));
  const bootSec = Number(/sec = (\d+)/.exec(boot[0] ?? "")?.[1]);
  const nowSec = num(boot[1]);
  if (Number.isFinite(bootSec) && Number.isFinite(nowSec) && nowSec >= bootSec) raw.uptimeSec = nowSec - bootSec;

  const idle = Number(/([\d.]+)% idle/.exec(lines(parts.get("cpu"))[0] ?? "")?.[1]);
  if (Number.isFinite(idle)) raw.cpu = { kind: "percent", total: clampPercent(100 - idle) };

  const vm = new Map<string, number>();
  let page = 4096;
  for (const line of lines(parts.get("vmstat"))) {
    const size = /page size of (\d+) bytes/.exec(line);
    if (size) page = Number(size[1]);
    const match = /^"?([^":]+)"?:\s+(\d+)\.?$/.exec(line);
    if (match) vm.set(match[1]!.trim(), Number(match[2]));
  }
  const memTotal = num(lines(parts.get("memsize"))[0]);
  if (Number.isFinite(memTotal) && memTotal > 0 && vm.has("Anonymous pages")) {
    // Activity Monitor's "Memory Used": app memory + wired + compressed
    const appPages = Math.max(0, (vm.get("Anonymous pages") ?? 0) - (vm.get("Pages purgeable") ?? 0));
    const usedPages = appPages + (vm.get("Pages wired down") ?? 0) + (vm.get("Pages occupied by compressor") ?? 0);
    raw.mem = { used: Math.min(memTotal, usedPages * page), total: memTotal };
    const swap = /total = ([\d.]+)([KMG])\s+used = ([\d.]+)([KMG])/.exec(lines(parts.get("swap"))[0] ?? "");
    if (swap) {
      raw.mem.swapTotal = scaled(Number(swap[1]), swap[2]!);
      raw.mem.swapUsed = scaled(Number(swap[3]), swap[4]!);
    }
  }

  let read = 0;
  let write = 0;
  let drivers = 0;
  for (const line of lines(parts.get("ioreg"))) {
    const r = /"Bytes \(Read\)"=(\d+)/.exec(line);
    const w = /"Bytes \(Write\)"=(\d+)/.exec(line);
    if (!r || !w) continue;
    read += Number(r[1]);
    write += Number(w[1]);
    drivers += 1;
  }
  if (drivers) raw.disk = { kind: "bytes", read, write };

  // netstat -ibn: one <Link#n> row per interface; the counters are the last
  // seven columns (Address is empty on some interfaces)
  const nics: Array<{ name: string; rx: number; tx: number }> = [];
  for (const line of lines(parts.get("netstat"))) {
    const fields = line.split(/\s+/);
    if (!fields[2]?.startsWith("<Link#")) continue;
    const tail = fields.slice(-7).map(Number);
    if (tail.length < 7 || !Number.isFinite(tail[2]) || !Number.isFinite(tail[5])) continue;
    nics.push({ name: fields[0]!.replace(/\*$/, ""), rx: tail[2]!, tx: tail[5]! });
  }
  const physical = nics.filter((nic) => MAC_NIC.test(nic.name));
  const counted = physical.length ? physical : nics.filter((nic) => nic.name !== "lo0");
  if (counted.length) raw.net = { kind: "bytes", rx: sum(counted.map((nic) => nic.rx)), tx: sum(counted.map((nic) => nic.tx)) };

  raw.volumes = dfVolumes(parts.get("df"), "darwin");
}

function scaled(value: number, unit: string): number {
  const power = unit === "G" ? 3 : unit === "M" ? 2 : 1;
  return Math.round(value * 1024 ** power);
}

// ── Windows ───────────────────────────────────────────────────────────

function pairs(list: string[] | undefined): Array<Map<string, string>> {
  return lines(list).map((line) => {
    const map = new Map<string, string>();
    for (const part of line.split(/\s+/)) {
      const at = part.indexOf("=");
      if (at > 0) map.set(part.slice(0, at), part.slice(at + 1));
    }
    return map;
  });
}

function readWindows(parts: Map<string, string[]>, raw: RawSample) {
  const uptime = num(lines(parts.get("uptime"))[0]);
  if (Number.isFinite(uptime)) raw.uptimeSec = Math.floor(uptime);

  const cores: Array<{ index: number; value: number }> = [];
  let total: number | null = null;
  for (const line of lines(parts.get("cpu"))) {
    const [name, value] = line.split("=");
    const percent = num(value);
    if (!Number.isFinite(percent)) continue;
    if (name === "_Total") total = clampPercent(percent);
    else if (/^\d+$/.test(name ?? "")) cores.push({ index: Number(name), value: clampPercent(percent) });
  }
  cores.sort((a, b) => a.index - b.index);
  if (total !== null) raw.cpu = { kind: "percent", total, ...(cores.length ? { cores: cores.map((core) => core.value) } : {}) };
  if (cores.length) raw.cores = cores.length;

  const mem = new Map(lines(parts.get("mem")).map((line) => line.split("=") as [string, string]));
  const memTotal = num(mem.get("total")) * 1024;
  const free = num(mem.get("free")) * 1024;
  if (Number.isFinite(memTotal) && Number.isFinite(free) && memTotal > 0) {
    raw.mem = { used: Math.max(0, memTotal - free), total: memTotal };
    const files = pairs(parts.get("swap"));
    const size = sum(files.map((row) => num(row.get("size"))).filter(Number.isFinite));
    const used = sum(files.map((row) => num(row.get("used"))).filter(Number.isFinite));
    if (files.length && size > 0) {
      raw.mem.swapUsed = used * 1024 * 1024;
      raw.mem.swapTotal = size * 1024 * 1024;
    }
  }

  const disk = new Map(lines(parts.get("disk")).map((line) => line.split("=") as [string, string]));
  const readBps = num(disk.get("read"));
  const writeBps = num(disk.get("write"));
  if (Number.isFinite(readBps) && Number.isFinite(writeBps)) raw.disk = { kind: "rate", readBps, writeBps };

  const nics = pairs(parts.get("net")).map((row) => ({ rx: num(row.get("rx")), tx: num(row.get("tx")) })).filter((nic) => Number.isFinite(nic.rx) && Number.isFinite(nic.tx));
  if (nics.length) raw.net = { kind: "rate", rxBps: sum(nics.map((nic) => nic.rx)), txBps: sum(nics.map((nic) => nic.tx)) };

  const volumes: ResourceVolume[] = [];
  for (const line of lines(parts.get("df"))) {
    const [name, size, freeSpace] = line.split(/\s+/);
    const totalBytes = num(size);
    const freeBytes = num(freeSpace);
    if (!/^[A-Z]:$/i.test(name ?? "") || !Number.isFinite(totalBytes) || !Number.isFinite(freeBytes) || totalBytes <= 0) continue;
    volumes.push({ name: name!.toUpperCase(), used: Math.max(0, totalBytes - freeBytes), total: totalBytes });
  }
  raw.volumes = volumes.slice(0, 8);
}

// ── df (macOS and Linux) ──────────────────────────────────────────────

const SKIP_MOUNT = /^\/(?:boot|snap|run|dev|proc|sys|var\/lib\/docker|var\/lib\/containers|var\/snap)(?:\/|$)/;

function dfVolumes(list: string[] | undefined, family: "linux" | "darwin"): ResourceVolume[] {
  const rows: Array<{ device: string; mount: string; used: number; available: number; total: number }> = [];
  for (const line of lines(list)) {
    const match = /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/.exec(line);
    if (!match) continue;
    rows.push({ device: match[1]!, total: Number(match[2]) * 1024, used: Number(match[3]) * 1024, available: Number(match[4]) * 1024, mount: match[5]!.trim() });
  }
  if (family === "darwin") {
    // APFS: every volume of a container shares its space; the data volume and
    // the external disks are the ones people mean
    // the external disks, not a mounted installer image (under 1 GB) or Recovery
    const external = (row: (typeof rows)[number]) => row.mount.startsWith("/Volumes/") && row.mount !== "/Volumes/Recovery" && row.total >= 1024 ** 3;
    const data = rows.filter((row) => row.mount === "/System/Volumes/Data" || external(row));
    const picked = data.length ? data : rows.filter((row) => row.mount === "/");
    return picked.slice(0, 8).map((row) => ({
      name: row.mount === "/System/Volumes/Data" || row.mount === "/" ? "Macintosh HD" : clean(row.mount.slice("/Volumes/".length)) ?? "",
      used: Math.max(0, row.total - row.available),
      total: row.total,
    })).filter((volume) => volume.name);
  }
  const seen = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const physical = row.device.startsWith("/dev/") && !row.device.startsWith("/dev/loop");
    // a ZFS dataset or an unRAID pool mounted under /mnt
    const pool = !row.device.includes("/") && row.mount.startsWith("/mnt/") && !/^(?:shfs|tmpfs|overlay|none|rootfs)$/.test(row.device);
    if (!physical && !pool) continue;
    if (SKIP_MOUNT.test(row.mount)) continue;
    const kept = seen.get(row.device);
    if (!kept || row.mount.length < kept.mount.length) seen.set(row.device, row);
  }
  // a mount point is the computer's text: no control characters, 120 characters at most
  return [...seen.values()].slice(0, 8)
    .map((row) => ({ name: clean(row.mount) ?? "", used: row.used, total: row.used + row.available }))
    .filter((volume) => volume.name);
}

// ── frames ────────────────────────────────────────────────────────────

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

function busyPercent(before: Ticks, after: Ticks): number | null {
  const total = after.total - before.total;
  const busy = after.busy - before.busy;
  if (!(total > 0) || busy < 0) return null;
  return clampPercent((busy / total) * 100);
}

/** Bytes per second between two counters; 0 when a counter went back (wrap, restart). */
function rate(before: number, after: number, seconds: number): number {
  const delta = after - before;
  return delta > 0 && seconds > 0 ? delta / seconds : 0;
}

/** The frame for `raw`, using the previous sample for counters. */
export function deriveFrame(prev: { raw: RawSample; t: number } | null, raw: RawSample, t: number): ResourceFrame {
  const seconds = prev ? (t - prev.t) / 1000 : 0;
  let cpu: ResourceFrame["cpu"] = null;
  if (raw.cpu?.kind === "percent") {
    cpu = { total: raw.cpu.total, ...(raw.cpu.cores ? { cores: raw.cpu.cores } : {}) };
  } else if (raw.cpu?.kind === "ticks" && prev?.raw.cpu?.kind === "ticks") {
    const total = busyPercent(prev.raw.cpu.total, raw.cpu.total);
    if (total !== null) {
      const before = prev.raw.cpu.cores;
      const cores = raw.cpu.cores.length === before.length ? raw.cpu.cores.map((core, index) => busyPercent(before[index]!, core) ?? 0) : [];
      cpu = { total, ...(cores.length ? { cores } : {}) };
    }
  }
  let disk: ResourceFrame["disk"] = null;
  if (raw.disk?.kind === "rate") disk = { readBps: Math.max(0, raw.disk.readBps), writeBps: Math.max(0, raw.disk.writeBps) };
  else if (raw.disk?.kind === "bytes" && prev?.raw.disk?.kind === "bytes" && seconds > 0) {
    disk = { readBps: rate(prev.raw.disk.read, raw.disk.read, seconds), writeBps: rate(prev.raw.disk.write, raw.disk.write, seconds) };
  }
  let net: ResourceFrame["net"] = null;
  if (raw.net?.kind === "rate") net = { rxBps: Math.max(0, raw.net.rxBps), txBps: Math.max(0, raw.net.txBps) };
  else if (raw.net?.kind === "bytes" && prev?.raw.net?.kind === "bytes" && seconds > 0) {
    net = { rxBps: rate(prev.raw.net.rx, raw.net.rx, seconds), txBps: rate(prev.raw.net.tx, raw.net.tx, seconds) };
  }
  return { t, cpu, mem: raw.mem ? { ...raw.mem } : null, disk, net, volumes: raw.volumes };
}

export function hostOf(raw: RawSample): ResourceHost {
  return {
    ...(raw.hostname ? { hostname: raw.hostname } : {}),
    ...(raw.os ? { os: raw.os } : {}),
    ...(raw.uptimeSec !== undefined ? { uptimeSec: raw.uptimeSec } : {}),
    ...(raw.cores !== undefined ? { cores: raw.cores } : {}),
  };
}
