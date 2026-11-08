// Unattended access tools for a bot turn (agents catalog, #2714): the install
// code with the exact command per OS, so a bot never searches the disk for an
// installer. Same Perspicax tool and defaults as the Computers panel
// (remote-unattended-hosts.ts installCode).

import { UNATTENDED_HOST_SCOPES, type UnattendedHostScope } from "../../shared/remote-unattended-host.ts";
import { HOST_CODE_TOOL, hostInstallCommand } from "./remote-unattended-hosts.ts";
import type { RemoteSupportContext } from "./remote-support-local.ts";

/** Said as is when the person asks where the host package is: the honest
 * state of the published builds (sagax-remote-access#7, #8; perspicax#1321). */
export const HOST_PACKAGE_NOTE = "The host program is sagax-remote-access (repo pulsatrixtechnologies/sagax-remote-access). Signed host builds for macOS and Linux are not published yet (sagax-remote-access#7), the enroll link does not download it yet (perspicax#1321), and the installed service serves sessions only once SAGAX_UNATTENDED_ACCESS=1 is on (sagax-remote-access#8). Say so in one sentence; do not search this computer for an installer.";

type Post = (tool: string, args: Record<string, unknown>) => Promise<{ status: number; body: Record<string, unknown> }>;

function powershellQuoted(value: string): string {
  // eslint-disable-next-line no-control-regex
  return `'${value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/'/g, "''")}'`;
}

/** The exact install line per OS. macOS and Linux run it as root (sudo);
 * Windows in an administrator PowerShell. */
export function hostInstallCommands(input: { org: string; code: string; scope: UnattendedHostScope; recordedBy: string }): { macos: string; linux: string; windows: string } {
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

function answerObject(text: unknown): Record<string, unknown> | null {
  if (typeof text !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** remote_support_host_code from a bot: Sagax fills the organization and the
 * scope as the Computers panel does, then answers the code with the install
 * line for each OS and the next step. */
export async function hostCodeCall(input: {
  args: Record<string, unknown>;
  local?: RemoteSupportContext;
  defaultOrg?: string;
  post: Post;
}): Promise<{ text: string; isError?: boolean }> {
  const given = typeof input.args.org === "string" ? input.args.org.trim() : "";
  const org = (given || input.defaultOrg?.trim() || input.local?.orgName?.trim() || "Sagax").slice(0, 128);
  const scope: UnattendedHostScope = (UNATTENDED_HOST_SCOPES as readonly string[]).includes(String(input.args.scope ?? ""))
    ? input.args.scope as UnattendedHostScope
    : "full-control";
  const forwarded: Record<string, unknown> = { org, scope };
  if (typeof input.args.consent_ref === "string" && input.args.consent_ref.trim()) forwarded.consent_ref = input.args.consent_ref.trim().slice(0, 256);
  if (typeof input.args.start_minutes === "number") forwarded.start_minutes = input.args.start_minutes;
  const posted = await input.post(HOST_CODE_TOOL, forwarded);
  if (posted.status >= 400 || posted.body.error || posted.body.isError === true) {
    return { text: String(posted.body.text ?? posted.body.error ?? "") || "Perspicax refused the install code.", isError: true };
  }
  const answer = answerObject(posted.body.text) ?? {};
  const code = typeof answer.code === "string" ? answer.code.trim() : "";
  if (!code) return { text: "Perspicax did not return an install code.", isError: true };
  const answeredOrg = typeof answer.org === "string" && answer.org.trim() ? answer.org.trim().slice(0, 128) : org;
  const answeredScope = (UNATTENDED_HOST_SCOPES as readonly string[]).includes(String(answer.scope)) ? answer.scope as UnattendedHostScope : scope;
  return {
    text: JSON.stringify({
      code,
      ...(typeof answer.enroll_url === "string" ? { enroll_url: answer.enroll_url } : {}),
      org: answeredOrg,
      scope: answeredScope,
      ...(typeof answer.expires_at === "string" ? { expires_at: answer.expires_at } : {}),
      install_commands: hostInstallCommands({ org: answeredOrg, code, scope: answeredScope, recordedBy: input.local?.technicianName ?? "" }),
      next: "Give the person the line for the target OS in a code fence (or run it yourself when you have a shell on that computer). The code is single use and expires. Once it ran, call remote_support_hosts: the new computer shows as enrolled. Then remote_support_open with its host_id. A Linux server without a desktop enrolls as shell-only.",
      host_package: HOST_PACKAGE_NOTE,
    }),
  };
}
