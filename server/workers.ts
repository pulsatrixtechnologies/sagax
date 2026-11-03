import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import { turnDestination, type BotHost } from "./turns/turn-route.ts";
import { isEffortLevel, type ModelSelection } from "../shared/wire.ts";

/** One engine on a person's computer, as that computer published it. No keys. */
export interface WorkerEngine {
  instanceId: string;
  label: string;
  driverKind?: string;
  models: { id: string; label: string }[];
}

export interface Worker {
  deviceId: string;
  userId: string;
  online: boolean;
  /** Name the computer published. Absent: the device id. */
  name?: string;
  /** Engines and models on that computer. Absent until it publishes them. */
  engines?: WorkerEngine[];
  /** Last register or pull, epoch ms. Absent on a record that does not time out. */
  seenAt?: number;
}

const DEVICE_ID = /^[\w-]{1,80}$/;
const TEXT_LIMIT = 100_000;
export const PULL_WAIT_MS = 20_000;
export const WORKER_OFFLINE_MS = 45_000;

/** Same deviceId is one entry. The new record replaces it. Other devices stay. */
export function registerWorker(workers: Worker[], worker: Worker): Worker[] {
  return [...workers.filter((entry) => entry.deviceId !== worker.deviceId), worker];
}

export function queueTurn(input: {
  destination: ReturnType<typeof turnDestination>;
  messageId: string;
  queued: string[];
}): { queued: string[]; started: boolean } {
  if (input.destination.kind === "queued") {
    return { queued: [...input.queued, input.messageId], started: false };
  }
  return { queued: input.queued, started: true };
}

/** Drop `messageId`. Status is failed. `partial` is the same string. */
export function failTurn(input: {
  queued: string[];
  messageId: string;
  partial: string;
}): { queued: string[]; status: "failed"; partial: string } {
  return {
    queued: input.queued.filter((id) => id !== input.messageId),
    status: "failed",
    partial: input.partial,
  };
}

export interface OpenTurnMessage {
  id: string;
  text?: string;
  status?: "failed";
  card?: { answered?: unknown };
}

function withFailedStatus(messages: OpenTurnMessage[], messageId: string, partial: string): OpenTurnMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId) return message;
    if (message.text === undefined && partial) return { ...message, text: partial, status: "failed" };
    return { ...message, status: "failed" };
  });
}

/** The queue loses this id and the channel message is marked failed.
 * Other messages stay. The card object is not answered. */
export function failOpenTurn(input: {
  queued: string[];
  messageId: string;
  partial: string;
  messages: OpenTurnMessage[];
}): { queued: string[]; status: "failed"; partial: string; messages: OpenTurnMessage[] } {
  const failed = failTurn({ queued: input.queued, messageId: input.messageId, partial: input.partial });
  return {
    queued: failed.queued,
    status: failed.status,
    partial: failed.partial,
    messages: withFailedStatus(input.messages, input.messageId, failed.partial),
  };
}

/** A worker socket that closes before the turn starts leaves the queue.
 * A close during the turn uses failTurn. */
export function failTurnOnWorkerClose(input: {
  midTurn: boolean;
  queued: string[];
  messageId: string;
  partial: string;
  messages: OpenTurnMessage[];
}): { queued: string[]; status: "failed" | null; partial: string; messages: OpenTurnMessage[] } {
  if (!input.midTurn) {
    return { queued: input.queued, status: null, partial: input.partial, messages: input.messages };
  }
  return failOpenTurn(input);
}

function rosterLost(before: readonly string[], after: readonly string[]): boolean {
  return before.some((id) => !after.includes(id));
}

/** True when the next memberIds list drops a bot that is there now. */
export function memberIdsDropBot(input: {
  beforeMemberIds: readonly string[];
  afterMemberIds: readonly string[];
}): boolean {
  return input.beforeMemberIds.some((id) => !input.afterMemberIds.includes(id));
}

/** A memberIds change while a turn is held is applied, not refused.
 * failTurn runs for the held id. Partial text stays. Nothing is approved. */
export function memberIdsChangeDuringHeldTurn(input: {
  beforeMemberIds: readonly string[];
  afterMemberIds: readonly string[];
  heldId: string;
  queued: string[];
  partial: string;
  messages: OpenTurnMessage[];
}): {
  refused: boolean;
  memberIds: readonly string[];
  queued: string[];
  status: "failed" | null;
  partial: string;
  messages: OpenTurnMessage[];
} {
  if (!memberIdsDropBot({ beforeMemberIds: input.beforeMemberIds, afterMemberIds: input.afterMemberIds })) {
    return {
      refused: true,
      memberIds: input.beforeMemberIds,
      queued: input.queued,
      status: null,
      partial: input.partial,
      messages: input.messages,
    };
  }
  const failed = failTurnOnMembershipRemoval({
    beforeHumanIds: [],
    afterHumanIds: [],
    beforeMemberIds: input.beforeMemberIds,
    afterMemberIds: input.afterMemberIds,
    inTurn: true,
    queued: input.queued,
    messageId: input.heldId,
    partial: input.partial,
    messages: input.messages,
  });
  return {
    refused: false,
    memberIds: input.afterMemberIds,
    queued: failed.queued,
    status: failed.status,
    partial: failed.partial,
    messages: failed.messages,
  };
}

/** A human leaving humanIds, or a bot leaving memberIds, during a turn
 * uses the same failTurn path. History is the messages array, unchanged
 * except for the failed id. */
export function failTurnOnMembershipRemoval(input: {
  beforeHumanIds: readonly string[];
  afterHumanIds: readonly string[];
  beforeMemberIds: readonly string[];
  afterMemberIds: readonly string[];
  inTurn: boolean;
  queued: string[];
  messageId: string;
  partial: string;
  messages: OpenTurnMessage[];
}): { queued: string[]; status: "failed" | null; partial: string; messages: OpenTurnMessage[] } {
  const removed = input.inTurn && (
    rosterLost(input.beforeHumanIds, input.afterHumanIds) || rosterLost(input.beforeMemberIds, input.afterMemberIds)
  );
  if (!removed) {
    return { queued: input.queued, status: null, partial: input.partial, messages: input.messages };
  }
  return failOpenTurn(input);
}

/** Queued ids and ids already pulled. A pull removes the id from the queue,
 * so membership has to see the inflight row, including on a task thread. */
export function turnsOpenForMembership(input: {
  threadIds: readonly string[];
  queued: readonly { messageId: string; threadId: string }[];
  inflight: readonly { messageId: string; threadId: string }[];
}): string[] {
  const threads = new Set(input.threadIds);
  const ids: string[] = [];
  for (const item of [...input.queued, ...input.inflight]) {
    if (!threads.has(item.threadId) || ids.includes(item.messageId)) continue;
    ids.push(item.messageId);
  }
  return ids;
}

/** A finished pull response is not a drop, even if the socket closes after
 * it. Registration is not a drop. An explicit drop, or a close before the
 * response finishes, fails the pulled ids. */
export function pullCloseFailsTurn(input: { responseFinished: boolean }): boolean {
  return !input.responseFinished;
}

export function failPulledTurnsOnClose(input: {
  source: "register" | "pull" | "drop";
  responseFinished?: boolean;
  pulledIds: readonly string[];
  partials: Readonly<Record<string, string>>;
  messages: OpenTurnMessage[];
}): { failedIds: string[]; partials: Record<string, string>; messages: OpenTurnMessage[] } {
  const fail = input.source === "drop" || (input.source === "pull" && pullCloseFailsTurn({
    responseFinished: input.responseFinished === true,
  }));
  if (!fail) {
    return { failedIds: [], partials: { ...input.partials }, messages: input.messages };
  }
  let messages = input.messages;
  const partials = { ...input.partials };
  const failedIds: string[] = [];
  for (const messageId of input.pulledIds) {
    const partial = partials[messageId] ?? "";
    const result = failTurnOnWorkerClose({
      midTurn: true,
      queued: [],
      messageId,
      partial,
      messages,
    });
    messages = result.messages;
    partials[messageId] = result.partial;
    failedIds.push(messageId);
  }
  return { failedIds, partials, messages };
}

/** Close after a finished pull response does not fail the turn.
 * Close before the response does. */
export function bindWorkerSocket(input: {
  socket: { once(event: "close", listener: () => void): void };
  response: { once(event: string, listener: () => void): unknown };
  onClose: () => void;
}): void {
  let responseFinished = false;
  input.response.once("finish", () => {
    responseFinished = true;
  });
  input.socket.once("close", () => {
    if (!pullCloseFailsTurn({ responseFinished })) return;
    input.onClose();
  });
}

/** A pulled turn fails when its author cancels. Anyone else leaves it. */
export function failPulledOnAuthorCancel(input: {
  messageId: string;
  authorId: string;
  heldAuthorId: string | undefined;
  partial: string;
  messages: OpenTurnMessage[];
}): { failed: boolean; messages: OpenTurnMessage[] } {
  if (!input.authorId || input.heldAuthorId !== input.authorId) {
    return { failed: false, messages: input.messages };
  }
  const result = failOpenTurn({
    queued: [],
    messageId: input.messageId,
    partial: input.partial,
    messages: input.messages,
  });
  return { failed: true, messages: result.messages };
}

/** A channel turn waiting for one device. `userId` is who owned that device when the turn was held. */
export interface DeviceQueuedTurn {
  messageId: string;
  deviceId: string;
  userId: string;
  authorId: string;
  started: boolean;
  /** Which bot this hold is for. Absent on rows queued before bots were named. */
  botId?: string;
}

export function destinationForBot(input: { host?: BotHost; workers: Worker[] }): ReturnType<typeof turnDestination> {
  const host = normalizedHost(input.host);
  return turnDestination({ host, workerOnline: machineOnline(input.workers, host) });
}

/** Fleet is the only destination the host runner may execute. */
export function invokeFleetRunner(input: {
  destination: ReturnType<typeof turnDestination>;
  run: () => void;
}): boolean {
  if (input.destination.kind !== "fleet") return false;
  input.run();
  return true;
}

export function enqueueOfflineTurn(input: {
  queued: DeviceQueuedTurn[];
  messageId: string;
  deviceId: string;
  userId: string;
  authorId: string;
  botId?: string;
}): DeviceQueuedTurn[] {
  const botId = input.botId ?? "";
  if (input.queued.some((item) => !item.started && item.messageId === input.messageId && item.deviceId === input.deviceId && item.userId === input.userId && (item.botId ?? "") === botId)) {
    return input.queued;
  }
  return [...input.queued, {
    messageId: input.messageId,
    deviceId: input.deviceId,
    userId: input.userId,
    authorId: input.authorId,
    started: false,
    ...(botId ? { botId } : {}),
  }];
}

/** Ids held for this device while that same session owned it. They leave the queue marked started. A second pull does not return them. */
export function takeQueued(deviceId: string, queued: DeviceQueuedTurn[], userId: string): {
  queued: DeviceQueuedTurn[];
  ids: string[];
  started: DeviceQueuedTurn[];
} {
  const started: DeviceQueuedTurn[] = [];
  const rest: DeviceQueuedTurn[] = [];
  for (const item of queued) {
    if (item.deviceId === deviceId && item.userId === userId && !item.started) started.push({ ...item, started: true });
    else rest.push(item);
  }
  return { queued: rest, ids: started.map((item) => item.messageId), started };
}

/** The author can drop their own queued message. Anyone else leaves the queue as it is. */
export function cancelQueued(messageId: string, authorId: string, queued: DeviceQueuedTurn[]): DeviceQueuedTurn[] {
  if (!authorId) return queued;
  return queued.filter((item) => item.started || item.messageId !== messageId || item.authorId !== authorId);
}

function normalizedHost(host: BotHost | undefined): BotHost {
  if (host?.kind === "machine" && host.userId && host.deviceId) return host;
  return { kind: "fleet" };
}

function machineOnline(workers: Worker[], host: BotHost): boolean {
  if (host.kind !== "machine") return false;
  return workers.some((worker) => worker.online && worker.deviceId === host.deviceId && worker.userId === host.userId);
}

/**
 * Fleet bots are the only ones the host may run. Offline and online machines
 * are both claimable by that device's pull. Only an offline machine is
 * machine-offline. A missing host is fleet.
 */
export function channelTurnGate(input: {
  bots: { id: string; host?: BotHost }[];
  workers: Worker[];
  messageId: string;
  authorId?: string;
  queued: DeviceQueuedTurn[];
}): { queued: DeviceQueuedTurn[]; fleetIds: string[]; status: "machine-offline" | null } {
  let queued = input.queued;
  let held = false;
  const fleetIds: string[] = [];
  const authorId = input.authorId ?? "";
  for (const bot of input.bots) {
    const host = normalizedHost(bot.host);
    const destination = turnDestination({ host, workerOnline: machineOnline(input.workers, host) });
    queueTurn({ destination, messageId: input.messageId, queued: queued.map((item) => item.messageId) });
    if (destination.kind === "fleet") {
      fleetIds.push(bot.id);
    } else if (destination.kind === "worker") {
      queued = enqueueOfflineTurn({
        queued,
        messageId: input.messageId,
        deviceId: destination.deviceId,
        userId: host.kind === "machine" ? host.userId : "",
        authorId,
        botId: bot.id,
      });
    } else if (destination.kind === "queued" && host.kind === "machine") {
      held = true;
      queued = enqueueOfflineTurn({
        queued,
        messageId: input.messageId,
        deviceId: host.deviceId,
        userId: host.userId,
        authorId,
        botId: bot.id,
      });
    }
  }
  return { queued, fleetIds, status: held ? "machine-offline" : null };
}

export function pullQueuedForSession(input: {
  deviceId: string;
  userId: string;
  workers: Worker[];
  queued: DeviceQueuedTurn[];
}): { status: 200; ids: string[]; queued: DeviceQueuedTurn[] } | { status: 403; error: "forbidden" } {
  const owner = input.workers.find((worker) => worker.deviceId === input.deviceId);
  if (!owner || owner.userId !== input.userId) return { status: 403, error: "forbidden" };
  const pulled = takeQueued(input.deviceId, input.queued, input.userId);
  return { status: 200, ids: pulled.ids, queued: pulled.queued };
}

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function publishedEngines(value: unknown): WorkerEngine[] | { error: string } {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return { error: "engines must be a list" };
  const engines: WorkerEngine[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as { instanceId?: unknown; label?: unknown; driverKind?: unknown; models?: unknown };
    const instanceId = clip(row.instanceId, 120);
    if (!instanceId || !Array.isArray(row.models)) continue;
    const models: { id: string; label: string }[] = [];
    for (const model of row.models) {
      if (!model || typeof model !== "object" || Array.isArray(model)) continue;
      const id = clip((model as { id?: unknown }).id, 200);
      if (!id) continue;
      const label = clip((model as { label?: unknown }).label, 200) || id;
      models.push({ id, label });
      if (models.length >= 80) break;
    }
    if (!models.length) continue;
    const driverKind = clip(row.driverKind, 60);
    engines.push({
      instanceId,
      label: clip(row.label, 120) || instanceId,
      ...(driverKind ? { driverKind } : {}),
      models,
    });
    if (engines.length >= 40) break;
  }
  return engines;
}

/** The caller's computers only. Another member's device is not in the list. */
export function workersForSession(workers: Worker[], userId: string): Array<{
  deviceId: string;
  name: string;
  online: boolean;
  engines: WorkerEngine[];
}> {
  const caller = userId.trim();
  return workers.filter((worker) => worker.userId === caller).map((worker) => ({
    deviceId: worker.deviceId,
    name: worker.name || worker.deviceId,
    online: worker.online,
    engines: worker.engines ?? [],
  }));
}

export function workerOwns(workers: Worker[], deviceId: string, userId: string): boolean {
  return workers.some((worker) => worker.deviceId === deviceId && worker.userId === userId);
}

/** A computer that stopped pulling is offline. A record with no seenAt stays as it is. */
export function expireWorkers(workers: Worker[], now: number, ttlMs = WORKER_OFFLINE_MS): Worker[] {
  let changed = false;
  const next = workers.map((worker) => {
    if (!worker.online || worker.seenAt === undefined || now - worker.seenAt <= ttlMs) return worker;
    changed = true;
    return { ...worker, online: false };
  });
  return changed ? next : workers;
}

export function pullWaitMs(body: unknown): number {
  if (!body || typeof body !== "object" || Array.isArray(body)) return 0;
  const row = body as { wait?: unknown; waitMs?: unknown };
  if (typeof row.waitMs === "number" && Number.isFinite(row.waitMs)) {
    return Math.max(0, Math.min(25_000, Math.floor(row.waitMs)));
  }
  return row.wait === true ? PULL_WAIT_MS : 0;
}

/** Wakes a long poll when a turn is queued for that computer. */
export function createTurnBell() {
  type Waiter = { deviceId: string; userId: string; resolve: (hit: boolean) => void };
  const waiters: Waiter[] = [];
  return {
    notify(deviceId: string, userId: string) {
      for (const waiter of waiters.slice()) {
        if (waiter.deviceId === deviceId && waiter.userId === userId) waiter.resolve(true);
      }
    },
    wait(deviceId: string, userId: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
      if (signal?.aborted || timeoutMs <= 0) return Promise.resolve(false);
      return new Promise((resolve) => {
        const waiter: Waiter = {
          deviceId,
          userId,
          resolve: (hit) => {
            cleanup();
            resolve(hit);
          },
        };
        const timer = setTimeout(() => waiter.resolve(false), timeoutMs);
        const onAbort = () => waiter.resolve(false);
        const cleanup = () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        waiters.push(waiter);
      });
    },
  };
}

function engineHasModel(worker: Worker, instanceId: string, model: string): boolean {
  return (worker.engines ?? []).some((engine) => engine.instanceId === instanceId && engine.models.some((option) => option.id === model));
}

/** `fleet`, or a machine the caller registered, with a model that computer published. */
export function assignBotHost(input: {
  callerUserId: string;
  workers: Worker[];
  host: unknown;
}): { ok: true; host: BotHost; model?: ModelSelection } | { ok: false; status: 400 | 403; error: string } {
  const caller = input.callerUserId.trim();
  if (!caller) return { ok: false, status: 403, error: "Sign in to choose where this bot runs." };
  if (input.host === "fleet" || (input.host && typeof input.host === "object" && !Array.isArray(input.host) && (input.host as { kind?: unknown }).kind === "fleet")) {
    return { ok: true, host: { kind: "fleet" } };
  }
  if (!input.host || typeof input.host !== "object" || Array.isArray(input.host)) {
    return { ok: false, status: 400, error: "host must be fleet or a machine" };
  }
  const row = input.host as { kind?: unknown; deviceId?: unknown; model?: unknown };
  if (row.kind !== "machine") return { ok: false, status: 400, error: "host must be fleet or a machine" };
  const deviceId = typeof row.deviceId === "string" ? row.deviceId.trim() : "";
  if (!DEVICE_ID.test(deviceId)) return { ok: false, status: 400, error: "deviceId is required" };
  const worker = input.workers.find((entry) => entry.deviceId === deviceId && entry.userId === caller);
  if (!worker) return { ok: false, status: 403, error: "That computer is not registered on your account." };
  if (!row.model || typeof row.model !== "object" || Array.isArray(row.model)) {
    return { ok: false, status: 400, error: "name the model on that computer" };
  }
  const modelRow = row.model as { instanceId?: unknown; model?: unknown; effort?: unknown };
  const instanceId = clip(modelRow.instanceId, 120);
  const model = clip(modelRow.model, 200);
  if (!instanceId || !model) return { ok: false, status: 400, error: "name the model on that computer" };
  if (!engineHasModel(worker, instanceId, model)) {
    return { ok: false, status: 400, error: "That model is not on this computer." };
  }
  const selection: ModelSelection = { instanceId, model };
  if (modelRow.effort !== undefined) {
    if (!isEffortLevel(modelRow.effort)) return { ok: false, status: 400, error: "effort is not recognized" };
    selection.effort = modelRow.effort;
  }
  return { ok: true, host: { kind: "machine", userId: caller, deviceId }, model: selection };
}

/** A model change on a machine bot must be one that computer published. Null: not a machine bot. */
export function selectionOnMachine(input: {
  host?: BotHost;
  workers: Worker[];
  raw: unknown;
}): { ok: true; selection: ModelSelection } | { ok: false; status: number; error: string } | null {
  const host = input.host;
  if (host?.kind !== "machine") return null;
  if (!input.raw || typeof input.raw !== "object" || Array.isArray(input.raw)) {
    return { ok: false, status: 400, error: "modelSelection must be an object" };
  }
  const row = input.raw as { instanceId?: unknown; model?: unknown; effort?: unknown };
  const instanceId = clip(row.instanceId, 120);
  const model = clip(row.model, 200);
  if (!instanceId || !model) return { ok: false, status: 400, error: "modelSelection.instanceId is required" };
  const worker = input.workers.find((entry) => entry.deviceId === host.deviceId && entry.userId === host.userId);
  if (!worker || !engineHasModel(worker, instanceId, model)) {
    return { ok: false, status: 400, error: "That model is not on this computer." };
  }
  const selection: ModelSelection = { instanceId, model };
  if (row.effort !== undefined) {
    if (!isEffortLevel(row.effort)) return { ok: false, status: 400, error: "effort is not recognized" };
    selection.effort = row.effort;
  }
  return { ok: true, selection };
}

/** A 1:1 turn for a machine bot never starts on the fleet. */
export function directMachinePlan(input: {
  host?: BotHost;
  workers: Worker[];
}): { kind: "fleet" } | { kind: "hold"; deviceId: string; userId: string; online: boolean } {
  const destination = destinationForBot({ host: input.host, workers: input.workers });
  if (destination.kind === "fleet") return { kind: "fleet" };
  if (input.host?.kind !== "machine") return { kind: "fleet" };
  return {
    kind: "hold",
    deviceId: input.host.deviceId,
    userId: input.host.userId,
    online: destination.kind === "worker",
  };
}

export type TurnWrite =
  | { kind: "progress"; text: string }
  | { kind: "reply"; text: string }
  | { kind: "failed"; text: string }
  | { kind: "done" }
  | { kind: "approval"; requestId: string; tool: string; summary: string }
  | { error: string };

export function parseTurnWrite(body: unknown): TurnWrite {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "body must be a JSON object" };
  const row = body as { kind?: unknown; text?: unknown; requestId?: unknown; tool?: unknown; summary?: unknown };
  const text = typeof row.text === "string" ? row.text.slice(0, TEXT_LIMIT) : "";
  if (row.kind === "progress" || row.kind === "reply") {
    if (!text.trim()) return { error: "text is required" };
    return { kind: row.kind, text };
  }
  if (row.kind === "failed") return { kind: "failed", text };
  if (row.kind === "done") return { kind: "done" };
  if (row.kind === "approval") {
    const requestId = clip(row.requestId, 120);
    const tool = clip(row.tool, 200);
    const summary = clip(row.summary, 500);
    if (!DEVICE_ID.test(requestId) && !/^[\w.:-]{1,120}$/.test(requestId)) return { error: "requestId is required" };
    if (!tool) return { error: "tool is required" };
    return { kind: "approval", requestId, tool, summary };
  }
  return { error: "kind must be progress, reply, failed, approval or done" };
}

export function registerWorkerBody(input: {
  workers: Worker[];
  userId: string;
  body: { deviceId?: unknown; name?: unknown; engines?: unknown } | null;
  now?: number;
}): { status: 200; worker: Worker; workers: Worker[] } | { status: 400; error: string } {
  const deviceId = typeof input.body?.deviceId === "string" ? input.body.deviceId.trim() : "";
  const userId = input.userId.trim();
  if (!deviceId) return { status: 400, error: "deviceId is required" };
  if (!DEVICE_ID.test(deviceId)) return { status: 400, error: "deviceId is required" };
  if (!userId) return { status: 400, error: "session user is required" };
  const engines = publishedEngines(input.body?.engines);
  if ("error" in engines) return { status: 400, error: engines.error };
  const name = clip(input.body?.name, 80);
  const worker: Worker = {
    deviceId,
    userId,
    online: true,
    ...(name ? { name } : {}),
    ...(engines.length ? { engines } : {}),
    ...(input.now !== undefined ? { seenAt: input.now } : {}),
  };
  return { status: 200, worker, workers: registerWorker(input.workers, worker) };
}

export interface WorkerTurnView {
  messageId: string;
  botId: string;
  threadId: string;
  prompt: string;
  model: ModelSelection;
  bot: { id: string; name: string; soul?: string };
  history: { role: "user" | "assistant"; text: string }[];
  approvals: { requestId: string; tool: string; summary: string; behavior?: "allow" | "deny" | "answer"; message?: string }[];
}

export interface WorkerRouteDeps {
  workers(): Worker[];
  replace(workers: Worker[]): void;
  queued(): DeviceQueuedTurn[];
  replaceQueued(queued: DeviceQueuedTurn[]): void;
  userId(auth: RequestAuth): string;
  authorId(auth: RequestAuth): string;
  bell?: ReturnType<typeof createTurnBell>;
  readTurn?(input: { deviceId: string; userId: string; messageId: string; botId?: string }): WorkerTurnView | { status: number; error: string } | null;
  writeTurn?(input: { deviceId: string; userId: string; messageId: string; body: unknown }): { status: number; body: Record<string, unknown> };
  /** The caller that just registered this device, so approval delivery can
   * tell that session from the owner's other sessions. */
  rememberDevice?(input: { sessionId?: string; userId: string; deviceId: string }): void;
  /** Ids the device just took. They are in a turn until cancel, membership removal, or an explicit drop. */
  onTurnPulled?(input: { deviceId: string; userId: string; messageIds: string[]; authorIds: string[] }): void;
  /** The pull socket dropped before the response finished, or a device posted an explicit drop. */
  onWorkerSocketClose?(input: { deviceId: string; userId: string; messageIds: string[] }): void;
  /** The author cancelled a message. The caller fails it only when that author holds the pulled turn. */
  onAuthorCancel?(input: { messageId: string; authorId: string }): void;
}

function turnsForPull(ids: string[], beforeQueue: DeviceQueuedTurn[], deviceId: string, userId: string) {
  return ids.map((id) => {
    const item = beforeQueue.find((row) => row.messageId === id && row.deviceId === deviceId && row.userId === userId);
    return { messageId: id, ...(item?.botId ? { botId: item.botId } : {}) };
  });
}

export function createWorkerRoutes(deps: WorkerRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (method === "GET" && path === "/api/workers") {
      return json(res, 200, { workers: workersForSession(deps.workers(), deps.userId(auth)) });
    }
    const turnPath = path.match(/^\/api\/workers\/([\w-]+)\/turns\/([\w.-]+)$/);
    if (turnPath && (method === "GET" || method === "POST")) {
      const deviceId = turnPath[1]!;
      const messageId = turnPath[2]!;
      const userId = deps.userId(auth);
      if (!workerOwns(deps.workers(), deviceId, userId)) return json(res, 403, { error: "forbidden" });
      if (method === "GET") {
        const view = deps.readTurn?.({
          deviceId,
          userId,
          messageId,
          botId: url.searchParams.get("botId") ?? undefined,
        });
        if (!view) return json(res, 404, { error: "no such turn" });
        if ("error" in view) return json(res, view.status, { error: view.error });
        return json(res, 200, view);
      }
      const body = await readBody(req);
      const written = deps.writeTurn?.({ deviceId, userId, messageId, body }) ?? { status: 404, body: { error: "no such turn" } };
      return json(res, written.status, written.body);
    }
    if (method !== "POST") return PASS;
    if (path === "/api/workers") {
      const body = await readBody(req);
      const result = registerWorkerBody({
        workers: deps.workers(),
        userId: deps.userId(auth),
        body: body && typeof body === "object" && !Array.isArray(body) ? body : null,
        now: Date.now(),
      });
      if (result.status === 400) return json(res, 400, { error: result.error });
      deps.replace(result.workers);
      deps.rememberDevice?.({
        sessionId: auth.kind === "session" ? auth.session.id : undefined,
        userId: result.worker.userId,
        deviceId: result.worker.deviceId,
      });
      return json(res, 200, { worker: result.worker });
    }
    const pull = path.match(/^\/api\/workers\/([\w-]+)\/pull$/);
    if (pull) {
      const body = await readBody(req);
      const deviceId = pull[1]!;
      const userId = deps.userId(auth);
      const take = () => {
        const beforeQueue = deps.queued();
        const result = pullQueuedForSession({
          deviceId,
          userId,
          workers: deps.workers(),
          queued: beforeQueue,
        });
        return { beforeQueue, result };
      };
      let { beforeQueue, result } = take();
      if (result.status === 403) return json(res, 403, { error: result.error });
      const waitMs = result.ids.length ? 0 : pullWaitMs(body);
      if (waitMs > 0 && deps.bell) {
        const controller = new AbortController();
        const onClose = () => controller.abort();
        req.once("close", onClose);
        const hit = await deps.bell.wait(deviceId, userId, waitMs, controller.signal);
        req.off("close", onClose);
        if (controller.signal.aborted || res.writableEnded) return;
        if (hit) ({ beforeQueue, result } = take());
        if (result.status === 403) return json(res, 403, { error: result.error });
      }
      const seen = deps.workers().map((worker) => worker.deviceId === deviceId && worker.userId === userId
        ? { ...worker, online: true, seenAt: Date.now() }
        : worker);
      deps.replace(seen);
      deps.replaceQueued(result.queued);
      if (result.ids.length) {
        const authorIds = result.ids.map((id) => beforeQueue.find((item) => item.messageId === id)?.authorId ?? "");
        deps.onTurnPulled?.({ deviceId, userId, messageIds: result.ids, authorIds });
        bindWorkerSocket({
          socket: req.socket,
          response: res,
          onClose() {
            deps.onWorkerSocketClose?.({
              deviceId,
              userId,
              messageIds: result.status === 200 ? result.ids : [],
            });
          },
        });
      }
      return json(res, 200, { ids: result.ids, turns: turnsForPull(result.ids, beforeQueue, deviceId, userId) });
    }
    const drop = path.match(/^\/api\/workers\/([\w-]+)\/drop$/);
    if (drop) {
      const body = await readBody(req);
      const messageId = typeof body?.messageId === "string" ? body.messageId : "";
      if (!messageId) return json(res, 400, { error: "messageId is required" });
      const owned = deps.workers().find((worker) => worker.deviceId === drop[1]! && worker.userId === deps.userId(auth));
      if (!owned) return json(res, 403, { error: "forbidden" });
      deps.onWorkerSocketClose?.({ deviceId: drop[1]!, userId: deps.userId(auth), messageIds: [messageId] });
      return json(res, 200, { dropped: messageId });
    }
    const cancel = path.match(/^\/api\/workers\/queue\/([\w-]+)\/cancel$/);
    if (cancel) {
      const before = deps.queued();
      const authorId = deps.authorId(auth);
      const next = cancelQueued(cancel[1]!, authorId, before);
      deps.replaceQueued(next);
      deps.onAuthorCancel?.({ messageId: cancel[1]!, authorId });
      return json(res, 200, { removed: before.length - next.length });
    }
    return PASS;
  };
}
