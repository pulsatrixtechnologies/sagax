// Owner-only protection for the data folder (#5258).
//
// POSIX: callers pass mode 0o600 / 0o700 to writeFileAtomic and mkdirSync; the
// mode bits are the protection.
// Windows: Node reports 0o666 for every writable file and chmod only toggles
// read-only, so this module sets an ACL (icacls) that leaves the owner,
// SYSTEM and Administrators, with inheritance from the parent turned off.
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { userInfo } from "node:os";

const SYSTEM_SID = "*S-1-5-18";
const ADMINISTRATORS_SID = "*S-1-5-32-544";

/** Well-known principals that must keep Full control on a private path. */
const REQUIRED_SID_MARKERS = [SYSTEM_SID, ADMINISTRATORS_SID] as const;

/** Principals that must never keep a grant on a private path. */
const FORBIDDEN_PRINCIPALS = [
  "everyone",
  "authenticated users",
  "builtin\\users",
  "nt authority\\authenticated users",
  "*s-1-1-0",
  "*s-1-5-11",
  "*s-1-5-32-545",
] as const;

export type IcaclsRunner = (args: string[]) => string;

let runIcacls: IcaclsRunner = (args) =>
  execFileSync("icacls", args, { encoding: "utf8", windowsHide: true, timeout: 15_000 });
let platformForTests: NodeJS.Platform | null = null;

/** Tests only: replace the icacls runner and/or pretend the host is Windows. */
export function setOwnerOnlyAclTestHooks(hooks: {
  runner?: IcaclsRunner | null;
  platform?: NodeJS.Platform | null;
} | null): void {
  if (!hooks) {
    runIcacls = (args) =>
      execFileSync("icacls", args, { encoding: "utf8", windowsHide: true, timeout: 15_000 });
    platformForTests = null;
    return;
  }
  if (hooks.runner !== undefined) {
    runIcacls = hooks.runner ?? ((args) =>
      execFileSync("icacls", args, { encoding: "utf8", windowsHide: true, timeout: 15_000 }));
  }
  if (hooks.platform !== undefined) platformForTests = hooks.platform;
}

function onWindows(): boolean {
  return (platformForTests ?? process.platform) === "win32";
}

function ownerGrant(): string {
  // Domain and local accounts: the process owner's account name is what
  // icacls accepts without looking up a SID at write time.
  const name = userInfo().username;
  if (!name.trim()) throw new Error("Cannot resolve the process owner for an owner-only ACL");
  return name;
}

function inheritFlags(directory: boolean): string {
  // (OI)(CI): new files and folders under a protected data dir keep the same
  // owner-only ACL. Files themselves need no inherit flags.
  return directory ? "(OI)(CI)F" : "F";
}

/** Apply the owner / SYSTEM / Administrators ACL and turn inheritance off. */
export function ensureOwnerOnlyAcl(path: string, options: { directory?: boolean } = {}): void {
  if (!onWindows()) return;
  const rights = inheritFlags(Boolean(options.directory));
  const owner = ownerGrant();
  // /inheritance:r removes inherited ACEs from the parent. /grant:r replaces
  // each named principal's grants so a prior Everyone ACE cannot linger.
  runIcacls([path, "/inheritance:r"]);
  runIcacls([
    path,
    "/grant:r",
    `${owner}:${rights}`,
    `${SYSTEM_SID}:${rights}`,
    `${ADMINISTRATORS_SID}:${rights}`,
  ]);
}

/** True when icacls output describes an owner-only ACL (#5258). */
export function aclOutputIsOwnerOnly(output: string): boolean {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^successfully processed/i.test(line) && !/^processed file/i.test(line));
  // Drop the path-only first token line when icacls prints "path ACE" on one line
  // or "path\n ACE" on two. Keep every ACE-looking fragment.
  const aces = lines.flatMap((line) => {
    const match = line.match(/^(?:.+?:\s+)?(.+?:\([^)]+\).*)$/i) ?? line.match(/^(.+?:\([^)]+\).*)$/);
    if (match) return [match[1]!.trim()];
    // "PATH BUILTIN\Administrators:(F)" on one line
    const inline = [...line.matchAll(/((?:[\w.\\*-]+|\*S-1-[\d-]+):\([A-Z0-9(),]+\))/gi)];
    return inline.map((hit) => hit[1]!);
  });
  if (!aces.length) return false;
  const lowered = aces.map((ace) => ace.toLowerCase());
  for (const forbidden of FORBIDDEN_PRINCIPALS) {
    if (lowered.some((ace) => ace.startsWith(`${forbidden}:`) || ace.includes(`${forbidden}:`))) return false;
  }
  // SYSTEM and Administrators must appear (SID or localized name).
  const hasSystem = lowered.some((ace) =>
    ace.includes("s-1-5-18") || ace.includes("nt authority\\system") || ace.startsWith("system:"));
  const hasAdmins = lowered.some((ace) =>
    ace.includes("s-1-5-32-544") || ace.includes("builtin\\administrators") || ace.includes("administrators:"));
  if (!hasSystem || !hasAdmins) return false;
  // At least one ACE left that is not SYSTEM/Administrators: the owner.
  const others = lowered.filter((ace) =>
    !(ace.includes("s-1-5-18") || ace.includes("nt authority\\system") || /(?:^|\\)system:/.test(ace)
      || ace.includes("s-1-5-32-544") || ace.includes("builtin\\administrators") || ace.includes("administrators:")));
  return others.length >= 1;
}

/** Read the ACL (Windows) and decide whether it is owner-only. */
export function isOwnerOnlyAcl(path: string): boolean {
  if (!onWindows()) return false;
  try {
    return aclOutputIsOwnerOnly(runIcacls([path]));
  } catch {
    return false;
  }
}

/**
 * True when the path is owner-only: POSIX mode bits with no group/other
 * access (0o600 / 0o700), or on Windows the owner / SYSTEM / Administrators
 * ACL with no Everyone grant (#5258).
 */
export function isOwnerOnlyProtected(path: string, kind: "file" | "directory" = "file"): boolean {
  if (onWindows()) return isOwnerOnlyAcl(path);
  const mode = statSync(path).mode & 0o777;
  return kind === "directory" ? mode === 0o700 : mode === 0o600;
}

/** Whether a mode bit asks for owner-only (private) protection. */
export function modeRequestsOwnerOnly(mode: number | undefined): boolean {
  if (mode === undefined) return false;
  // Any mode that denies group/other write+read the way 0o600 / 0o700 do.
  return (mode & 0o077) === 0;
}

export const OWNER_ONLY_ACL = {
  SYSTEM_SID,
  ADMINISTRATORS_SID,
  REQUIRED_SID_MARKERS,
} as const;
