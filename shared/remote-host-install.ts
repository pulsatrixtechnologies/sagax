// The exact install line of the unattended host per OS (sagax-remote-access
// docs: install --unattended). Shared so the server tools and the Add computer
// dialog print the same command (#2714, #2723). Consent is recorded by
// Perspicax at enrollment; the flag names the person who set it up.
import type { UnattendedHostScope } from "./remote-unattended-host.ts";

export type HostInstallInput = { org: string; code: string; scope: UnattendedHostScope; recordedBy: string };

/** A shell-safe double-quoted argument (no control characters). */
function quoted(value: string): string {
  // eslint-disable-next-line no-control-regex
  return `"${value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/["\\$`]/g, "\\$&")}"`;
}

function powershellQuoted(value: string): string {
  // eslint-disable-next-line no-control-regex
  return `'${value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/'/g, "''")}'`;
}

/** The command the person runs on the computer to install the host. */
export function hostInstallCommand(input: HostInstallInput): string {
  return [
    "sagax-remote-access install --unattended",
    `--org ${quoted(input.org)}`,
    `--code ${quoted(input.code)}`,
    `--scope ${input.scope}`,
    `--consent-recorded-by ${quoted(input.recordedBy || "Sagax")}`,
  ].join(" ");
}

/** The exact install line per OS. macOS and Linux run it as root (sudo);
 * Windows in an administrator PowerShell. */
export function hostInstallCommands(input: HostInstallInput): { macos: string; linux: string; windows: string } {
  const posix = `sudo ${hostInstallCommand(input)}`;
  const windows = [
    "sagax-remote-access.exe install --unattended",
    `--org ${powershellQuoted(input.org)}`,
    `--code ${powershellQuoted(input.code)}`,
    `--scope ${input.scope}`,
    `--consent-recorded-by ${powershellQuoted(input.recordedBy || "Sagax")}`,
  ].join(" ");
  return { macos: posix, linux: posix, windows };
}
