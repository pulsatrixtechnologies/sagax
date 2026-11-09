/** #3063: what the pi driver does when pi exits because an extension failed
 * to load. Only that one extension of the kit is left out, and only when it
 * is not a guard; a guard, the Sagax extension or an extension Sagax cannot
 * name fails the turn with words the person reads in the chat. The left-out
 * extension is remembered for the life of the process (one pi a turn, not
 * two), until the kit's file changes. */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import type { PiKitSkip } from "./pi-kit.ts";

/** pi's line when it exited because an extension failed to load
 * ("Failed to load extension <error> <path>"), else null. */
export function piExtensionLoadFailure(stderr: string): string | null {
  const line = stderr.split(/\r?\n/).find((text) => /Failed to load extension/i.test(text));
  return line ? line.trim().slice(0, 500) : null;
}

/** What one turn loaded from the kit (`-e` values). */
export type PiKitLoad = { args: string[]; guards: string[] };

export type PiExtensionVerdict =
  | { kind: "skip"; arg: string }
  | { kind: "guard"; arg: string }
  | { kind: "unknown" };

/** Which `-e` the failure line names: the longest kit value it contains
 * (a package folder names a file inside it), the Sagax extension as a
 * guard, anything else unknown. */
export function classifyPiExtensionFailure(line: string, kit: PiKitLoad, sagaxExtension?: string): PiExtensionVerdict {
  const norm = (path: string) => path.replace(/\\/g, "/");
  const text = norm(line);
  if (sagaxExtension && text.includes(norm(sagaxExtension))) return { kind: "guard", arg: sagaxExtension };
  const named = kit.args
    .filter((arg) => arg.length > 0 && text.includes(norm(arg)))
    .sort((a, b) => b.length - a.length)[0];
  if (!named) return { kind: "unknown" };
  return kit.guards.includes(named) ? { kind: "guard", arg: named } : { kind: "skip", arg: named };
}

/** A short name for the person: the file name, or the package source. */
export function piExtensionName(arg: string): string {
  return basename(arg.replace(/\\/g, "/")) || arg;
}

/** The chat line of a turn that runs without one or more kit extensions. */
export function piSkippedNotice(skipped: readonly string[]): string {
  const names = skipped.map(piExtensionName).join(", ");
  const reasons = skipped.map((arg) => left.get(arg)?.line).filter(Boolean).join(" | ");
  return `pi could not load the kit extension ${names}, so this turn runs without it. The other extensions and the guards stay on. Fix it in the pi kit folder; the next turn after the change loads it again.${reasons ? ` (pi said: "${reasons}")` : ""}`;
}

/** The chat line of a turn that failed because an extension did not load. */
export function piExtensionFailureMessage(verdict: PiExtensionVerdict, line: string): string {
  if (verdict.kind === "guard") {
    return `pi could not load the guard ${piExtensionName(verdict.arg)}, so the turn did not run: a turn never runs without its guards. Fix the extension in the pi kit folder, then send the message again. (pi said: "${line}")`;
  }
  if (verdict.kind === "skip") {
    return `pi could not load the kit extension ${piExtensionName(verdict.arg)}, and the turn already ran again without another one, so it stopped. Fix the pi kit, then send the message again. (pi said: "${line}")`;
  }
  return `pi could not load an extension, and Sagax cannot tell which one, so the turn did not run without it. Check the pi kit and the extensions in the pi home, then send the message again. (pi said: "${line}")`;
}

/** The fingerprint of a kit source: a file's content. A package (a folder
 * or a source pi resolves) changes only with a new image, so a new process. */
function fingerprint(source: string): string {
  try {
    if (statSync(source).isFile()) return createHash("sha256").update(readFileSync(source)).digest("hex");
  } catch {
    /* a package source or a missing file */
  }
  return "package";
}

/** `-e` value → pi's line and the kit source's fingerprint when it failed. */
const left = new Map<string, { line: string; fingerprint: string }>();

/** Remember that pi failed to load this kit `-e` value. */
export function leaveOutPiExtension(arg: string, line: string): void {
  // an extension's `-e` is its fresh copy in the pi home: the kit's content
  left.set(arg, { line, fingerprint: fingerprint(arg) });
}

/** The installPiKit skip: left out while the kit source is unchanged; a
 * changed (or fixed) source is loaded again. */
export const skipFailedPiExtension: PiKitSkip = (arg, source) => {
  const entry = left.get(arg);
  if (!entry) return false;
  if (entry.fingerprint === fingerprint(source)) return true;
  left.delete(arg);
  return false;
};

/** Tests only: forget every left-out extension. */
export function resetPiExtensionFailures(): void {
  left.clear();
}
