// A Primary Bot's level flows down every hop of the work it hands out, a
// teammate's teammate too, in threads and in rooms alike: each hand-off
// resolves the nearest Primary Bot conversation up its chain
// (docs/approval-levels.md). Sagax keeps org gates (member Full deny,
// memberAutoRefused) and Primary Bot wording on top of the upstream walk.
import type { ApprovalMode } from "../../shared/approval-mode.ts";
import { delegatedApprovalMode } from "../approvals/auto-approve.ts";
import type { HandoffView, RoomAddress } from "../runtime/coordinator-types.ts";
import type { BotRecord, Store } from "../store.ts";

/** A conversation that hands work on, and the node its turn runs: its parents lead up the chain. */
export type Hop = Pick<HandoffView, "botId" | "threadId" | "parentId">;

export interface DelegatedLevelDeps {
  store: Pick<Store, "bot" | "projectBotForTask" | "taskByThread" | "patchTask" | "appendMessage">;
  // Read lazily: index.ts builds the coordinator after this module.
  node: (id: string) => Hop | undefined;
  /** The level a conversation hands work on from. */
  sourceLevel: (botId: string, threadId: string) => ApprovalMode;
  /** The level a bot's turn in a thread runs at. */
  turnLevel: (bot: BotRecord, peerInitiated: boolean, threadId: string) => ApprovalMode;
  driverKind: (bot: BotRecord) => string | undefined;
  guestDriven: (threadId: string) => boolean;
  /** Organization: a member-owned bot never inherits Full. */
  recipientMemberOwned?: (bot: BotRecord) => boolean;
  /** Organization: refuse Auto/edits when member automatic levels are off. */
  memberAutoRefused?: (
    bot: BotRecord,
    previous: Array<ApprovalMode | undefined>,
    next: ApprovalMode,
  ) => boolean;
  /** Room turn post-filter for member-owned bots (Custom stays Ask, etc.). */
  memberRoomTurnLevel?: (level: ApprovalMode) => ApprovalMode;
}

const NAMES: Partial<Record<ApprovalMode, string>> = {
  edits: "Auto-accept edits",
  auto: "Approve for me",
  full: "Full access",
};
const MAX_HOPS = 32;

function isChief(bot: BotRecord | undefined): boolean {
  return Boolean(bot?.chiefOfStaff);
}

export function createDelegatedLevel(deps: DelegatedLevelDeps) {
  const { store } = deps;

  /** The nearest Primary Bot conversation at or above `from`. */
  function chiefAbove(from: Hop | undefined): { chief: BotRecord; threadId: string } | undefined {
    let hop = from;
    for (let steps = 0; hop && steps < MAX_HOPS; steps++) {
      const bot = store.bot(hop.botId);
      if (bot && isChief(bot)) return { chief: bot, threadId: hop.threadId };
      hop = hop.parentId ? deps.node(hop.parentId) : undefined;
    }
    return undefined;
  }

  /** The level work `from` hands `target` comes down with, or null to keep `own`. */
  function handedDown(from: Hop | undefined, target: BotRecord, own: ApprovalMode) {
    const above = chiefAbove(from);
    if (!from || !above) return null;
    const chiefMode = deps.sourceLevel(above.chief.id, above.threadId);
    const level = delegatedApprovalMode({
      senderIsChief: true,
      senderMode: chiefMode,
      sameBot: from.botId === target.id || above.chief.id === target.id,
      recipientMode: own,
      recipientDriverKind: deps.driverKind(target),
      recipientMemberOwned: deps.recipientMemberOwned?.(target),
    });
    return level ? { level, chief: above.chief, chiefMode } : null;
  }

  /** The teammate's thread switches to the level the work came down with. */
  function apply(
    from: BotRecord,
    fromThreadId: string,
    fromNodeId: string | undefined,
    target: BotRecord,
    threadId: string,
  ): void {
    const parentId = fromNodeId ? deps.node(fromNodeId)?.parentId : undefined;
    const own = deps.turnLevel(store.projectBotForTask(target.id, threadId) ?? target, false, threadId);
    const passed = handedDown(
      { botId: from.id, threadId: fromThreadId, ...(parentId ? { parentId } : {}) },
      target,
      own,
    );
    if (!passed || store.taskByThread(target.id, threadId)?.approvalMode === passed.level) return;
    if (deps.memberAutoRefused?.(target, [store.taskByThread(target.id, threadId)?.approvalMode], passed.level)) {
      store.appendMessage(threadId, {
        role: "bot",
        kind: "activity",
        tool: {
          name: `${NAMES[passed.level] ?? passed.level} not passed on by ${from.name}: automatic levels are off for members' bots in this organization`,
          ok: false,
        },
      });
      return;
    }
    store.patchTask(target.id, threadId, {
      approvalMode: passed.level,
      autoApprove: false,
      alwaysAllow: [],
      approvalOwn: "delegated",
    });
    const name = NAMES[passed.level] ?? passed.level;
    const via = passed.chief.id === from.id ? "" : `from ${passed.chief.name}, `;
    store.appendMessage(threadId, {
      role: "bot",
      kind: "activity",
      tool: { name: `${name} — delegated by ${from.name}, ${via}a Primary Bot on ${name}`, ok: true },
    });
  }

  /** A room thread is shared, so a Primary Bot's level rides the hand-off. */
  function roomTurn(bot: BotRecord, threadId: string, source: Hop | undefined): ApprovalMode {
    if (deps.guestDriven(threadId)) return "ask";
    if (deps.recipientMemberOwned?.(bot)) {
      // Member Full deny before any hand-off lift (Sagax org rule).
      const own = deps.turnLevel(bot, source !== undefined, threadId);
      const level = handedDown(source, bot, own)?.level ?? own;
      return deps.memberRoomTurnLevel ? deps.memberRoomTurnLevel(level) : level;
    }
    const own = deps.turnLevel(bot, source !== undefined, threadId);
    return handedDown(source, bot, own)?.level ?? own;
  }

  /** For the hand-off's record: the level its target really runs at and, when
   * that is the level its chain brought down, the Primary Bot conversation's. */
  function levelOf(
    target: RoomAddress,
    source: Hop | undefined,
  ): { level: ApprovalMode; chief?: ApprovalMode; driverKind?: string } {
    const bot = store.bot(target.botId);
    if (!bot) return { level: "ask" };
    const running = store.projectBotForTask(bot.id, target.threadId) ?? bot;
    const level = target.groupId
      ? roomTurn(bot, target.threadId, source)
      : deps.turnLevel(running, true, target.threadId);
    const passed = handedDown(source, bot, "ask");
    return {
      level,
      ...(passed?.level === level ? { chief: passed.chiefMode } : {}),
      driverKind: deps.driverKind(running),
    };
  }

  return { apply, roomTurn, levelOf };
}
