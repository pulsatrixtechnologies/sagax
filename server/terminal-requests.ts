import { randomUUID } from "node:crypto";

import type { TerminalDestinationPick, TerminalRequestCardData } from "../shared/terminal-request.ts";
import {
  TERMINAL_DEFAULT_COLS,
  TERMINAL_DEFAULT_ROWS,
  terminalResourceKey,
  type TerminalDestinationChoice,
  type TerminalProviderKind,
  type TerminalResource,
} from "../shared/terminal-resources.ts";
import type { TerminalAuditEvent } from "./terminal-audit.ts";
import type { Store } from "./store.ts";
import type { createTerminalSessionManager } from "./terminal-sessions.ts";
import type { TerminalResourceRegistry } from "./terminal-resources/registry.ts";
import type { TerminalAccess, TerminalListContext } from "./terminal-resources/types.ts";
import type { RequestAuth } from "./request-auth.ts";

/** Where the bot works now, as a terminal destination kind (2026-10-15):
 * the default of a card when the bot names none. */
export type TerminalWorkPlace = "sandbox" | "local-vm" | "desktop" | null;

export interface TerminalRequestServiceDeps {
  store: Store;
  registry: TerminalResourceRegistry;
  sessions: ReturnType<typeof createTerminalSessionManager>;
  principalId(auth: RequestAuth): string | undefined;
  audit: { write: (event: TerminalAuditEvent) => void };
  now: () => number;
  /** What this person may open for this bot (admin, own bot). */
  access(principalId: string, botId: string): TerminalAccess;
  /** Where this bot works in this conversation now (its Workspace, or the
   * place Auto chose), or null when it works nowhere a terminal reaches. */
  workPlace?(botId: string, threadId: string, principalId: string): TerminalWorkPlace;
  /** Whose conversation this is when the task names nobody (a solo server's
   * operator): the bot's owner. */
  owner?(botId: string, threadId: string): string;
  /** 2026-10-19 (JC: "Toujours permettre" on every card): the Always allow
   * this person kept for this bot and this destination, or null. */
  keptRule?(principalId: string, botId: string, candidate: { tool: string; scope: Record<string, string> }, threadId: string): { id: string } | null;
  /** One journal row for an offer a kept rule opened. */
  journalRule?(input: { threadId: string; botId: string; requestId: string; summary: string; rule: string }): void;
}

/** The card's choice when the bot names none: where the bot works, else the
 * person's own environments in a fixed order, else the first one offered. */
export function defaultTerminalDestination(resources: readonly TerminalResource[], workPlace: TerminalWorkPlace): TerminalResource | null {
  if (!resources.length) return null;
  const personal = (kind: string) => resources.find((row) => row.provider === kind && row.scope === "personal");
  if (workPlace) {
    const here = personal(workPlace);
    if (here) return here;
  }
  // A Tailcat session is opened by the remote-session offer, never as the
  // workplace fallback. It must not steal the card when it happens to be first.
  return personal("sandbox") ?? personal("local-vm") ?? personal("desktop") ?? resources.find((row) => row.provider !== "tailcat") ?? null;
}

function choiceOf(resource: TerminalResource): TerminalDestinationChoice {
  return { resourceId: resource.id, provider: resource.provider, label: resource.label, hostLabel: resource.hostLabel };
}

function listContext(principalId: string, botId: string, threadId: string, access: TerminalAccess): TerminalListContext {
  return {
    auth: {
      kind: "session" as const,
      session: { id: "internal", principalId, scopes: ["client"] } as never,
      via: "cookie" as const,
      scopes: ["client"] as const,
    },
    principalId,
    botId,
    threadId,
    access,
  };
}

export function createTerminalRequestService(deps: TerminalRequestServiceDeps) {
  const ownerOf = (botId: string, threadId: string) =>
    (deps.store.taskByThread(botId, threadId)?.ownerPrincipalId || deps.owner?.(botId, threadId) || "").trim().toLowerCase();
  /** What this person may open here: deps.access, plus whether this
   * conversation is their own (2026-10-19: their own environments open from
   * any conversation of theirs, whoever owns the bot). */
  const accessFor = (principalId: string, botId: string, threadId: string): TerminalAccess => {
    const person = principalId.trim().toLowerCase();
    return { ...deps.access(person, botId), ownsConversation: Boolean(person) && ownerOf(botId, threadId) === person };
  };

  /** What this person may open for this bot in this conversation: the list
   * behind list_terminal_resources and the card's menu. */
  async function destinations(args: { botId: string; threadId: string; principalId?: string }) {
    const principalId = args.principalId?.trim().toLowerCase() || ownerOf(args.botId, args.threadId);
    if (!principalId) return { principalId: "", resources: [] as TerminalResource[], defaultResource: null };
    const ctx = listContext(principalId, args.botId, args.threadId, accessFor(principalId, args.botId, args.threadId));
    const resources = await deps.registry.listAll(ctx);
    const workPlace = deps.workPlace?.(args.botId, args.threadId, principalId) ?? null;
    return { principalId, resources, defaultResource: defaultTerminalDestination(resources, workPlace) };
  }

  return {
    destinations,

    /** The bot's offer: one card, with the bot's destination (or where it
     * works) and every other destination this person may pick instead. */
    async submit(args: {
      botId: string;
      threadId: string;
      /** Both absent: the default (where the bot works). */
      resourceId?: string;
      provider?: TerminalProviderKind;
      reason: string;
      principalId?: string;
    }): Promise<{ requestId: string; messageId: string; resource: TerminalResource } | { error: string }> {
      const { principalId, resources, defaultResource } = await destinations(args);
      if (!principalId) return { error: "No person owns this conversation, so no terminal can be offered." };
      const named = Boolean(args.provider || args.resourceId);
      const resource = named
        ? resources.find((row) => (!args.provider || row.provider === args.provider) && (!args.resourceId || row.id === args.resourceId)) ?? null
        : defaultResource;
      if (!resource) {
        return { error: named
          ? "That destination is unavailable, unknown, or not one this person may open. Call list_terminal_resources for the destinations they may open, or leave the destination out to offer where you work."
          : "No terminal destination is available to this person here. Tell them; nothing was opened." };
      }
      const requestId = randomUUID();
      const others = resources.filter((row) => !(row.provider === resource.provider && row.id === resource.id));
      const payload: TerminalRequestCardData = {
        requestId,
        resourceId: resource.id,
        provider: resource.provider,
        label: resource.label,
        hostLabel: resource.hostLabel,
        reason: args.reason.trim() || resource.label,
        botId: args.botId,
        threadId: args.threadId,
        destinations: [choiceOf(resource), ...others.map(choiceOf)],
      };
      const bot = deps.store.bot(args.botId);
      // what Always allow keeps: this bot, this destination
      const rule = { tool: "sagax:terminal", scope: { destination: terminalResourceKey(resource.provider, resource.id) }, description: `Open a terminal on ${resource.hostLabel}` };
      const message = deps.store.appendMessage(args.threadId, {
        role: "bot",
        kind: "options",
        from: bot ? { botId: bot.id, name: bot.name, color: bot.color } : undefined,
        card: {
          title: `Ouvrir un terminal sur ${resource.hostLabel}`,
          subtitle: payload.reason,
          options: ["Ouvrir un terminal", "Refuser"],
          requestId,
          tool: "shell_terminal",
          terminalRequest: payload,
          ownerRule: rule,
        },
      });
      deps.audit.write({
        at: deps.now(),
        kind: "session.requested",
        principalId,
        botId: args.botId,
        threadId: args.threadId,
        resourceId: terminalResourceKey(resource.provider, resource.id),
        provider: resource.provider,
        requestId,
      });
      const kept = deps.keptRule?.(principalId, args.botId, rule, args.threadId) ?? null;
      if (kept) {
        // the person's kept rule answers as them, with their own rights
        const opened = await this.resolve({ threadId: args.threadId, requestId, behavior: "allow", principalId });
        if (opened.claimed && "outcome" in opened && opened.outcome === "allowed-once") {
          deps.journalRule?.({ threadId: args.threadId, botId: args.botId, requestId, summary: payload.reason, rule: kept.id });
        }
      }
      return { requestId, messageId: message.id, resource };
    },

    /** The person's answer. `pick` is the destination they chose on the card
     * (absent: the bot's). Whoever answers, the shell opens under THEIR
     * rights: the registry checks the pick for them, and a personal
     * environment is always their own. */
    async resolve(args: {
      threadId: string;
      requestId: string;
      behavior: "allow" | "deny" | "answer";
      principalId: string;
      pick?: TerminalDestinationPick | null;
      cols?: number;
      rows?: number;
    }): Promise<
      | { claimed: false }
      | { claimed: true; status: number; error: string }
      | { claimed: true; outcome: "allowed-once" | "rejected"; alreadySettled?: true }
    > {
      const message = deps.store.messagesFor(args.threadId).find(
        (candidate) => candidate.card?.requestId === args.requestId && candidate.card.terminalRequest,
      );
      const card = message?.card;
      const request = card?.terminalRequest;
      if (!request || !card || !message) return { claimed: false };
      if (card.answered || card.dismissed) {
        return { claimed: true, outcome: card.answered === "allow" ? "allowed-once" : "rejected", alreadySettled: true };
      }
      if (args.behavior !== "allow") {
        deps.audit.write({ at: deps.now(), kind: "session.denied", principalId: args.principalId, requestId: args.requestId });
        deps.store.patchMessage(args.threadId, message.id, {
          card: { ...card, answered: "deny", dismissed: false, held: undefined },
        });
        return { claimed: true, outcome: "rejected" };
      }
      const principalId = args.principalId.trim().toLowerCase();
      const access = accessFor(principalId, request.botId, request.threadId);
      const wanted = args.pick ?? { provider: request.provider, resourceId: request.resourceId };
      const from = terminalResourceKey(request.provider, request.resourceId);
      const to = terminalResourceKey(wanted.provider, wanted.resourceId);
      // A pick must be one the card offered; the registry then checks it for
      // the person answering, whatever the card said.
      const offered = request.destinations ?? [{ resourceId: request.resourceId, provider: request.provider }];
      const resource = offered.some((row) => row.provider === wanted.provider && row.resourceId === wanted.resourceId)
        ? await deps.registry.resolve({ provider: wanted.provider, id: wanted.resourceId }, listContext(principalId, request.botId, request.threadId, access))
        : null;
      if (!resource) {
        // The card stays open: the person can pick a destination they may open.
        deps.audit.write({ at: deps.now(), kind: "session.refused", principalId, requestId: args.requestId, resourceId: to, provider: wanted.provider, reason: "not_allowed" });
        return { claimed: true, status: 403, error: "You are not allowed to open a terminal on this destination, or it is no longer available. Your own cloud computer, Local VM and computer are always yours; a host of the organization's server needs \"Run commands on the organization's server\", which an organization admin gives in Perspicax (Bot rights > Who has what)." };
      }
      if (to !== from) deps.audit.write({ at: deps.now(), kind: "session.destination", principalId, requestId: args.requestId, from, to });
      try {
        const session = await deps.sessions.open({
          principalId,
          botId: request.botId,
          threadId: request.threadId,
          resourceKey: to,
          label: resource.label,
          hostLabel: resource.hostLabel,
          access,
          cols: args.cols ?? TERMINAL_DEFAULT_COLS,
          rows: args.rows ?? TERMINAL_DEFAULT_ROWS,
        });
        const applied: TerminalRequestCardData = {
          ...request,
          resourceId: resource.id,
          provider: resource.provider,
          label: resource.label,
          hostLabel: resource.hostLabel,
          sessionId: session.id,
          appliedAt: deps.now(),
        };
        deps.store.patchMessage(args.threadId, message.id, {
          card: {
            ...card,
            answered: "allow",
            held: undefined,
            ...(to !== from ? { title: `Ouvrir un terminal sur ${resource.hostLabel}` } : {}),
            terminalRequest: applied,
          },
        });
        const bot = deps.store.bot(request.botId);
        deps.store.appendMessage(args.threadId, {
          role: "bot",
          kind: "text",
          from: bot ? { botId: bot.id, name: bot.name, color: bot.color } : undefined,
          text: "",
          terminalEmbed: {
            sessionId: session.id,
            resourceId: resource.id,
            provider: resource.provider,
            hostLabel: resource.hostLabel,
            label: resource.label,
            status: session.status,
          },
        });
        return { claimed: true, outcome: "allowed-once" };
      } catch (error) {
        const text = error instanceof Error ? error.message : "Could not open terminal";
        deps.audit.write({ at: deps.now(), kind: "session.refused", principalId, requestId: args.requestId, resourceId: to, provider: wanted.provider, reason: text.slice(0, 200) });
        deps.store.patchMessage(args.threadId, message.id, {
          card: { ...card, answered: "deny", subtitle: `${card.subtitle}\n\n${text}` },
        });
        return { claimed: true, status: 409, error: text };
      }
    },
  };
}

export async function resolveAndSendTerminal(
  res: { headersSent: boolean; writableEnded: boolean; writeHead: (code: number) => void; end: (body?: string) => void },
  service: ReturnType<typeof createTerminalRequestService>,
  args: Parameters<ReturnType<typeof createTerminalRequestService>["resolve"]>[0],
): Promise<boolean> {
  const result = await service.resolve(args);
  if (!result.claimed) return false;
  if ("status" in result) {
    res.writeHead(result.status);
    res.end(JSON.stringify({ error: result.error }));
    return true;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true, outcome: result.outcome, alreadySettled: result.alreadySettled === true }));
  return true;
}
