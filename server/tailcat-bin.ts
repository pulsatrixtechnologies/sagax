// Where Sagax runs tailcat. A desktop app's PATH is /usr/bin:/bin:/usr/sbin:/sbin,
// so Homebrew is invisible, and a cloud computer cannot write into those
// directories. The copy shipped beside the app wins. Nothing here downloads
// a binary or writes into a system directory.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface TailcatLookup {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  exists?: (file: string) => boolean;
  resourcesPath?: string;
  appRoot?: string;
  dataDir?: string;
}

function executableName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "tailcat.exe" : "tailcat";
}

function absoluteHit(file: string, exists: (candidate: string) => boolean): string | null {
  return path.isAbsolute(file) && exists(file) ? file : null;
}

/** Absolute path of the tailcat Sagax should spawn, or null when none is present. */
export function resolveTailcatBinary(options: TailcatLookup = {}): string | null {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const exists = options.exists ?? existsSync;
  const name = executableName(platform);

  const override = env.SAGAX_TAILCAT_PATH?.trim();
  if (override) return absoluteHit(override, exists);

  const resources = (options.resourcesPath ?? env.SAGAX_RESOURCES_PATH)?.trim();
  if (resources) {
    const bundled = absoluteHit(path.join(resources, "tailcat", name), exists);
    if (bundled) return bundled;
  }

  const appRoot = options.appRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const staged = absoluteHit(path.join(appRoot, "dist-native", "tailcat", `${platform}-${arch}`, name), exists);
  if (staged) return staged;

  const dataDir = (options.dataDir ?? env.SAGAX_DATA_DIR)?.trim();
  if (dataDir) {
    const dropped = absoluteHit(path.join(dataDir, "tailcat", name), exists);
    if (dropped) return dropped;
  }

  const wellKnown = platform === "darwin"
    ? ["/opt/homebrew/bin/tailcat", "/usr/local/bin/tailcat"]
    : platform === "linux"
      ? ["/usr/local/bin/tailcat"]
      : [];
  for (const candidate of wellKnown) {
    const found = absoluteHit(candidate, exists);
    if (found) return found;
  }

  const pathEntry = Object.entries(env).find(([key]) => key.toLowerCase() === "path");
  const pathValue = pathEntry?.[1];
  if (!pathValue) return null;
  const delimiter = platform === "win32" ? ";" : ":";
  for (const directory of pathValue.split(delimiter)) {
    if (!directory || !path.isAbsolute(directory)) continue;
    const found = absoluteHit(path.join(directory, name), exists);
    if (found) return found;
  }
  return null;
}

/** The system ssh client `tailcat ssh` and `tailcat cp` exec (tailcat is only
 * its ProxyCommand), or null when this host has none: then no remote shell,
 * probe, screenshot or file transfer can work here, and callers say so
 * instead of starting a shell that ends at once. */
export function resolveSystemSsh(options: Pick<TailcatLookup, "env" | "platform" | "exists"> = {}): string | null {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const name = platform === "win32" ? "ssh.exe" : "ssh";
  const pathEntry = Object.entries(env).find(([key]) => key.toLowerCase() === "path");
  const delimiter = platform === "win32" ? ";" : ":";
  const flavor = platform === "win32" ? path.win32 : path.posix;
  const dirs = String(pathEntry?.[1] ?? "").split(delimiter).filter((dir) => dir && flavor.isAbsolute(dir));
  if (platform !== "win32") for (const dir of ["/usr/bin", "/bin", "/usr/local/bin"]) if (!dirs.includes(dir)) dirs.push(dir);
  for (const dir of dirs) {
    const candidate = flavor.join(dir, name);
    if (exists(candidate)) return candidate;
  }
  return null;
}
