import { randomUUID } from "node:crypto";

import {
  TERMINAL_IDLE_MS,
  TERMINAL_MAX_SESSIONS_PER_PERSON,
  type TerminalProviderKind,
  type TerminalSessionPublic,
  parseTerminalResourceKey,
} from "../../shared/terminal-resources.ts";
import type { TerminalAuditEvent } from "./terminal-audit.ts";
import type { TerminalAccess, TerminalAttachment } from "../terminal-resources/types.ts";
import type { TerminalResourceRegistry } from "../terminal-resources/registry.ts";

interface LiveSession {
  id: string;
  principalId: string;
  botId: string;
  threadId: string;
  resourceId: string;
  provider: TerminalProviderKind;
  label: string;
  hostLabel: string;
  openedAt: number;
  lastActivityAt: number;
  botInputAllowed: boolean;
  attachment?: TerminalAttachment;
  status: TerminalSessionPublic["status"];
  endedReason?: TerminalSessionPublic["endedReason"];
  /** The raw end of the output, for the ended card (record). */
  tail: string;
}

/** What an ended session hands to whoever keeps its chat card. */
export interface TerminalSessionEnded extends TerminalSessionPublic {
  principalId: string;
  botId: string;
  threadId: string;
  endedAt: number;
  /** Raw output tail (escape sequences included). */
  output: string;
}

/** Raw output kept per session: a few screens past the plain-text cap, since
 * escape sequences go away when it becomes text. */
const RAW_TAIL_MAX = 96_000;

export interface TerminalSessionManagerDeps {
  registry: TerminalResourceRegistry;
  now: () => number;
  audit: { write: (event: TerminalAuditEvent) => void };
  /** A session ended (exit, close, idle): its chat card folds and keeps the output. */
  onEnded?: (ended: TerminalSessionEnded) => void;
}

export function createTerminalSessionManager(deps: TerminalSessionManagerDeps) {
  const sessions = new Map<string, LiveSession>();
  const byPerson = new Map<string, Set<string>>();

  function touch(session: LiveSession) {
    session.lastActivityAt = deps.now();
  }

  function publicView(session: LiveSession): TerminalSessionPublic {
    return {
      id: session.id,
      resourceId: session.resourceId,
      provider: session.provider,
      hostLabel: session.hostLabel,
      label: session.label,
      status: session.status,
      endedReason: session.endedReason,
      openedAt: session.openedAt,
      lastActivityAt: session.lastActivityAt,
      botInputAllowed: session.botInputAllowed,
    };
  }

  function end(session: LiveSession, reason: TerminalSessionPublic["endedReason"]) {
    if (session.status === "ended") return;
    session.status = "ended";
    session.endedReason = reason;
    session.attachment?.close();
    session.attachment = undefined;
    deps.audit.write({
      at: deps.now(), kind: "session.ended", principalId: session.principalId, sessionId: session.id, reason: reason ?? "closed",
      resourceId: `${session.provider}:${session.resourceId}`, provider: session.provider, botId: session.botId, threadId: session.threadId,
    });
    try {
      deps.onEnded?.({
        ...publicView(session),
        principalId: session.principalId,
        botId: session.botId,
        threadId: session.threadId,
        endedAt: deps.now(),
        output: session.tail,
      });
    } catch { /* the card keeps its last state */ }
    session.tail = "";
  }

  function sweepIdle() {
    const now = deps.now();
    for (const session of sessions.values()) {
      if (session.status !== "live") continue;
      if (now - session.lastActivityAt > TERMINAL_IDLE_MS) {
        deps.audit.write({ at: now, kind: "session.idle", principalId: session.principalId, sessionId: session.id });
        end(session, "idle");
      }
    }
  }

  const sweep = setInterval(sweepIdle, 30_000);
  sweep.unref();

  return {
    get(sessionId: string) {
      const session = sessions.get(sessionId);
      return session ? publicView(session) : null;
    },
    liveForPerson(principalId: string) {
      const ids = byPerson.get(principalId);
      if (!ids) return 0;
      let count = 0;
      for (const id of ids) {
        if (sessions.get(id)?.status === "live") count++;
      }
      return count;
    },
    async open(input: {
      principalId: string;
      botId: string;
      threadId: string;
      resourceKey: string;
      label: string;
      hostLabel: string;
      /** Who is opening it, for the registry's rights check. */
      access: TerminalAccess;
      cols: number;
      rows: number;
    }) {
      sweepIdle();
      const parsed = parseTerminalResourceKey(input.resourceKey);
      if (!parsed) throw new Error("invalid resource");
      const live = this.liveForPerson(input.principalId);
      if (live >= TERMINAL_MAX_SESSIONS_PER_PERSON) throw new Error("session_limit");
      const id = randomUUID();
      const session: LiveSession = {
        id,
        principalId: input.principalId,
        botId: input.botId,
        threadId: input.threadId,
        resourceId: parsed.id,
        provider: parsed.provider,
        label: input.label,
        hostLabel: input.hostLabel,
        openedAt: deps.now(),
        lastActivityAt: deps.now(),
        botInputAllowed: false,
        status: "connecting",
        tail: "",
      };
      sessions.set(id, session);
      let set = byPerson.get(input.principalId);
      if (!set) {
        set = new Set();
        byPerson.set(input.principalId, set);
      }
      set.add(id);
      try {
        session.attachment = await deps.registry.open(
          { provider: parsed.provider, id: parsed.id },
          {
            auth: {
              kind: "session" as const,
              session: { id: "terminal", principalId: input.principalId, scopes: ["client"] } as never,
              via: "cookie" as const,
              scopes: ["client"] as const,
            },
            principalId: input.principalId,
            botId: input.botId,
            threadId: input.threadId,
            sessionId: id,
            access: input.access,
            cols: input.cols,
            rows: input.rows,
          },
        );
        // The shell ending on its own (exit, a dropped connection) ends the
        // session too, so it is audited and stops counting.
        session.attachment.output.once("end", () => end(session, "closed"));
        session.attachment.output.once("close", () => end(session, "closed"));
        session.status = "live";
        deps.audit.write({
          at: deps.now(),
          kind: "session.opened",
          principalId: input.principalId,
          sessionId: id,
          resourceId: input.resourceKey,
          provider: parsed.provider,
          botId: input.botId,
          threadId: input.threadId,
        });
      } catch (error) {
        end(session, "error");
        throw error;
      }
      return publicView(session);
    },
    /** The widget's new size, for the live shell of this person only. */
    resize(sessionId: string, principalId: string, cols: number, rows: number) {
      const session = sessions.get(sessionId);
      if (!session || session.principalId !== principalId || session.status !== "live" || !session.attachment) return false;
      touch(session);
      try { session.attachment.resize(cols, rows); } catch { /* a closed shell */ }
      return true;
    },
    attachIo(sessionId: string, principalId: string) {
      const session = sessions.get(sessionId);
      if (!session || session.principalId !== principalId) return null;
      if (session.status !== "live" || !session.attachment) return null;
      touch(session);
      return session.attachment;
    },
    /** Output the widget was sent, kept (the end only) for the ended card. */
    record(sessionId: string, chunk: Buffer | string) {
      const session = sessions.get(sessionId);
      if (!session || session.status !== "live") return;
      const next = session.tail + (typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      session.tail = next.length > RAW_TAIL_MAX ? next.slice(next.length - RAW_TAIL_MAX) : next;
    },
    noteActivity(sessionId: string, principalId: string) {
      const session = sessions.get(sessionId);
      if (!session || session.principalId !== principalId || session.status !== "live") return false;
      touch(session);
      return true;
    },
    setBotInput(sessionId: string, principalId: string, allowed: boolean) {
      const session = sessions.get(sessionId);
      if (!session || session.principalId !== principalId) return false;
      session.botInputAllowed = allowed;
      deps.audit.write({ at: deps.now(), kind: "bot.input", principalId, sessionId, allowed });
      return true;
    },
    close(sessionId: string, principalId: string) {
      const session = sessions.get(sessionId);
      if (!session || session.principalId !== principalId) return false;
      end(session, "closed");
      return true;
    },
    stop() {
      clearInterval(sweep);
      for (const session of sessions.values()) end(session, "closed");
      sessions.clear();
      byPerson.clear();
    },
  };
}
