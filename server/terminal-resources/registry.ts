import type { TerminalResource, TerminalProviderKind } from "../../shared/terminal-resources.ts";
import type { TerminalAccess, TerminalListContext, TerminalOpenContext, TerminalResourceAdapter } from "./types.ts";

/** Whether this person may open this resource for this bot (2026-10-15,
 * 2026-10-19 JC): a server host is an organization admin's, a solo
 * operator's, or a person's an admin gave `host.commands` to in Perspicax.
 * A personal environment (their cloud computer, their Local VM, their own
 * computer) is always the person's own: they open it for their own bot, and
 * on an organization server from any conversation of theirs, whoever owns
 * the bot (the shell is theirs; a bot types in it only when they turn bot
 * input on). Answering someone else's card never opens one. No access
 * known: nothing. */
export function terminalResourceAllowed(resource: Pick<TerminalResource, "scope">, access: TerminalAccess | undefined): boolean {
  if (!access) return false;
  if ((resource.scope ?? "server") === "server") return access.admin || access.serverHosts === true;
  return access.ownsBot || access.admin || (access.organization && access.ownsConversation === true);
}

export class TerminalResourceRegistry {
  private readonly adapters = new Map<TerminalProviderKind, TerminalResourceAdapter>();

  register(adapter: TerminalResourceAdapter): void {
    this.adapters.set(adapter.kind, adapter);
  }

  adapter(kind: TerminalProviderKind): TerminalResourceAdapter | undefined {
    return this.adapters.get(kind);
  }

  /** Every resource this person may open for this bot. An adapter that fails
   * (a provisioner down, a desktop gone) offers nothing; the others still do. */
  async listAll(ctx: TerminalListContext): Promise<TerminalResource[]> {
    const out: TerminalResource[] = [];
    for (const adapter of this.adapters.values()) {
      const rows = await adapter.list(ctx).catch(() => []);
      out.push(...rows.filter((row) => terminalResourceAllowed(row, ctx.access)));
    }
    return out;
  }

  /** The resource when it exists AND this person may open it; else null. */
  async resolve(key: { provider: TerminalProviderKind; id: string }, ctx: TerminalListContext) {
    const adapter = this.adapters.get(key.provider);
    if (!adapter) return null;
    const resource = await adapter.resolve(key.id, ctx).catch(() => null);
    if (!resource || !terminalResourceAllowed(resource, ctx.access)) return null;
    return resource;
  }

  /** Opens only what resolve allows for the same person, checked again here:
   * a card answered later, or by someone else, never widens the rights. */
  async open(key: { provider: TerminalProviderKind; id: string }, ctx: TerminalOpenContext) {
    const adapter = this.adapters.get(key.provider);
    if (!adapter) throw new Error("Unknown provider");
    const resource = await this.resolve(key, ctx);
    if (!resource) throw Object.assign(new Error("You are not allowed to open a terminal on this destination."), { code: "terminal_forbidden" });
    return adapter.open(key.id, ctx);
  }
}
