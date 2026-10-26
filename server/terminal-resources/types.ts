import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Duplex } from "node:stream";

import type { RequestAuth } from "../request-auth.ts";
import type { TerminalProviderKind, TerminalResource } from "../../shared/terminal-resources.ts";

/** What the server knows about the person asking, for one bot. Built by
 * index.ts (terminalAccessFor) and checked by the registry on every list,
 * resolve and open. */
export interface TerminalAccess {
  /** An organization server (Perspicax sign-in). Solo: the operator only. */
  organization: boolean;
  /** Organization admin, or the operator of a solo server. Server hosts
   * (SSH, unRAID, VPS) are theirs only. */
  admin: boolean;
  /** The bot is this person's own. A personal environment opens for one's
   * own bot; an admin may also open their own environment for another bot. */
  ownsBot: boolean;
  /** 2026-10-19: the person holds `host.commands` (given by an admin in
   * Perspicax): the server's hosts open for them too. */
  serverHosts?: boolean;
  /** 2026-10-19: the conversation is this person's own (they talk to the
   * bot in it, whoever owns the bot): their own environments open from it.
   * Set by terminal-requests.ts, which knows the conversation. */
  ownsConversation?: boolean;
}

export interface TerminalListContext {
  auth: RequestAuth;
  principalId: string;
  botId?: string;
  threadId?: string;
  /** Absent: nothing is offered (fail closed). */
  access?: TerminalAccess;
}

export interface TerminalOpenContext extends TerminalListContext {
  sessionId: string;
  /** Size the shell starts at; the widget sends resizes afterwards. */
  cols: number;
  rows: number;
}

/** Server-side attachment: a byte stream with resize and teardown. */
export interface TerminalAttachment {
  input: Duplex;
  output: Duplex;
  resize(cols: number, rows: number): void;
  close(): void;
  /** Optional underlying process for audit. */
  proc?: ChildProcessWithoutNullStreams;
}

export interface TerminalResourceAdapter {
  kind: TerminalProviderKind;
  list(ctx: TerminalListContext): Promise<TerminalResource[]>;
  /** Returns null when the resource is unknown or unreachable. */
  resolve(resourceId: string, ctx: TerminalListContext): Promise<TerminalResource | null>;
  open(resourceId: string, ctx: TerminalOpenContext): Promise<TerminalAttachment>;
}
