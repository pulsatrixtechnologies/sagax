/** Webhook wire shapes — triggers and delivery attempts as they ride the
 * REST snapshot and the `webhook` / `webhook.attempt` live frames. Moved
 * verbatim from the client's mirrors (src/lib/webhooks.ts); the client file
 * re-exports these under the same names. */
import type { RoutineRunOn } from "./routines.ts";
import type { TriggerAutomationStatus, TriggerSourceConfig, TriggerSourceType } from "./trigger-sources.ts";

export interface WebhookTrigger {
  id: string;
  endpointId: string;
  name: string;
  prompt: string;
  botId: string;
  /** Set when this webhook belongs to a routine (it starts that routine).
   * The routine's page and editor manage it (2026-10-29). */
  routineId?: string;
  runOn: RoutineRunOn;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastReceivedAt?: number;
  lastRunId?: string;
  /** delivery:"post" only: the stable thread this webhook's messages land
   *  in -- created once on first delivery and reused forever after, never
   *  the bot's currently-selected thread. Mirrors Routine's own
   *  resultsThreadId (./routines.ts). */
  resultsThreadId?: string;
  deliveryCount: number;
  verificationPending?: boolean;
  verifiedAt?: number;
  verificationSample?: WebhookVerificationSample;
  eventTypes?: string[];
  /** Unfinished runs this webhook may hold before new deliveries get 429.
   * Absent means the default (3). */
  maxPendingRuns?: number;
  /** Last 4 characters of the bearer token: all that is shown once the full
   *  token has been copied. */
  tokenLast4?: string;
  /** A token was generated for this older webhook at server start and has not
   *  been copied yet (POST /api/webhooks/:id/reveal hands it over once). */
  tokenPending?: boolean;
  /** Typed trigger: the provider, its events and filters (see
   *  shared/trigger-sources.ts). Absent on a plain bearer webhook. */
  source?: TriggerSourceConfig;
  /** #4250: the typed source of a trigger whose type the previous app
   * release does not know (NEWER_SOURCE_TYPES). That release draws any
   * webhook with `source` as a typed row and throws on an unknown type, so
   * the server sends it here instead (webhookForApp) and this app reads it
   * back as `source` (webhookFromServer). Fold into `source` one release
   * later. */
  sourceNext?: TriggerSourceConfig;
  /** Typed trigger: whether the provider's signing secret is set. The
   *  secret is write only. */
  signingSecretSet?: boolean;
  /** Typed trigger with a poller: whether its password (or ICS link) is
   *  stored. Write only. */
  pollerCredentialsSet?: boolean;
  /** Typed trigger: last outcome of its Graph subscription or poller. */
  automation?: TriggerAutomationStatus;
}

export interface WebhookTriggerInput {
  name: string;
  prompt: string;
  botId: string;
  runOn?: RoutineRunOn;
  enabled?: boolean;
  verificationPending?: boolean;
  eventTypes?: string[];
  /** 1–50; `null` goes back to the default. */
  maxPendingRuns?: number | null;
  source?: TriggerSourceConfig;
  /** Write only: the provider's signing secret, pasted by the owner. */
  signingSecret?: string;
  /** Write only: the poller's password, or an ICS calendar's private link
   *  (stored sealed apart, never returned). */
  pollerCredentials?: { password?: string; url?: string };
}

export interface WebhookVerificationSample {
  receivedAt: number;
  eventName?: string;
  contentType?: string;
  preview: string;
}

export type WebhookAttemptOutcome = "accepted" | "captured" | "duplicate" | "ignored" | "rejected";

export interface WebhookAttempt {
  id: string;
  webhookId: string;
  receivedAt: number;
  outcome: WebhookAttemptOutcome;
  statusCode: number;
  eventName?: string;
  preview?: string;
  deliveryId?: string;
  runId?: string;
  reason?: string;
}

export interface WebhookIngressStatus {
  available: boolean;
  baseUrl: string;
  error?: string;
}


/** #4250: typed sources the previous release (app and server) cannot read:
 * its catalog has no entry for them. One release of grace, then empty. */
export const NEWER_SOURCE_TYPES: ReadonlySet<TriggerSourceType> = new Set<TriggerSourceType>(["perspicax"]);

/** A trigger as the server sends it to an app: a newer source rides under
 * `sourceNext`, so the previous app release (which reads `source` only)
 * shows a plain row instead of throwing. */
export function webhookForApp<T extends { source?: TriggerSourceConfig }>(webhook: T): T & { sourceNext?: TriggerSourceConfig } {
  if (!webhook.source || !NEWER_SOURCE_TYPES.has(webhook.source.type)) return webhook;
  const { source, ...rest } = webhook;
  return { ...(rest as T), sourceNext: source };
}

/** A trigger as this app reads it: `sourceNext` back into `source`. */
export function webhookFromServer(webhook: WebhookTrigger): WebhookTrigger {
  if (webhook.source || !webhook.sourceNext) return webhook;
  const { sourceNext, ...rest } = webhook;
  return { ...rest, source: sourceNext };
}
