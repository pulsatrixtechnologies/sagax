// Who wrote a change, for the history (#4940, owner decision 2026-11-19): the person in
// the app, the person in the Perspicax console, an AI client (an agent) by
// MCP or API in the person's name, or a bot acting for its person, with the
// caller's identity.
import type { RequestAuth } from "./auth/request-auth.ts";
import { isBotActSession } from "./auth/sessions.ts";

export type HistoryWriterKind = "person" | "agent" | "bot";
export type HistoryWriterVia = "app" | "console" | "mcp" | "bot-act";

export interface HistoryWriter {
  kind: HistoryWriterKind;
  via: HistoryWriterVia;
  /** The person the change was made as (their principal), when known. */
  principalId?: string;
  /** The person's name, as the session carries it. */
  name?: string;
  /** The AI client Perspicax signed (`client_name`), for an agent. */
  client?: string;
}

/** What an act-as session opened for the member API carries
 * (server/index-leaves/performAsMember.ts). */
export interface SessionWriterStamp {
  kind: "person" | "agent";
  via: "console" | "mcp";
  client?: string;
}

/** The member API actor, as performAsMember stamps its act-as session:
 * console is the person in the Perspicax console, anything else an AI
 * client by MCP or API. */
export function writerStampForActor(actor: string | undefined, client: string | undefined): SessionWriterStamp {
  if (actor === "console") return { kind: "person", via: "console" };
  const name = client?.trim().slice(0, 120);
  return { kind: "agent", via: "mcp", ...(name ? { client: name } : {}) };
}

/** The writer of a request: undefined when nothing is known. */
export function historyWriterOf(auth: RequestAuth | null | undefined): HistoryWriter | undefined {
  if (!auth) return undefined;
  if (auth.kind === "loopback") return { kind: "person", via: "app" };
  const session = auth.session;
  const principalId = session.principalId?.trim() || undefined;
  const who = principalId ? { principalId } : {};
  const stamp = session.writer;
  if (stamp) {
    const name = session.label?.trim();
    return {
      kind: stamp.kind, via: stamp.via, ...who,
      ...(name ? { name } : {}),
      ...(stamp.client ? { client: stamp.client } : {}),
    };
  }
  if (isBotActSession(session)) return { kind: "bot", via: "bot-act", ...who };
  return { kind: "person", via: "app", ...who };
}
