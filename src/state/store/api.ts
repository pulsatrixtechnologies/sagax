// HTTP helpers used by StoreProvider and the dispatch side effects.
import { approvalModeFor, type ApprovalMode } from "../../../shared/approval-mode";
import type { BotVisibility } from "../../../shared/wire";
import type { RuntimeEvent } from "../../../shared/runtime-events";
import type { StepUpTarget } from "../../../shared/step-up";
import { roleProfilePatch, type BotRole } from "@/lib/bot-roles";
import { activeLocale, t } from "@/lib/i18n";
import { isNoRouteText } from "@/lib/no-route";
import { readableError } from "@/lib/plain-error";
import { forgetStepUp, recentStepUp, stepUp, stepUpApprovals } from "@/lib/step-up-client";
import { permissionMissingMessage } from "@/lib/permissions";
import { engineErrorMessage } from "@/lib/engine-error-text";
import { teamSetupErrorMessage } from "@/lib/team-setup-error-text";
import { serverErrorMessage } from "@/lib/server-error-text";
import { bindModerationApi } from "@/lib/moderation";
import { ApiError, PERSON_THREADS_HEADER, threadApprovalModes, type Action, type Bot, type BotAnnouncement, type TaskUpdatePatch } from "./model";
import type { BotUpdatePatch } from "../bot-patch-queue";

export async function createBotWithRole(role?: BotRole, request: typeof api = api, visibility?: BotVisibility, section?: string, settings?: Record<string, unknown>): Promise<{ bot: Bot; profileError?: string }> {
  const restricted = visibility && visibility !== "everyone" ? { visibility } : {};
  // The chosen name rides the create itself: the server writes the greeting
  // with the bot's name at creation, before any follow-up patch (#2802).
  const chosenName = typeof settings?.name === "string" && settings.name.trim() ? settings.name.trim() : undefined;
  const fields = { ...(role ? { name: role.name, title: role.title, description: role.description } : {}),
    ...(chosenName ? { name: chosenName } : {}), ...restricted,
    ...(section !== undefined ? { section } : {}),
    // The greeting and intro card speak the app's language (#2803); English
    // is the server default, so it is not sent.
    ...(activeLocale().toLowerCase().startsWith("fr") ? { language: "fr" } : {}) };
  const { bot } = await request("/api/bots", {
    method: "POST",
    ...(Object.keys(fields).length ? { body: JSON.stringify(fields) } : {}),
  });
  const chosen = settings && Object.keys(settings).length ? settings : undefined;
  if (!role && !chosen) return { bot };
  try {
    // Settings the person's permissions open (#1076) ride the follow-up patch.
    const { bot: patched } = await request(`/api/bots/${bot.id}`, {
      method: "PATCH", body: JSON.stringify({ ...(role ? roleProfilePatch(role) : {}), ...chosen }),
    });
    return { bot: { ...bot, ...patched, messages: bot.messages } };
  } catch (error) {
    return { bot, profileError: readableError(error) };
  }
}

/** Messages per thread in a snapshot, and per scrollback page.
 *
 * An unbounded `/api/bots` serialises every message of every thread: a
 * long-running room reaches tens of megabytes, which a remote companion
 * cannot buffer and a phone should never be sent. The server has answered
 * bounded pages since the `?messages=` parameter was added; this client now
 * asks for one and pages back through `/api/threads/:id/messages?before=`.
 * Kept at the server's own page maximum so one page fills more than the
 * transcript window mounts. */
export const MESSAGE_PAGE_SIZE = 200;

export async function api<T = any>(path: string, init?: RequestInit & { timeoutMs?: number; stepUpTry?: "recent" | "fresh" }): Promise<T> {
  // timeoutMs races the fetch against AbortSignal.timeout, combined with any
  // caller signal so either can cancel. Omitted means no behavior change.
  const { timeoutMs, signal, stepUpTry, ...rest } = init ?? {};
  const res = await fetch(path, {
    // The app's language rides every call: a person who saved none still
    // gets server text (a greeting, a routine card) in it (#2803, #2805).
    headers: { "content-type": "application/json", [PERSON_THREADS_HEADER]: "1", "x-sagax-locale": activeLocale() },
    ...rest,
    signal: timeoutMs === undefined
      ? signal
      : signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // An approval or a change that needs the person's security key
    // (shared/step-up.ts): ask the key for exactly what the server named,
    // then send the same request again with the step-up. A step-up made a
    // moment ago for the same card is tried first (one touch covers a
    // card's Always allow and its Allow).
    const target = res.status === 403 && (body?.code === "step_up_required" || body?.code === "step_up_failed") ? body?.target as StepUpTarget | undefined : undefined;
    const original = typeof rest.body === "string" ? (() => { try { return JSON.parse(rest.body as string); } catch { return null; } })() : rest.body === undefined || rest.body === null ? {} : null;
    if (target && stepUpTry !== "fresh" && original && typeof original === "object" && !Array.isArray(original)) {
      const reuse = stepUpTry === undefined ? recentStepUp(target) : undefined;
      if (stepUpTry === "recent") forgetStepUp(target);
      const id = reuse ?? await stepUp(target);
      return api<T>(path, { ...init, body: JSON.stringify({ ...original, stepUp: id }), stepUpTry: reuse ? "recent" : "fresh" });
    }
    const error = body?.error;
    // An older server's "no route: METHOD /path" is never shown: the
    // neutral, translated line takes its place (src/lib/no-route.ts). The
    // server's words stay in `body` for routeMissingOnServer.
    if (res.status === 404 && isNoRouteText(error)) throw new ApiError(t("serverRoute.needsUpdate"), res.status, body);
    // Prefer a sentence the person can read. status and body keep the
    // original for callers that diagnose beyond the line on screen (#1723).
    const raw = permissionMissingMessage(body)
      ?? teamSetupErrorMessage(body)
      ?? engineErrorMessage(body)
      ?? serverErrorMessage(body)
      ?? (typeof error === "string" ? error : typeof error?.message === "string" ? error.message : `${res.status} ${res.statusText}`);
    throw new ApiError(readableError(raw), res.status, body);
  }
  return body;
}

type TrustedApprovalBridge = {
  setMode(
    botId: string,
    mode: ApprovalMode,
    options?: { acknowledgeLocalAuto?: boolean; threadId?: string; threadOnly?: boolean; allThreads?: boolean; refreshPermissions?: boolean },
  ): Promise<BotAnnouncement>;
};

/** The packaged desktop's private approval channel, when this window has a
 * working one. Team settings and bot panels pass it into persistBotUpdate. */
export function desktopApprovalBridge(): TrustedApprovalBridge | undefined {
  if (typeof window === "undefined" || !window.ogb?.approvals) return undefined;
  return stepUpApprovals(window.ogb.approvals);
}

/** Composer changes use the same private bridge as bot settings, but never
 * change profile defaults. Full access goes over HTTP like any other level
 * (omb #2701); Custom still needs the packaged desktop channel. */
export async function persistTaskApproval(
  botId: string, threadId: string, patch: TaskUpdatePatch,
  bridge: TrustedApprovalBridge | undefined,
  request: (path: string, init?: RequestInit) => Promise<{ bot: BotAnnouncement }> = api,
): Promise<BotAnnouncement> {
  const { approvalMode, autoApprove, confirmFullAccess: _confirm, organizationFullAccess: _orgFull, acknowledgeLocalAuto, ...ordinary } = patch;
  const mode = approvalMode ?? (autoApprove === undefined ? undefined : autoApprove ? "auto" : "ask");
  if (mode === "full") {
    const result = await request(`/api/bots/${botId}/tasks/${threadId}`, { method: "PATCH",
      body: JSON.stringify({ ...ordinary, approvalMode: "full" }) });
    return result.bot;
  }
  if (mode === "custom" && !bridge) throw new Error("Custom approval, and leaving it, are set in the Sagax desktop app on the computer that runs this server");
  if (mode === "custom" && bridge) {
    if (Object.keys(ordinary).length) await request(`/api/bots/${botId}/tasks/${threadId}`, { method: "PATCH", body: JSON.stringify(ordinary) });
    return bridge.setMode(botId, mode, { threadId, threadOnly: true, acknowledgeLocalAuto: acknowledgeLocalAuto === true });
  }
  const result = await request(`/api/bots/${botId}/tasks/${threadId}`, { method: "PATCH", body: JSON.stringify({ ...ordinary, approvalMode, autoApprove, acknowledgeLocalAuto }) });
  return result.bot;
}

/** Persist one coalesced bot edit. Full access goes over HTTP like any other
 * level (omb #2701). Custom still uses the packaged desktop's private channel.
 * Leaving Custom reverses that order so a coalesced provider switch is
 * validated after the bot is back in Ask/Auto.
 * Exported for a small ordering/security contract test. */
export async function persistBotUpdate(
  botId: string,
  patch: BotUpdatePatch,
  signal: AbortSignal,
  request: (path: string, init?: RequestInit) => Promise<{ bot: BotAnnouncement }> = api,
  trustedApprovals: TrustedApprovalBridge | undefined = desktopApprovalBridge(),
  currentBot?: BotAnnouncement,
): Promise<BotAnnouncement> {
  const {
    approvalMode,
    confirmFullAccess: _confirm,
    applyToAllThreads,
    organizationFullAccess,
    ...withThread
  } = patch;
  // threadId rides the body with modelSelection only (the server pins the
  // shown conversation for a model switch). The organization Full grant also
  // names it, on its own request. Anywhere else it would be refused.
  const { threadId: openThreadId, ...withoutThread } = withThread;
  const ordinaryPatch: typeof withThread = withThread.modelSelection !== undefined ? withThread : withoutThread;
  // Leaving Custom on any thread when the change reaches every thread still
  // needs the private bridge (team dialog applyToAllThreads).
  const leavesCustom = approvalMode !== undefined && approvalMode !== "custom" &&
    (approvalModeFor(currentBot ?? {}) === "custom" ||
      (applyToAllThreads === true && threadApprovalModes(currentBot ?? {}).includes("custom")));
  // Full: HTTP for every client (omb #2701), except when leaving Custom, which
  // still needs the packaged desktop's private channel first. Organization
  // Full still goes alone after ordinary fields (#1674).
  if (approvalMode === "full" && !leavesCustom) {
    if (organizationFullAccess === true) {
      if (Object.keys(ordinaryPatch).length) {
        await request(`/api/bots/${botId}`, { method: "PATCH", body: JSON.stringify(ordinaryPatch), signal });
      }
      const result = await request(`/api/bots/${botId}`, { method: "PATCH", signal,
        body: JSON.stringify({
          approvalMode: "full",
          ...(typeof openThreadId === "string" ? { threadId: openThreadId } : {}),
        }) });
      return result.bot;
    }
    const result = await request(`/api/bots/${botId}`, {
      method: "PATCH",
      body: JSON.stringify({ ...ordinaryPatch, approvalMode: "full" }),
      signal,
    });
    return result.bot;
  }
  const trustedMode = approvalMode === "custom" ? approvalMode : null;

  if (!trustedMode && !leavesCustom) {
    const result = await request(`/api/bots/${botId}`, {
      method: "PATCH",
      // The all-threads scope rides along for Ask/Edits/Auto (team dialog).
      body: JSON.stringify(
        approvalMode === undefined ? ordinaryPatch : {
          ...ordinaryPatch,
          approvalMode,
          ...(applyToAllThreads ? { applyToAllThreads: true } : {}),
        },
      ),
      signal,
    });
    return result.bot;
  }

  if (!trustedApprovals || approvalMode === undefined) {
    throw new Error("Custom approval, and leaving it, are set in the Sagax desktop app on the computer that runs this server");
  }

  const trustedOptions = {
    acknowledgeLocalAuto: ordinaryPatch.acknowledgeLocalAuto === true,
    ...(applyToAllThreads ? { allThreads: true } : {}),
  };

  const rejectCancelledTrustedGrant = async () => {
    if (!signal.aborted) return;
    // IPC cannot cancel a grant that already reached the embedded server. If
    // a newer selection or an unmount aborted this operation while a private
    // channel grant was in flight, revoke it before reporting cancellation.
    if (trustedMode || leavesCustom) {
      try {
        await trustedApprovals.setMode(botId, "ask", { acknowledgeLocalAuto: false, ...(applyToAllThreads ? { allThreads: true } : {}) });
      } catch (error) {
        throw new Error(
          `The cancelled ${approvalMode === "custom" ? "Custom approval" : "approval"} grant could not be revoked: ${readableError(error)}`,
        );
      }
    }
    throw new DOMException("The bot update was cancelled", "AbortError");
  };

  if (leavesCustom) {
    const modeBot = await trustedApprovals.setMode(botId, approvalMode, trustedOptions);
    await rejectCancelledTrustedGrant();
    if (Object.keys(ordinaryPatch).length === 0) return modeBot;
    const result = await request(`/api/bots/${botId}`, {
      method: "PATCH",
      body: JSON.stringify(ordinaryPatch),
      signal,
    });
    return result.bot;
  }

  if (Object.keys(ordinaryPatch).length > 0) {
    await request(`/api/bots/${botId}`, {
      method: "PATCH",
      // Local-computer + Auto consent remains relevant when the approval
      // transition itself uses the private channel (for example, a coalesced
      // Auto -> Full edit). The HTTP computer update must retain that proof.
      body: JSON.stringify(ordinaryPatch),
      signal,
    });
  }
  if (signal.aborted) throw new DOMException("The bot update was cancelled", "AbortError");
  const modeBot = await trustedApprovals.setMode(botId, approvalMode, trustedOptions);
  await rejectCancelledTrustedGrant();
  return modeBot;
}

/** Bot removal is intentionally non-optimistic. The server first removes any
 * computer owned only by this bot, so local state changes only after that
 * durable cleanup and the bot deletion both succeed. */
const pendingBotDeletions = new Map<string, Promise<void>>();

export async function requestConfirmedBotDeletion(
  botId: string,
  requestDelete: (botId: string) => Promise<unknown>,
  onConfirmed: (botId: string) => void,
): Promise<void> {
  const existing = pendingBotDeletions.get(botId);
  if (existing) return existing;
  const deletion = (async () => {
    await requestDelete(botId);
    onConfirmed(botId);
  })();
  pendingBotDeletions.set(botId, deletion);
  try {
    await deletion;
  } finally {
    if (pendingBotDeletions.get(botId) === deletion) pendingBotDeletions.delete(botId);
  }
}

export interface PeripheralSnapshotLoad<Key extends string = string> {
  key: Key;
  load: () => Promise<void>;
}

export function normalizeSnapshotFailure(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/** A refused SSE resume needs the chat transcript snapshot before its cursor
 * can be acknowledged. The other panels should refresh at the same boundary,
 * but a broken optional endpoint must not hold every chat frame hostage. */
export async function loadSnapshotBoundary<Key extends string>(
  loadChat: () => Promise<void>,
  peripherals: readonly PeripheralSnapshotLoad<Key>[],
  onPeripheralFailure: (part: PeripheralSnapshotLoad<Key>, error: Error) => void,
): Promise<boolean> {
  const [chat, ...settledPeripherals] = await Promise.allSettled([
    loadChat(),
    ...peripherals.map((part) => part.load()),
  ]);
  settledPeripherals.forEach((result, index) => {
    if (result.status === "rejected") {
      onPeripheralFailure(peripherals[index]!, normalizeSnapshotFailure(result.reason));
    }
  });
  return chat.status === "fulfilled";
}

/** The chat shows a reply once it is finished (the turn's busy state is
 * what a reader sees while it works). Runtime frames feed the reducer only
 * through the model-variant fold; streamed deltas go to the stream buffer
 * below, which only Sagax's Live call and floating bots read. */
export function runtimeFrameAction(event: RuntimeEvent): Action | null {
  return event.type === "turn.started" || event.type === "session.model-variants" || event.type === "session.model-fallback" || event.type === "turn.completed"
    ? { type: "modelVariantRuntime", event }
    : null;
}

bindModerationApi(api);
