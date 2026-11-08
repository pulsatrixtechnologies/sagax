import type { ApprovalMode } from "../../shared/approval-mode";
import type { BotAvatarCrop } from "../../shared/bot-avatar";
import type { MascotLook } from "../../shared/mascot-look";
import type { MascotSkinId } from "../../shared/mascot-skins";
import type { ModelSelection } from "../../shared/model-selection";
import type { ProactiveMode } from "../../shared/proactive-mode";
import type { CloudBackend, MausColor } from "../../shared/wire";

/** Where a bot works. The same union as `Bot["computer"]`, named here so this
 * module does not import the store (#1381). */
type BotComputer = "cloud" | "vm" | "local" | "browser" | "off";

/** Fields a desktop bot PATCH may write. Same shapes as `Bot`, without
 * importing it. */
type BotPatchBody = {
  name: string;
  title: string;
  description: string;
  soul: string;
  notifications: boolean;
  cloudBackend: CloudBackend;
  autoStartVps: boolean;
  color: MausColor;
  mascotExpression: string | null;
  mascotSkin: MascotSkinId | null;
  mascotLook: MascotLook | null;
  avatarUrl: string | null;
  avatarCrop: BotAvatarCrop;
  avatarZoom: number;
  avatarFocusX: number;
  avatarFocusY: number;
  autoApprove: boolean;
  approvalMode: ApprovalMode;
  proactiveMode: ProactiveMode;
  outbound: { policy: "ask" | "allow"; dailyCap: number };
  fallback: Array<{ instanceId: string; model: string }>;
  speakReplies: boolean;
  voice: string;
  voiceNotes: boolean;
  memeReplies: "auto" | "off";
  collaboratorsCreateRoutines: boolean;
  pinned: boolean;
  hidden: boolean;
  section: string;
  pinnedMessageId: string;
  chiefOfStaff: boolean;
  approvePeerComms: boolean;
  browser: boolean;
  browserProfile: string | null;
  memoryUpkeep: boolean;
  skillLearning: boolean;
  builtinPlugins: Record<string, boolean>;
  teamMemorySharing: "shared" | "private";
  mcpServers: string[] | null;
  mcpAccounts: Record<string, string> | null;
  modelSelection: ModelSelection;
  /** Prompt-cache keep-warm override: true/false, or null to follow the workspace. */
  cacheKeepWarm: boolean | null;
};

/** Every field written through the desktop's broad bot PATCH boundary. */
export type BotUpdatePatch = Partial<BotPatchBody> & {
  /** Where the bot's turns run. `fleet`, or a computer this person registered. */
  host?: "fleet" | { kind: "machine"; deviceId: string; model?: { instanceId: string; model: string } };


  /** null is the wire representation for clearing an explicit destination
   * and returning to Auto. Bot state itself keeps Auto as an absent field. */
  computer?: BotComputer | null;
  /** Rides the PATCH body only: the server's proof that the local-auto
   * warning dialog was shown (see server/index.ts's consent gate). It must
   * reach the wire inside the coalesced body and must never fold into bot
   * state — the queue strips it from every overlay it hands back. */
  acknowledgeLocalAuto?: boolean;
  /** Renderer-local marker that the elevated-risk Full access dialog was
   * confirmed. StoreProvider consumes it before the private Electron request;
   * it is never sent over HTTP or folded into bot state. */
  confirmFullAccess?: boolean;
  /** With approvalMode: every existing thread takes that level too. Full and
   * Custom go through the desktop's private grant scope; any other level
   * rides the PATCH body (the team dialog). Never a bot field. */
  applyToAllThreads?: boolean;
  /** Organization server: Full is granted over HTTP (the server checks the
   * policy, the owner and the one-time confirmation). Never a bot field. */
  organizationFullAccess?: boolean;
  /** With modelSelection, from a bulk change: a thread with a model of its
   * own keeps it, the selected one included; only followers move. Rides the
   * PATCH body, never a bot field. */
  keepThreadModels?: boolean;
  /** With modelSelection: the thread this client shows. Body only: Bot.threadId is the server's selection. */
  threadId?: string;
  /** I2, body only: the change comes from the team settings, so the bot keeps following its team. */
  teamApply?: boolean;
  /** I2, body only: the bot drops its own model or computer and follows its team again. */
  teamInherit?: Array<"model" | "computer">;
};

/** A wire patch after clear-only values have been normalized for Bot state. */
export type BotStatePatch = Omit<
  BotUpdatePatch,
  "computer" | "host" | "acknowledgeLocalAuto" | "confirmFullAccess" | "applyToAllThreads" | "organizationFullAccess" | "keepThreadModels" | "threadId" | "teamApply" | "teamInherit"

> & {
  computer?: BotComputer;
};

interface BotPatchQueueEntry<B> {
  botId: string;
  fallback: B;
  pending: BotUpdatePatch;
  inFlight: BotUpdatePatch;
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  controller: AbortController | null;
  cancelled: boolean;
  idleWaiters: Array<(bot: B | null) => void>;
}

export interface BotPatchQueueOptions<B> {
  delayMs?: number;
  send: (
    botId: string,
    patch: BotUpdatePatch,
    signal: AbortSignal,
    current: B,
  ) => Promise<B>;
  reconcile: (botId: string, signal: AbortSignal) => Promise<B | null>;
  onAuthoritative: (bot: B, optimisticOverlay: BotStatePatch) => void;
  onError: (error: Error) => void;
}

export interface BotPatchQueue<B> {
  enqueue: (botId: string, patch: BotUpdatePatch, fallback: B) => void;
  /** Wait for the lane to settle and return the server-authoritative bot.
   * null means there was no queued write (or the lane was cancelled). */
  flush: (botId: string) => Promise<B | null>;
  overlayFor: (botId: string) => BotStatePatch;
  cancel: (botId: string) => void;
  /** Undo a dispose. Exists for React StrictMode, whose dev-mode mount probe
   * runs the effect cleanup once against the SAME memoized queue — without
   * this, dispose() would permanently disable saving in development. */
  revive: () => void;
  dispose: () => void;
}

const hasFields = (patch: BotUpdatePatch): boolean => Object.keys(patch).length > 0;
const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const isAbortError = (error: unknown): boolean =>
  Boolean(error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError");

/** What may fold back into renderer bot state: everything except the
 * wire-only flags. One strip point covers both overlay paths. */
const stateOverlay = (patch: BotUpdatePatch): BotStatePatch => {
  const {
    acknowledgeLocalAuto: _localAck,
    confirmFullAccess: _fullConfirmation,
    applyToAllThreads: _allThreads,
    organizationFullAccess: _orgFull,
    keepThreadModels: _keepThreadModels,
    threadId: _threadId,
    teamApply: _teamApply,
    teamInherit: _teamInherit,
    host: _host,
    computer,
    ...fields
  } = patch;
  const normalized: BotStatePatch = { ...fields };
  if (computer === null) normalized.computer = undefined;
  else if (computer !== undefined) normalized.computer = computer;
  return normalized;
};

/**
 * A per-bot mutation lane: edits debounce together, requests never overtake
 * one another, and every response/error is folded back from an authoritative
 * server bot while preserving only edits that were made later.
 */
export function createBotPatchQueue<B>(options: BotPatchQueueOptions<B>): BotPatchQueue<B> {
  const entries = new Map<string, BotPatchQueueEntry<B>>();
  const delayMs = options.delayMs ?? 400;
  let disposed = false;

  const settleIfIdle = (entry: BotPatchQueueEntry<B>) => {
    if (entry.running || entry.timer !== null || hasFields(entry.pending)) return;
    entries.delete(entry.botId);
    for (const resolve of entry.idleWaiters.splice(0)) resolve(entry.fallback);
  };

  const drain = async (entry: BotPatchQueueEntry<B>): Promise<void> => {
    if (disposed || entry.running || entry.timer !== null || !hasFields(entry.pending)) return;
    entry.running = true;
    const patch = entry.pending;
    entry.pending = {};
    entry.inFlight = patch;
    const controller = new AbortController();
    entry.controller = controller;

    try {
      const bot = await options.send(entry.botId, patch, controller.signal, entry.fallback);
      if (disposed || entry.cancelled) return;
      entry.fallback = bot;
      options.onAuthoritative(bot, stateOverlay(entry.pending));
    } catch (caught) {
      if (!disposed && !entry.cancelled) {
        const supersededApproval = controller.signal.aborted &&
          hasOwn(entry.pending, "approvalMode") &&
          isAbortError(caught);
        if (supersededApproval) return;
        // A rejected patch is no longer optimistic. Re-read before rolling back
        // because a lost HTTP response may still have committed and broadcast.
        entry.inFlight = {};
        let bot: B | null = entry.fallback;
        try {
          bot = await options.reconcile(entry.botId, controller.signal);
          if (bot) entry.fallback = bot;
        } catch {
          // The captured pre-edit bot is safer than leaving rejected input in
          // state when the reconciliation request is unavailable too.
        }
        // Deletion may cancel this lane while the re-read is in flight. Folding
        // that result back into state would resurrect the deleted bot.
        if (disposed || entry.cancelled) return;
        if (bot) options.onAuthoritative(bot, stateOverlay(entry.pending));
        options.onError(caught instanceof Error ? caught : new Error(String(caught)));
      }
    } finally {
      entry.controller = null;
      entry.inFlight = {};
      entry.running = false;
      if (!disposed && !entry.cancelled) {
        if (hasFields(entry.pending) && entry.timer === null) void drain(entry);
        settleIfIdle(entry);
      }
    }
  };

  const schedule = (entry: BotPatchQueueEntry<B>) => {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void drain(entry);
    }, delayMs);
  };

  return {
    enqueue(botId, patch, fallback) {
      if (disposed || !hasFields(patch)) return;
      const entry = entries.get(botId) ?? {
        botId,
        fallback,
        pending: {},
        inFlight: {},
        timer: null,
        running: false,
        controller: null,
        cancelled: false,
        idleWaiters: [],
      };
      entries.set(botId, entry);
      entry.pending = { ...entry.pending, ...patch };
      // An all-threads scope belongs to the level it came with: a newer level
      // without one (a quick switch from Full back to Ask) is the default only.
      if (hasOwn(patch, "approvalMode") && !hasOwn(patch, "applyToAllThreads")) delete entry.pending.applyToAllThreads;
      // I2: the team flags belong to the edit they came with; a later own
      // model or computer edit is the bot's own.
      if ((hasOwn(patch, "modelSelection") || hasOwn(patch, "computer")) && !hasOwn(patch, "teamApply")) delete entry.pending.teamApply;
      // A private Full/Custom grant cannot be cancelled after it crosses the
      // Electron bridge. Signal the sender as soon as a newer level exists so
      // it can compensate a late grant back to Ask before this lane advances.
      const inFlightMode = entry.inFlight.approvalMode;
      if (
        entry.running &&
        (inFlightMode === "full" || inFlightMode === "custom") &&
        hasOwn(patch, "approvalMode") &&
        patch.approvalMode !== inFlightMode
      ) {
        entry.controller?.abort();
      }
      // Execution-boundary edits must start immediately. They still share the
      // same serialized lane, but never sit behind the cosmetic 400 ms
      // debounce where a message/routine could begin under stale permissions.
      const immediate = Object.prototype.hasOwnProperty.call(patch, "approvalMode") ||
        Object.prototype.hasOwnProperty.call(patch, "modelSelection") ||
        Object.prototype.hasOwnProperty.call(patch, "host");
      if (immediate) {
        if (entry.timer !== null) clearTimeout(entry.timer);
        entry.timer = null;
        void drain(entry);
      } else {
        schedule(entry);
      }
    },

    flush(botId) {
      const entry = entries.get(botId);
      if (!entry) return Promise.resolve(null);
      if (entry.timer !== null) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
      const idle = new Promise<B | null>((resolve) => entry.idleWaiters.push(resolve));
      void drain(entry);
      settleIfIdle(entry);
      return idle;
    },

    overlayFor(botId) {
      const entry = entries.get(botId);
      return entry ? stateOverlay({ ...entry.inFlight, ...entry.pending }) : {};
    },

    cancel(botId) {
      const entry = entries.get(botId);
      if (!entry) return;
      entry.cancelled = true;
      if (entry.timer !== null) clearTimeout(entry.timer);
      entry.controller?.abort();
      entries.delete(botId);
      for (const resolve of entry.idleWaiters.splice(0)) resolve(null);
    },

    revive() {
      disposed = false;
    },

    dispose() {
      disposed = true;
      for (const entry of entries.values()) {
        entry.cancelled = true;
        if (entry.timer !== null) clearTimeout(entry.timer);
        entry.controller?.abort();
        for (const resolve of entry.idleWaiters.splice(0)) resolve(null);
      }
      entries.clear();
    },
  };
}
