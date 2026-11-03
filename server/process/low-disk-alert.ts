// The low-disk alert: the disk holding the data folder is nearly full, so
// bots, memory and backups are about to fail in confusing ways. One
// notification when it drops under 5 GiB free (or 5% of the disk), then
// silence until it has recovered; Settings > Computer care shows what can go.
import { diskSpace } from "./disk-usage.ts";

const GB = 1024 ** 3;
export const LOW_DISK_FLOOR_BYTES = 5 * GB;
const LOW_DISK_FRACTION = 0.05;

export interface DiskNumbers { freeBytes: number | null; totalBytes: number | null }

export function isDiskLow(disk: DiskNumbers): boolean {
  if (disk.freeBytes === null) return false;
  if (disk.freeBytes < LOW_DISK_FLOOR_BYTES) return true;
  return disk.totalBytes !== null && disk.totalBytes > 0 && disk.freeBytes / disk.totalBytes < LOW_DISK_FRACTION;
}

export function lowDiskText(disk: DiskNumbers): { title: string; body: string } {
  const left = `${((disk.freeBytes ?? 0) / GB).toFixed(1)} GB left.`;
  return {
    title: "The computer is running low on disk space",
    body: `${left} Free some space (Settings > Computer care shows what can go) so bots can keep working.`,
  };
}

/** Checks soon after start, then every `intervalMs`; calls `notify` once per
 * low spell. Returns a stop function. Never throws into the server. */
export function startLowDiskWatch(options: {
  dir: string;
  notify: (text: { title: string; body: string }) => void;
  check?: (dir: string) => Promise<DiskNumbers>;
  intervalMs?: number;
  firstCheckMs?: number;
}): () => void {
  const check = options.check ?? diskSpace;
  let told = false;
  const run = async () => {
    try {
      const disk = await check(options.dir);
      if (!isDiskLow(disk)) { told = false; return; }
      if (told) return;
      told = true;
      options.notify(lowDiskText(disk));
    } catch {
      /* a failed check must never take down the server */
    }
  };
  const first = setTimeout(() => void run(), options.firstCheckMs ?? 60_000);
  const every = setInterval(() => void run(), options.intervalMs ?? 30 * 60_000);
  first.unref?.();
  every.unref?.();
  return () => { clearTimeout(first); clearInterval(every); };
}
