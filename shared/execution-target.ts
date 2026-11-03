// Where a tool ran, as the transcript names it (organization mode):
// "Your computer" for the person's own desktop, "Your server environment" for
// their per-person sandbox on the server (server/sandbox/user-sandbox-routing.ts).
// Read from the tool's name alone, like shared/tool-surface.ts.

export type ToolExecutionTarget = "user-desktop" | "user-sandbox";

/** The MCP server the server environment tools are mounted under. Keep in
 * sync with USER_SANDBOX_MCP_NAME in server/sandbox/user-sandbox-routing.ts. */
export const USER_SANDBOX_SERVER = "sagax-environment";

/** The MCP server the desktop bridge tools are mounted under (the person's
 * own computer through their desktop app). Keep in sync with
 * DESKTOP_BRIDGE_MCP_NAME in shared/bot-workplace.ts. */
export const USER_DESKTOP_SERVER = "sagax-desktop";

const fromServer = (name: string, server: string) =>
  name.startsWith(`mcp__${server}__`) || name.startsWith(`${server}__`) || name.startsWith(`${server}_`);

/** `mcp__sagax-environment__run_command`, `sagax-environment__run_command`
 * (desktop names) or pi's `sagax-environment_run_command`. */
export function toolExecutionTarget(toolName: string, place?: string | null): ToolExecutionTarget | null {
  const name = toolName.toLowerCase();
  if (fromServer(name, USER_SANDBOX_SERVER)) return "user-sandbox";
  if (fromServer(name, USER_DESKTOP_SERVER)) return "user-desktop";
  return place === "local" ? "user-desktop" : null;
}

/** The MCP server computer_select is mounted under (Auto Works on). Keep in
 * sync with AUTO_COMPUTER_MCP_NAME in server/computer/auto-computer.ts. */
export const AUTO_COMPUTER_SERVER = "sagax-computer";

export type SelectedComputer = "cloud" | "this_computer" | "local_vm" | "browser";

/** A computer_select call that named a target: where the bot works from
 * that step on, read from the call's input. Null for any other tool, or a
 * call that only asked where it works. */
export function computerSelectTarget(toolName: string, input?: string | null): SelectedComputer | null {
  const name = toolName.toLowerCase();
  if (!fromServer(name, AUTO_COMPUTER_SERVER) || !name.endsWith("computer_select")) return null;
  const match = /"target"\s*:\s*"(cloud|this_computer|local_vm|browser)"/.exec(input ?? "");
  return match ? match[1] as SelectedComputer : null;
}
