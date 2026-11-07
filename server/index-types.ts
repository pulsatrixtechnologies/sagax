/** Turn capability and group-turn operation shapes (type-only; moved out of server/index.ts). */
import type { LocalVmTarget } from "./computer/container-computer.ts";
import type { ExternalRuntimeGrant } from "./external-runtime.ts";

// ── peer-agent comms wiring ────────────────────────────────────────────
// Every mounted proxy receives a turn-scoped capability for localhost
// /api/internal calls. Identity, source thread, recursion depth and route
// family all come from this server-side record; caller fields are assertions,
// never authority. Full mode can inspect its own MCP environment, so a
// credential is never shared between bots or threads (see
// sessionCredentials), and each turn's record is revoked when the turn ends.
export type InternalCapability = {
  botId: string;
  threadId: string;
  generation: string;
  depth: number;
  kind: "agents" | "connectors" | "computer" | "browser" | "hooks" | "phone" | "messages" | "perspicax" | "sandbox" | "desktop" | "workplace" | "personal-mcp" | "data";
  /** A "sandbox" capability: whose server environment it runs in. */
  sandboxPrincipalId?: string;
  /** A "personal-mcp" capability: which of that person's own MCP servers
   * (a command in their server environment) it relays to. */
  personalMcpServer?: string;
  /** A complete plugin's command, resolved against its current selected
   * install on every request. No execution spec rides the bearer. */
  pluginMcp?: { scope: "organization" | "person" | "bot"; key: string; name: string };
  /** A "desktop" capability: whose own computer it reaches (desktop bridge). */
  desktopPrincipalId?: string;
  skillAuthoring: boolean;
  createdBots: number;
  createdRooms?: number;
  /** start_thread calls this turn has made — capped like createdBots, so a
   * turn cannot fan out into more real turns than a person could follow. */
  openedThreads: number;
  orphanExpiresAt: number;
  localVmTarget?: LocalVmTarget;
  teamComputerId?: string;
  /** The Boat this turn's cloud computer tools act on
   * (/api/internal/computer/mcp); only ever set by the harness at attach.
   * null: the tools are mounted and the Boat is the one their first call
   * creates or wakes (mountBotBoat), read from the turn's claim. */
  boxId?: string | null;
  browserSession?: string;
  roomHandoffId?: string;
  /** attach_file calls this turn has made, capped so one turn cannot flood the chat. */
  attachedFiles?: number;
  /** This turn's engine works with host files, so attach_file may also
   * deliver a file the turn saved outside the conversation's folders
   * (openFileSavedSince). Never on a Cloud home or a hosted workspace. */
  deliversSavedFiles?: boolean;
  /** When this turn's record was minted: a file saved outside the folders
   * must be newer than this to be delivered. Set by mintInternalCapability. */
  turnStartedAt?: number;
  /** post_to_room calls this turn has made. */
  roomPosts?: number;
  /** react_to_message calls this turn has made (MAX_BOT_REACTIONS_PER_TURN). */
  reactions?: number;
  /** Group memory updates refused this turn (bot memory archives at the cap instead). */
  memoryRefusals?: number;
  /** Delegations this turn handed out: their ids may not be checked or
   * waited on until a later turn, so the teammate gets to work first. */
  delegatedThisTurn?: Set<string>;
  externalRuntime?: ExternalRuntimeGrant;
  /** Room-coordination / bounded peer tools for this turn. */
  roomCoordination?: boolean;
  /** start_thread (and peers) allowed for this turn. */
  ownThreadCreation?: boolean;
};

export type GroupTurnOperation = {
  id: string;
  threadId: string;
  botIds: Set<string>;
  cancelled: boolean;
  cancellation: AbortController;
  providerHandshakePending: boolean;
  /** Exact client message whose room round this is, only for approval routing. */
  humanRequestMessageId?: string;
  /** The coalesced burst that started this turn (M2): member turns recover
   * every burst line from the transcript by these stable queueIds, so each
   * line's context text and attachments survive the fold into one turn. */
  queuedQueueIds?: string[];
  /** Lot 3: the goal lead is polling a runtime worker in this same thread.
   * That wait alone must not look like the room is busy to host.busy, or
   * the worker never starts; the worker's own short-lived operation owns
   * the working flag while it runs. */
  awaitingRuntimeWorker?: boolean;
  goalRun?: {
    runId: string;
    cardMessageId: string;
    goal: string;
    coordinatorBotId: string;
    coordinatorName: string;
    turnCount: number;
    maxTurns: number;
    startedAt: number;
    finished: boolean;
  };
};
