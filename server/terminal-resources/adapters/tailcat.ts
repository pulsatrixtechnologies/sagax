// A shell on the end user's computer through the Tailcat tunnel that already
// lives on this host (the session folder). The address is an argv element
// and is never returned to the client.
import { spawnScriptPty } from "../../../electron/script-pty.mjs";
import type { TerminalResource } from "../../../shared/terminal-resources.ts";
import type { TerminalAttachment, TerminalListContext, TerminalOpenContext, TerminalResourceAdapter } from "../types.ts";
import { tailcatEnv, tailcatPtyArgv } from "../../remote-session-probe.ts";
import { resolveSystemSsh, resolveTailcatBinary } from "../../tailcat-bin.ts";

export const NO_SSH_CLIENT = "This Sagax server has no ssh client, so the remote shell cannot open. Install openssh-client on the server.";

export interface TailcatTerminalTarget {
  id: string;
  hostLabel: string;
  label: string;
}

export function createTailcatAdapter(deps: {
  /** Connected sessions this person may open for this bot. */
  targets(principalId: string, botId: string | undefined): TailcatTerminalTarget[];
  /** The tunnel of this person's session: its Flow folder, or the support
   * folder of its code when that folder names this person and bot. */
  tunnel(principalId: string, botId: string | undefined, id: string): { keyPath: string; address: string } | null;
  /** The system ssh client tailcat execs (default: looked up on this host). */
  systemSsh?: () => string | null;
}): TerminalResourceAdapter {
  const systemSsh = deps.systemSsh ?? (() => resolveSystemSsh());
  const row = (target: TailcatTerminalTarget): TerminalResource => ({
    id: target.id,
    provider: "tailcat",
    label: target.label,
    hostLabel: target.hostLabel,
    status: "online",
    scope: "personal",
  });
  const find = (resourceId: string, ctx: TerminalListContext) =>
    deps.targets(ctx.principalId, ctx.botId).find((target) => target.id === resourceId) ?? null;

  return {
    kind: "tailcat",
    async list(ctx) {
      return deps.targets(ctx.principalId, ctx.botId)
        .filter((target) => deps.tunnel(ctx.principalId, ctx.botId, target.id))
        .map(row);
    },
    async resolve(resourceId, ctx) {
      const target = find(resourceId, ctx);
      if (!target || !deps.tunnel(ctx.principalId, ctx.botId, target.id)) return null;
      return row(target);
    },
    async open(resourceId, ctx: TerminalOpenContext): Promise<TerminalAttachment> {
      const target = find(resourceId, ctx);
      const tunnel = target ? deps.tunnel(ctx.principalId, ctx.botId, target.id) : null;
      if (!tunnel) throw new Error("This remote computer is not connected from here.");
      // tailcat ssh execs the system ssh client: without it the shell would
      // print one error and end, a terminal nobody can type in.
      if (!systemSsh()) throw new Error(NO_SSH_CLIENT);
      try {
        const bin = resolveTailcatBinary() ?? "tailcat";
        return spawnScriptPty(tailcatPtyArgv(bin, tunnel.keyPath, tunnel.address), {
          cols: ctx.cols,
          rows: ctx.rows,
          env: tailcatEnv(),
        });
      } catch {
        throw new Error("This remote computer did not open a shell.");
      }
    },
  };
}
