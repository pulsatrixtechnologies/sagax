// 2026-10-21 (parité R10, ligne 80): which app of this computer a screen
// action acts on, read by the server itself (never the model's words), so
// "Toujours permettre" can keep one app: "Cryptic peut voir Safari, y
// cliquer et y saisir du texte sur cet ordinateur".
//
// Only for the person's own Mac running this server (a desktop or a solo
// server on macOS, the host computer mounted as "computer" for the turn): a
// process id there is a process of this machine. Another computer (the
// desktop bridge of an organization server, a Local VM, a cloud computer)
// has its own process ids, so no app is read there and its cards keep the
// whole request, as before.
//
// Review of #954:
// - Asynchronous, off every subscriber: the bus holds the one permission
//   event while this reads (server/harness/bus.ts setPublishGate), never a
//   synchronous child process in the approval path.
// - The executable comes from the kernel (`lsof -d txt`, not argv[0]); only
//   an app installed where apps are installed counts; its identity is its
//   code signature (`codesign --verify`, then its Identifier and team; Apple's
//   own apps are team "apple"), never the folder's name. An unsigned app,
//   Sagax itself and every denied bundle id read as no app.
// - A `window_id` must belong to the pid (CoreGraphics' window list), and
//   typing goes only into a focused element that is not a password field
//   (Accessibility); when either cannot be checked, no app is read.
import { execFile } from "node:child_process";
import { homedir } from "node:os";

import { appBundleDenied, appBundleOf, appLabelFromPath, appRuleOffered, screenAppTarget, type ScreenAppIdentity, type ScreenAppTarget } from "../shared/computer-app.ts";

export type RunFile = (command: string, args: string[], timeoutMs: number) => Promise<{ stdout: string; stderr: string } | null>;

const runFile: RunFile = (command, args, timeoutMs) => new Promise((resolve) => {
  execFile(command, args, { timeout: timeoutMs, encoding: "utf8", maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
    resolve(error ? null : { stdout: String(stdout), stderr: String(stderr) });
  });
});

/** Where apps are installed on a Mac (Safari and the system's own apps live
 * in the cryptex volume). Not /System/Library/CoreServices as a whole: its
 * agents (Dock, Spotlight, the security dialogs) are no one's app. */
export function installedAppRoots(home: string = homedir()): string[] {
  return [
    "/Applications/",
    "/System/Applications/",
    "/System/Volumes/Preboot/Cryptexes/App/System/Applications/",
    "/System/Library/CoreServices/Applications/",
    `${home.replace(/\/+$/, "")}/Applications/`,
  ];
}

const WINDOW_SCRIPT = `ObjC.import('CoreGraphics');
function run(argv) {
  const pid = Number(argv[0]); const wid = Number(argv[1]);
  const list = ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, 0));
  for (let i = 0; i < list.count; i++) {
    const w = list.objectAtIndex(i);
    if (w.objectForKey('kCGWindowNumber').intValue === wid) return String(w.objectForKey('kCGWindowOwnerPID').intValue === pid);
  }
  return 'absent';
}`;

/** The focused element of the app (of the named window: it must be the
 * pid's frontmost window), as role and subrole. Attribute names are
 * NSStrings (`$('AXRole')`): a bare JS string makes the call fail
 * (-25201), and each value is cast back from its CF reference. Exported for
 * the test that keeps it that way. */
export const FOCUS_SCRIPT = `ObjC.import('ApplicationServices');
ObjC.import('CoreGraphics');
function run(argv) {
  const pid = Number(argv[0]);
  const wid = argv.length > 1 ? Number(argv[1]) : 0;
  if (wid) {
    const list = ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0));
    let front = 0;
    for (let i = 0; i < list.count; i++) {
      const w = list.objectAtIndex(i);
      if (w.objectForKey('kCGWindowOwnerPID').intValue === pid && w.objectForKey('kCGWindowLayer').intValue === 0) { front = w.objectForKey('kCGWindowNumber').intValue; break; }
    }
    if (front !== wid) return 'other-window';
  }
  if (!$.AXIsProcessTrusted()) return 'untrusted';
  const app = $.AXUIElementCreateApplication(pid);
  const focused = Ref();
  if ($.AXUIElementCopyAttributeValue(app, $('AXFocusedUIElement'), focused) !== 0) return 'unknown';
  const element = ObjC.castRefToObject(focused[0]);
  const role = Ref();
  const sub = Ref();
  const roleText = $.AXUIElementCopyAttributeValue(element, $('AXRole'), role) === 0 ? ObjC.unwrap(ObjC.castRefToObject(role[0])) : '';
  const subText = $.AXUIElementCopyAttributeValue(element, $('AXSubrole'), sub) === 0 ? ObjC.unwrap(ObjC.castRefToObject(sub[0])) : '';
  return 'role=' + roleText + ';sub=' + subText;
}`;

/** A focused element a typing call may go into: read, and not secure. */
export function focusAllowsTyping(answer: string | null): boolean {
  if (!answer || !answer.startsWith("role=")) return false;
  return !/securetextfield/i.test(answer);
}

/** Identifier and team of a signed app bundle, from `codesign -dv`. */
export function signatureOf(text: string): { bundleId: string; team: string } | null {
  const id = /^Identifier=(.+)$/m.exec(text)?.[1]?.trim();
  const team = /^TeamIdentifier=(.+)$/m.exec(text)?.[1]?.trim();
  if (!id) return null;
  if (team && team !== "not set" && /^[A-Z0-9]{10}$/.test(team)) return { bundleId: id, team };
  // Apple's own apps: no team, signed by Apple's software signing
  if (/^Authority=(?:macOS )?Software Signing$/m.test(text)) return { bundleId: id, team: "apple" };
  return null;
}

const PID_MS = 3_000;

export class ComputerAppReader {
  private readonly run: RunFile;
  private readonly platform: NodeJS.Platform;
  private readonly now: () => number;
  private readonly roots: string[];
  private readonly ownBundle: string | null;
  private readonly pidCache = new Map<number, { at: number; path: string | null }>();
  private readonly signatureCache = new Map<number, { at: number; identity: { bundleId: string; team: string } | null }>();

  constructor(options: { run?: RunFile; platform?: NodeJS.Platform; now?: () => number; roots?: string[]; ownExecutable?: string } = {}) {
    this.run = options.run ?? runFile;
    this.platform = options.platform ?? process.platform;
    this.now = options.now ?? Date.now;
    this.roots = options.roots ?? installedAppRoots();
    this.ownBundle = appBundleOf(options.ownExecutable ?? process.execPath);
  }

  /** Whether a call names an app an app rule could cover (cheap, no I/O). */
  candidate(tool: string | undefined, input: string | undefined): ScreenAppTarget | null {
    return this.platform === "darwin" ? screenAppTarget(tool, input) : null;
  }

  private async pathOf(pid: number): Promise<string | null> {
    const now = this.now();
    const cached = this.pidCache.get(pid);
    if (cached && now - cached.at < PID_MS) return cached.path;
    const out = await this.run("/usr/sbin/lsof", ["-a", "-p", String(pid), "-d", "txt", "-Fn"], 1_500);
    const line = out?.stdout.split("\n").find((row) => row.startsWith("n/"));
    const path = line ? line.slice(1) : null;
    if (this.pidCache.size > 256) this.pidCache.clear();
    this.pidCache.set(pid, { at: now, path });
    return path;
  }

  /** The code signature of the RUNNING process (codesign takes a pid: the
   * kernel's view of the code it runs, re-checked every few seconds), not
   * of the files on disk, which may have changed since it started (review
   * of #954). */
  private async signature(pid: number): Promise<{ bundleId: string; team: string } | null> {
    const now = this.now();
    const cached = this.signatureCache.get(pid);
    if (cached && now - cached.at < PID_MS) return cached.identity;
    const verified = await this.run("/usr/bin/codesign", ["--verify", String(pid)], 5_000);
    const shown = verified ? await this.run("/usr/bin/codesign", ["-dv", "--verbose=2", String(pid)], 5_000) : null;
    const identity = shown ? signatureOf(`${shown.stdout}\n${shown.stderr}`) : null;
    if (this.signatureCache.size > 256) this.signatureCache.clear();
    this.signatureCache.set(pid, { at: now, identity });
    return identity;
  }

  /** The identity of the app a call of this computer's own screen acts on,
   * or null when no app rule may cover it (see the header). */
  async identify(tool: string | undefined, input: string | undefined): Promise<ScreenAppIdentity | null> {
    const target = this.candidate(tool, input);
    if (!target) return null;
    const path = await this.pathOf(target.pid);
    if (!path || !this.roots.some((root) => path.startsWith(root))) return null;
    const bundle = appBundleOf(path);
    const label = appLabelFromPath(path);
    if (!bundle || !label || (this.ownBundle && bundle === this.ownBundle)) return null;
    const signed = await this.signature(target.pid);
    if (!signed) return null;
    const identity: ScreenAppIdentity = { label, bundleId: signed.bundleId, team: signed.team };
    if (!appRuleOffered(identity) || appBundleDenied(identity.bundleId)) return null;
    if (target.windowId !== undefined) {
      const owns = await this.run("/usr/bin/osascript", ["-l", "JavaScript", "-e", WINDOW_SCRIPT, String(target.pid), String(target.windowId)], 2_000);
      if (owns?.stdout.trim() !== "true") return null;
    }
    if (target.focusCheck) {
      // with a window_id, the focus of that window (it must be the pid's frontmost)
      const focus = await this.run("/usr/bin/osascript", ["-l", "JavaScript", "-e", FOCUS_SCRIPT, String(target.pid), ...(target.windowId !== undefined ? [String(target.windowId)] : [])], 2_000);
      if (!focusAllowsTyping(focus?.stdout.trim() ?? null)) return null;
    }
    return identity;
  }
}
